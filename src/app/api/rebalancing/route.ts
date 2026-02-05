import { createClient } from '@/lib/supabase/server'
import { calculateCashBalances, fetchAllUserTransactionsServer } from '@/lib/finance'
import { NextRequest, NextResponse } from 'next/server'

export async function GET(req: NextRequest) {
  try {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    // 1. Fetch all necessary data in parallel for performance
    const [
      { data: subPortfolios },
      { data: assetTargets },
      { data: accounts },
      { data: detailedTaxLots },
      transactions
    ] = await Promise.all([
      supabase.from('sub_portfolios').select('*').eq('user_id', user.id).order('name'),
      supabase.from('asset_targets').select('*').eq('user_id', user.id),
      supabase.from('accounts').select('id, name, type, tax_status').eq('user_id', user.id),
      supabase.from('tax_lots').select(`
        id, asset_id, remaining_quantity, cost_basis_per_unit, purchase_date, account_id,
        asset:assets (ticker, name, sub_portfolio_id, asset_type, asset_subtype, geography, size_tag, factor_tag)
      `).gt('remaining_quantity', 0).eq('user_id', user.id),
      fetchAllUserTransactionsServer(supabase, user.id)
    ])

    // 2. Initial Setup
    const { totalCash } = calculateCashBalances(transactions || [])
    
    // Normalize asset data (Supabase joins can return arrays or objects)
    const normalizeAsset = (assetData: any) => Array.isArray(assetData) ? assetData[0] : assetData;
    
    const holdingsWithAssets = detailedTaxLots?.map(lot => ({
      ...lot,
      asset: normalizeAsset(lot.asset)
    })) || [];

    const uniqueTickers = [...new Set(holdingsWithAssets.map(lot => lot.asset?.ticker).filter(Boolean))]
    
    // Fetch latest prices
    const { data: prices } = await supabase
      .from('asset_prices')
      .select('ticker, price, timestamp')
      .in('ticker', uniqueTickers)
      .order('timestamp', { ascending: false })

    const latestPrices = new Map<string, number>()
    prices?.forEach(p => { if (!latestPrices.has(p.ticker)) latestPrices.set(p.ticker, p.price) })

    // Calculate total value (Holdings + Cash)
    const holdingsValue = holdingsWithAssets.reduce((sum, lot) => {
      return sum + (lot.remaining_quantity * (latestPrices.get(lot.asset?.ticker) || 0))
    }, 0) || 0
    const totalPortfolioValue = holdingsValue + totalCash

    // 3. Process Allocations by Lens (Supports Bug #36 - Multi-lens charts)
    const subPortfolioMetrics = new Map<string, any>()

    holdingsWithAssets.forEach(lot => {
      const price = latestPrices.get(lot.asset?.ticker) || 0
      const value = lot.remaining_quantity * price
      const spId = lot.asset?.sub_portfolio_id || 'unassigned'

      if (!subPortfolioMetrics.has(spId)) {
        const sp = subPortfolios?.find(p => p.id === spId)
        subPortfolioMetrics.set(spId, {
          id: spId,
          name: sp?.name || 'Unassigned',
          targetPct: sp?.target_allocation || 0, // Overall portfolio target
          currentValue: 0,
          assets: []
        })
      }
      const metrics = subPortfolioMetrics.get(spId)
      metrics.currentValue += value
      
      const existingAsset = metrics.assets.find((a: any) => a.asset_id === lot.asset_id)
      if (existingAsset) {
        existingAsset.currentValue += value
      } else {
        metrics.assets.push({
          asset_id: lot.asset_id,
          ticker: lot.asset?.ticker,
          name: lot.asset?.name,
          currentValue: value
        })
      }
    })

    // 4. Detailed Rebalancing Logic (Bug #34 & #36)
    const rebalanceResults: any[] = []
    
    subPortfolioMetrics.forEach((spMetrics, spId) => {
      const spTotalValue = spMetrics.currentValue
      const spCurrentPct = totalPortfolioValue > 0 ? (spTotalValue / totalPortfolioValue) * 100 : 0
      const spTargetPct = spMetrics.targetPct
      const spDrift = spCurrentPct - spTargetPct

      spMetrics.assets.forEach((asset: any) => {
        const assetTargetInSP = assetTargets?.find(at => at.asset_id === asset.asset_id && at.sub_portfolio_id === spId)?.target_percentage || 0
        const impliedOverallTarget = (spTargetPct * assetTargetInSP) / 100
        const currentOverallPct = totalPortfolioValue > 0 ? (asset.currentValue / totalPortfolioValue) * 100 : 0
        const currentInSPPct = spTotalValue > 0 ? (asset.currentValue / spTotalValue) * 100 : 0
        
        // Drift within sub-portfolio relative to target
        const relativeDrift = assetTargetInSP > 0 ? ((currentInSPPct - assetTargetInSP) / assetTargetInSP) * 100 : 0
        
        let action: 'buy' | 'sell' | 'hold' = 'hold'
        // Using common 5% relative drift threshold if not specified on SP
        const sp = subPortfolios?.find(p => p.id === spId)
        const upThread = sp?.upside_threshold || 5
        const downThresh = sp?.downside_threshold || 5

        if (relativeDrift >= upThread) action = 'sell'
        else if (relativeDrift <= -downThresh) action = 'buy'

        rebalanceResults.push({
          ...asset,
          sub_portfolio_id: spId,
          sub_portfolio_name: spMetrics.name,
          current_percentage: currentOverallPct,
          implied_overall_target: impliedOverallTarget,
          target_in_sp: assetTargetInSP,
          sub_portfolio_target_percentage: assetTargetInSP, // Compatibility fix
          current_in_sp: currentInSPPct,
          sub_portfolio_percentage: currentInSPPct, // Compatibility fix
          drift_percentage: relativeDrift,
          action,
          amount: Math.abs((assetTargetInSP / 100 * spTotalValue) - asset.currentValue)
        })
      })
    })

    // 5. Tactical Suggestions & Tax Optimization (Bug #34 & #37)
    const finalAllocations = rebalanceResults.map(res => {
      let reinvestment_suggestions: any[] = []
      let recommended_accounts: any[] = []
      let tax_impact = 0

      // TAX LOGIC (Bug #37): Recommendation for Sells
      if (res.action === 'sell') {
        const assetLots = holdingsWithAssets.filter(l => l.asset_id === res.asset_id) || []
        const currentPrice = latestPrices.get(res.ticker) || 0
        
        // Group lots by account to see where we can sell
        const accMap = new Map<string, any>()
        assetLots.forEach(lot => {
          const accId = lot.account_id
          if (!accMap.has(accId)) {
            const acc = accounts?.find(a => a.id === accId)
            accMap.set(accId, { 
              name: acc?.name || 'Unknown', 
              tax_status: acc?.tax_status, 
              value: 0, 
              costBasis: 0,
              lots: [] 
            })
          }
          const entry = accMap.get(accId)
          entry.value += (lot.remaining_quantity * currentPrice)
          entry.costBasis += (lot.remaining_quantity * lot.cost_basis_per_unit)
          entry.lots.push(lot)
        })

        // Optimization: Suggest selling from accounts to harvest losses or use tax-advantaged first
        const sortedAccounts = Array.from(accMap.entries()).sort(([, a], [, b]) => {
          if (a.tax_status === 'Taxable' && b.tax_status !== 'Taxable') return 1 // Prefer taxable for potential harvest
          return b.value - a.value 
        })

        let remainingToSell = res.amount
        sortedAccounts.forEach(([id, acc]) => {
          if (remainingToSell <= 0) return
          const sellFromAcc = Math.min(acc.value, remainingToSell)
          const gainLoss = sellFromAcc - (acc.costBasis * (sellFromAcc / acc.value))
          
          recommended_accounts.push({
            id,
            name: acc.name,
            amount: sellFromAcc,
            reason: acc.tax_status === 'Taxable' && gainLoss < 0 
              ? `Harvesting ${Math.abs(gainLoss).toFixed(0)} loss` 
              : `Trimming overweight in ${acc.name}`
          })
          tax_impact += (acc.tax_status === 'Taxable' ? gainLoss : 0)
          remainingToSell -= sellFromAcc
        })
      }

      // FUNDING LOGIC (Bug #34): Matching Buys to Sells
      if (res.action === 'buy') {
        let needed = res.amount
        const sells = [...rebalanceResults]
          .filter(r => r.action === 'sell')
          .sort((a, b) => b.drift_percentage - a.drift_percentage)

        sells.forEach(s => {
          if (needed <= 0) return
          const take = Math.min(s.amount, needed)
          if (take > 0) {
            reinvestment_suggestions.push({
              from_ticker: s.ticker,
              amount: take,
              reason: `Reallocating ${s.drift_percentage.toFixed(1)}% overweight ${s.ticker}`
            })
            needed -= take
          }
        })
      }

      return { 
        ...res, 
        reinvestment_suggestions, 
        recommended_accounts,
        tax_impact 
      }
    })

    return NextResponse.json({
      subPortfolios: subPortfolios || [],
      assetTargets: assetTargets || [], // RESTORED
      currentAllocations: finalAllocations,
      totalValue: totalPortfolioValue,
      totalCash,
      lastPriceUpdate: prices?.[0]?.timestamp || null // RESTORED
    })

  } catch (error) {
    console.error('Rebalancing API Error:', error)
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 })
  }
}
