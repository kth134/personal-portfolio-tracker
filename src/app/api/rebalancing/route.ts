import { createClient } from '@/lib/supabase/server'
import { NextRequest, NextResponse } from 'next/server'

type TaxLot = {
  asset_id: string
  remaining_quantity: number
  cost_basis_per_unit: number
  asset: {
    ticker: string
    name: string | null
    sub_portfolio_id: string | null
  }
}

export async function GET() {
  try {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    // Fetch sub-portfolios with targets
    const { data: subPortfolios } = await supabase
      .from('sub_portfolios')
      .select('*')
      .eq('user_id', user.id)
      .order('name')

    // Fetch asset targets
    const { data: assetTargets } = await supabase
      .from('asset_targets')
      .select('*')
      .eq('user_id', user.id)

    // Fetch accounts for tax optimization
    const { data: accounts } = await supabase
      .from('accounts')
      .select('id, name, type, tax_status')
      .eq('user_id', user.id)

    // Fetch transactions for cash balance calculation
    const { data: transactions } = await supabase
      .from('transactions')
      .select('*')
      .eq('user_id', user.id)

    // Fetch detailed tax lots for cost basis calculations
    const { data: detailedTaxLots } = await supabase
      .from('tax_lots')
      .select(`
        asset_id,
        remaining_quantity,
        cost_basis_per_unit,
        account_id,
        asset:assets (
          ticker,
          name,
          sub_portfolio_id
        )
      `)
      .gt('remaining_quantity', 0)
      .eq('user_id', user.id)

    // Compute cash balances (same logic as portfolio page)
    const cashBalances = new Map<string, number>()
    transactions?.forEach((tx: any) => {
      if (!tx.account_id) return
      // Skip automatic deposits for external buys
      if (tx.notes === 'Auto-deposit for external buy') {
        return
      }
      const current = cashBalances.get(tx.account_id) || 0
      let delta = 0
      const amt = Number(tx.amount || 0)
      const fee = Number(tx.fees || 0)
      switch (tx.type) {
        case 'Buy':
          if (tx.funding_source === 'cash') {
            delta -= (Math.abs(amt) + fee)  // deduct purchase amount and fee from cash balance
          } // else (including 'external'): no impact to cash balance
          break
        case 'Sell':
          delta += (amt - fee)  // increase cash balance by sale amount less fees
          break
        case 'Dividend':
          delta += amt  // increase cash balance
          break
        case 'Interest':
          delta += amt  // increase cash balance
          break
        case 'Deposit':
          delta += amt  // increase cash balance
          break
        case 'Withdrawal':
          delta -= Math.abs(amt)  // decrease cash balance
          break
      }
      const newBalance = current + delta
      cashBalances.set(tx.account_id, newBalance)
    })
    const totalCash = Array.from(cashBalances.values()).reduce((sum, bal) => sum + bal, 0)

    // Fetch current holdings
    const { data: taxLotsData } = await supabase
      .from('tax_lots')
      .select(`
        asset_id,
        remaining_quantity,
        cost_basis_per_unit,
        asset:assets (
          ticker,
          name,
          sub_portfolio_id
        )
      `)
      .gt('remaining_quantity', 0)
      .eq('user_id', user.id)

    const taxLots = taxLotsData as TaxLot[] | null

    // Fetch latest prices
    const uniqueTickers = [...new Set(taxLots?.map(lot => lot.asset.ticker) || [])]
    const { data: prices } = await supabase
      .from('asset_prices')
      .select('ticker, price, timestamp')
      .in('ticker', uniqueTickers)
      .order('timestamp', { ascending: false })

    const latestPrices = new Map<string, { price: number, timestamp: string }>()
    prices?.forEach(p => {
      if (!latestPrices.has(p.ticker)) {
        latestPrices.set(p.ticker, { price: p.price, timestamp: p.timestamp })
      }
    })

    // Calculate current allocations
    const holdingsValue = taxLots?.reduce((sum, lot) => {
      const price = latestPrices.get(lot.asset.ticker)?.price || 0
      return sum + (lot.remaining_quantity * price)
    }, 0) || 0
    const totalValue = holdingsValue + totalCash

    const allocationsBySubPortfolio = new Map<string, any[]>()
    const allocations: any[] = []

    taxLots?.forEach(lot => {
      const price = latestPrices.get(lot.asset.ticker)?.price || 0
      const value = lot.remaining_quantity * price
      const subPortfolioId = lot.asset.sub_portfolio_id || 'unassigned'

      if (!allocationsBySubPortfolio.has(subPortfolioId)) {
        allocationsBySubPortfolio.set(subPortfolioId, [])
      }

      const subPortfolioItems = allocationsBySubPortfolio.get(subPortfolioId)!
      const existing = subPortfolioItems.find(item => item.asset_id === lot.asset_id)

      if (existing) {
        existing.current_value += value
        existing.quantity += lot.remaining_quantity
      } else {
        subPortfolioItems.push({
          asset_id: lot.asset_id,
          ticker: lot.asset.ticker,
          name: lot.asset.name,
          current_value: value,
          quantity: lot.remaining_quantity,
          sub_portfolio_id: subPortfolioId
        })
      }
    })

    // Calculate percentages and suggestions
    allocationsBySubPortfolio.forEach((items, subPortfolioId) => {
      const subPortfolio = subPortfolios?.find(sp => sp.id === subPortfolioId)
      const subTarget = subPortfolio?.target_allocation || 0
      const subValue = items.reduce((sum, item) => sum + item.current_value, 0)
      const subPercentage = totalValue > 0 ? (subValue / totalValue) * 100 : 0

      items.forEach(item => {
        const assetTarget = assetTargets?.find(at => at.asset_id === item.asset_id && at.sub_portfolio_id === subPortfolioId)?.target_percentage || 0
        const impliedOverallTarget = (subTarget * assetTarget) / 100
        const currentOverallPercentage = totalValue > 0 ? (item.current_value / totalValue) * 100 : 0
        const subPortfolioPercentage = subValue > 0 ? (item.current_value / subValue) * 100 : 0

        // Calculate relative drift: (current - target) / target * 100
        // For assets, we use the sub-portfolio percentage vs asset target within sub-portfolio
        const driftPercentage = assetTarget > 0 ? ((subPortfolioPercentage - assetTarget) / assetTarget) * 100 : 0
        const driftDollar = (driftPercentage / 100) * totalValue

        // Simple rebalancing logic
        let action: 'buy' | 'sell' | 'hold' = 'hold'
        let amount = 0

        const upsideThreshold = subPortfolio.upside_threshold
        const downsideThreshold = subPortfolio.downside_threshold
        const bandMode = subPortfolio.band_mode

        // Convert absolute thresholds to relative terms for assets with targets
        const relativeUpsideThreshold = assetTarget > 0 ? (upsideThreshold / assetTarget) * 100 : upsideThreshold
        const relativeDownsideThreshold = assetTarget > 0 ? (downsideThreshold / assetTarget) * 100 : downsideThreshold

        if (Math.abs(driftPercentage) > relativeDownsideThreshold || Math.abs(driftPercentage) > relativeUpsideThreshold) {
          if (driftPercentage > 0) {
            action = 'sell'
            amount = bandMode
              ? (driftPercentage - relativeUpsideThreshold) / 100 * totalValue
              : driftDollar
          } else {
            action = 'buy'
            amount = bandMode
              ? (relativeDownsideThreshold + driftPercentage) / 100 * totalValue
              : Math.abs(driftDollar)
          }
        }

        allocations.push({
          ...item,
          current_percentage: currentOverallPercentage,
          sub_portfolio_percentage: subPortfolioPercentage,
          implied_overall_target: impliedOverallTarget,
          drift_percentage: driftPercentage,
          drift_dollar: driftDollar,
          action,
          amount: Math.abs(amount),
          tax_notes: action === 'sell' ? 'Prioritize taxable accounts' : action === 'buy' ? 'Prioritize tax-advantaged accounts' : ''
        })
      })
    })

    // Enhanced logic: Smart Reinvestment and Tax Optimization
    const enhancedAllocations = allocations.map(allocation => {
      let reinvestmentSuggestions: any[] = []
      let taxImpact = 0
      let recommendedAccounts: any[] = []
      let taxNotes = allocation.tax_notes

      if (allocation.action === 'sell') {
        // Calculate tax impact for selling
        const assetTaxLots = detailedTaxLots?.filter(lot => 
          lot.asset_id === allocation.asset_id && lot.account_id
        ) || []

        let totalCostBasis = 0
        let totalProceeds = allocation.amount
        let estimatedGain = 0

        // Calculate weighted average cost basis for the lots being sold
        assetTaxLots.forEach((lot: any) => {
          if (!lot.asset?.ticker) return
          const lotValue = lot.remaining_quantity * (latestPrices.get(lot.asset.ticker)?.price || 0)
          const lotCostBasis = lot.remaining_quantity * lot.cost_basis_per_unit
          totalCostBasis += lotCostBasis

          // Estimate how much of this lot would be sold
          const currentPrice = latestPrices.get(lot.asset.ticker)?.price || 0
          const sellRatio = currentPrice > 0 ? Math.min(1, totalProceeds / (allocation.quantity * currentPrice)) : 0
          estimatedGain += (lotValue * sellRatio) - (lotCostBasis * sellRatio)
        })

        // Estimate capital gains tax (simplified - long-term rate)
        taxImpact = Math.max(0, estimatedGain) * 0.15 // 15% long-term capital gains rate

        // Recommend accounts for selling (prioritize taxable accounts for tax-loss harvesting)
        const sellAccounts = accounts?.filter(acc => acc.tax_status === 'Taxable') || []
        recommendedAccounts = sellAccounts.map(acc => ({
          id: acc.id,
          name: acc.name,
          type: acc.type,
          reason: 'Taxable account preferred for potential tax-loss harvesting'
        }))

        // Smart reinvestment: Suggest what to buy with proceeds
        const underweightAssets = allocations.filter(a => 
          a.action === 'buy' && a.sub_portfolio_id === allocation.sub_portfolio_id
        ).sort((a, b) => Math.abs(b.drift_percentage) - Math.abs(a.drift_percentage))

        reinvestmentSuggestions = underweightAssets.slice(0, 3).map(asset => {
          const availableProceeds = allocation.amount - taxImpact
          const price = latestPrices.get(asset.ticker)?.price || 0
          const suggestedShares = price > 0 ? availableProceeds * (asset.amount / underweightAssets.reduce((sum, a) => sum + a.amount, 0)) / price : 0

          return {
            asset_id: asset.asset_id,
            ticker: asset.ticker,
            name: asset.name,
            suggested_amount: availableProceeds * (asset.amount / underweightAssets.reduce((sum, a) => sum + a.amount, 0)),
            suggested_shares: suggestedShares,
            reason: `Underweight by ${Math.abs(asset.drift_percentage).toFixed(2)}% in same sub-portfolio`
          }
        })

        taxNotes = `Estimated tax impact: $${taxImpact.toFixed(2)} (${(taxImpact/totalProceeds*100).toFixed(1)}% of proceeds). Consider tax-loss harvesting.`

      } else if (allocation.action === 'buy') {
        // For buys, recommend tax-advantaged accounts
        const buyAccounts = accounts?.filter(acc => acc.tax_status === 'Tax-Advantaged') || []
        recommendedAccounts = buyAccounts.map(acc => ({
          id: acc.id,
          name: acc.name,
          type: acc.type,
          reason: 'Tax-advantaged account preferred for tax-deferred growth'
        }))

        taxNotes = 'Use tax-advantaged accounts for long-term tax benefits.'
      }

      return {
        ...allocation,
        tax_impact: taxImpact,
        reinvestment_suggestions: reinvestmentSuggestions,
        recommended_accounts: recommendedAccounts,
        tax_notes: taxNotes
      }
    })

    const cashNeeded = allocations.reduce((sum, item) => {
      if (item.action === 'buy') return sum + item.amount
      if (item.action === 'sell') return sum - item.amount
      return sum
    }, 0)

    const lastPriceUpdate = prices?.length ? prices[0].timestamp : null

    return NextResponse.json({
      subPortfolios: subPortfolios || [],
      assetTargets: assetTargets || [],
      currentAllocations: enhancedAllocations,
      totalValue,
      cashNeeded,
      lastPriceUpdate
    })
  } catch (error) {
    console.error('Error fetching rebalancing data:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}