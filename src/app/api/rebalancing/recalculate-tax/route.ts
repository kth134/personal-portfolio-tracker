import { createClient } from '@/lib/supabase/server'
import { NextRequest, NextResponse } from 'next/server'

export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const { allocations, totalValue, currentAllocations } = await request.json()

    // Fetch necessary data for tax calculations
    const { data: accounts } = await supabase
      .from('accounts')
      .select('id, name, type, tax_status')
      .eq('user_id', user.id)

    // Fetch tax lots for cost basis calculations (include purchase_date and id)
    const { data: detailedTaxLots } = await supabase
      .from('tax_lots')
      .select(`
        id,
        asset_id,
        remaining_quantity,
        cost_basis_per_unit,
        purchase_date,
        account_id,
        asset:assets(ticker, name)
      `)
      .eq('user_id', user.id)

    // Get latest prices
    const { data: latestPricesData } = await supabase
      .from('asset_prices')
      .select('asset_id, price')
      .order('created_at', { ascending: false })

    const latestPrices = new Map()
    latestPricesData?.forEach((price: any) => {
      if (!latestPrices.has(price.asset_id)) {
        latestPrices.set(price.asset_id, { price: price.price })
      }
    })

    // Recalculate tax data for each allocation
    const taxUpdates = allocations.map((allocation: any) => {
      let taxImpact = 0
      let recommendedAccounts: any[] = []
      let taxNotes = ''
      let reinvestmentSuggestions: any[] = []

      console.log(`Processing allocation: action=${allocation.action}, asset=${allocation.asset_id}, sub_portfolio=${allocation.sub_portfolio_id}, amount=${allocation.amount}`)

      if (allocation.action === 'buy') {
        // For buying, recommend tax-advantaged accounts where the user actually holds assets or any tax-advantaged accounts
        const buyAccounts = accounts?.filter((acc: any) => acc.tax_status !== 'Taxable') || []
        recommendedAccounts = buyAccounts.slice(0, 2).map((acc: any) => ({
          id: acc.id,
          name: acc.name,
          type: acc.type,
          reason: 'Tax-advantaged account preferred for buying'
        }))

        taxNotes = 'Consider tax-advantaged accounts for purchases'

        // Suggest sells to fund this buy using provided currentAllocations (fallback to empty)
        const allAllocations = (currentAllocations || []) as any[]
        const sellCandidates = allAllocations
          .filter(a => a.sub_portfolio_id === allocation.sub_portfolio_id && a.action === 'sell' && a.amount > 0)
          .sort((a, b) => Math.abs(b.drift_percentage) - Math.abs(a.drift_percentage))
        let remainingNeed = allocation.amount || 0
        const fundingSuggestions: any[] = []
        for (const cand of sellCandidates) {
          if (remainingNeed <= 0) break
          const take = Math.min(cand.amount, remainingNeed)
          const price = latestPrices.get(cand.asset_id)?.price || 0
          const shares = price > 0 ? take / price : 0
          fundingSuggestions.push({ asset_id: cand.asset_id, ticker: cand.ticker, name: cand.name, suggested_amount: take, suggested_shares: shares, reason: `Trim ${Math.abs(cand.drift_percentage).toFixed(2)}% overweight first` })
          remainingNeed -= take
        }
        if (fundingSuggestions.length > 0) {
          reinvestmentSuggestions = fundingSuggestions
        }
      }

      // Prepare lot/account grouping for sell-side tax estimation
      const price = latestPrices.get(allocation.asset_id)?.price || 0
      const assetTaxLots = (detailedTaxLots || []).filter((dl: any) => dl.asset_id === allocation.asset_id)
      const accountMap = new Map<string, any>()
      assetTaxLots.forEach((lot: any) => {
        const lotValue = (lot.remaining_quantity || 0) * price
        const lotCost = (lot.remaining_quantity || 0) * (lot.cost_basis_per_unit || 0)
        const accId = lot.account_id || 'unknown'
        if (!accountMap.has(accId)) {
          const acc = accounts?.find((a: any) => a.id === accId)
          accountMap.set(accId, { lots: [], totalValue: 0, totalCostBasis: 0, tax_status: acc?.tax_status, account: acc })
        }
        const entry = accountMap.get(accId)!
        entry.lots.push({ ...lot, lotValue, lotCost })
        entry.totalValue += lotValue
        entry.totalCostBasis += lotCost
      })

      if (allocation.action === 'sell') {
      // If there are no lots with account ids, fall back to simple estimation
      if (accountMap.size === 0) {
          // Fallback: proportional across lots but apply per-lot short/long-term rates
          const now = new Date()
          const SHORT_TERM_DAYS = 365
          const SHORT_TERM_RATE = 0.37
          const LONG_TERM_RATE = 0.15
          let estimatedTaxSum = 0
          assetTaxLots.forEach((lot: any) => {
            const lotCostBasis = lot.remaining_quantity * lot.cost_basis_per_unit
            const currentPrice = price
            const lotValue = lot.remaining_quantity * currentPrice
            const sellRatio = currentPrice > 0 ? Math.min(1, allocation.amount / lotValue) : 0
            const lotGain = (lotValue * sellRatio) - (lotCostBasis * sellRatio)
            if (lotGain > 0) {
              let lotRate = LONG_TERM_RATE
              if (lot.purchase_date) {
                const ageDays = Math.floor((now.getTime() - new Date(lot.purchase_date).getTime()) / (1000 * 60 * 60 * 24))
                if (ageDays < SHORT_TERM_DAYS) lotRate = SHORT_TERM_RATE
              }
              estimatedTaxSum += lotGain * lotRate
            }
          })
          taxImpact = Math.max(0, estimatedTaxSum)
          // Recommend accounts by tax_status if available; otherwise fall back to any account or a generic placeholder
          const sellAccounts = (accounts || []).filter((acc: any) => acc.tax_status === 'Taxable')
          const fallbackAccounts = (accounts || [])
          const chosen = sellAccounts.length > 0 ? sellAccounts : fallbackAccounts
          if (chosen.length > 0) {
            recommendedAccounts = chosen.slice(0, 2).map((acc: any) => ({ id: acc.id, name: acc.name, type: acc.type, reason: 'Recommended based on account availability' }))
          } else {
            recommendedAccounts = [{ id: 'unknown', name: 'Account (unknown)', type: 'Account', reason: 'No account metadata available' }]
          }
          taxNotes = taxImpact > 0 ? 'Capital gains tax estimated' : 'Potential tax-loss harvesting opportunity'
        } else {
          // Determine whether selling will be net gain or loss by checking unrealized gain across all lots
          let totalUnrealizedGain = 0
          accountMap.forEach(entry => {
            totalUnrealizedGain += (entry.totalValue - entry.totalCostBasis)
          })

          const isNetGain = totalUnrealizedGain > 0

          // Build ordered list of accounts to sell from based on priority
          const accountsList = Array.from(accountMap.entries()).map(([id, entry]) => ({ id, ...entry }))

          accountsList.sort((a, b) => {
            // If net gain: prefer tax-advantaged accounts first (to avoid taxable gains)
            if (isNetGain) {
              const aAdv = a.tax_status && a.tax_status !== 'Taxable'
              const bAdv = b.tax_status && b.tax_status !== 'Taxable'
              if (aAdv && !bAdv) return -1
              if (!aAdv && bAdv) return 1
            } else {
              // Net loss: prefer Taxable accounts first to realize losses
              const aTax = a.tax_status === 'Taxable'
              const bTax = b.tax_status === 'Taxable'
              if (aTax && !bTax) return -1
              if (!aTax && bTax) return 1
            }
            // Fallback: by descending account total value
            return b.totalValue - a.totalValue
          })

          // Allocate the requested sell amount across accounts in priority order
          let remaining = allocation.amount || 0
          const accountSellPlan: { accountId: string; amount: number; account?: any }[] = []

          for (const accEntry of accountsList) {
            if (remaining <= 0) break
            const sellFromAccount = Math.min(accEntry.totalValue, remaining)
            if (sellFromAccount <= 0) continue
            accountSellPlan.push({ accountId: accEntry.id, amount: sellFromAccount, account: accEntry.account })
            remaining -= sellFromAccount
          }

            // Compute tax impact and loss benefit for amounts sold from taxable accounts, per-lot
            let gainTaxSum = 0
            let lossBenefitSum = 0
            const now = new Date()
            const SHORT_TERM_DAYS = 365
            const SHORT_TERM_RATE = 0.37
            const LONG_TERM_RATE = 0.15

            accountSellPlan.forEach(plan => {
              const acc = accountMap.get(plan.accountId)!
              const accTotalValue = acc.totalValue || 0
              if (accTotalValue <= 0) return
              const sellRatioForAccount = plan.amount / accTotalValue
              acc.lots.forEach((lot: any) => {
                const lotSellValue = lot.lotValue * sellRatioForAccount
                const lotCostSoldPortion = lot.lotCost * (lotSellValue / (lot.lotValue || 1) || 0)
                const lotGain = lotSellValue - lotCostSoldPortion
                const accTaxStatus = acc.tax_status || (acc.account && acc.account.tax_status)
                if (accTaxStatus === 'Taxable') {
                  let lotRate = LONG_TERM_RATE
                  if (lot.purchase_date) {
                    const ageDays = Math.floor((now.getTime() - new Date(lot.purchase_date).getTime()) / (1000 * 60 * 60 * 24))
                    if (ageDays < SHORT_TERM_DAYS) lotRate = SHORT_TERM_RATE
                  }
                  if (lotGain > 0) {
                    gainTaxSum += lotGain * lotRate
                  } else if (lotGain < 0) {
                    lossBenefitSum += Math.abs(lotGain) * lotRate
                  }
                }
              })
            })

            // net = gains tax - loss benefit; show negative for tax payable, positive for tax benefit
            const net = gainTaxSum - lossBenefitSum
            taxImpact = lossBenefitSum - gainTaxSum

          // Build recommended accounts list with amounts to sell per account
          // Include account holding value and lot ids used in recommendation
          recommendedAccounts = accountSellPlan.map(p => ({
            id: p.accountId,
            name: p.account?.name || 'Account',
            type: p.account?.type || 'Account',
            amount: p.amount,
            holding_value: accountMap.get(p.accountId)?.totalValue || 0,
            lot_ids: (accountMap.get(p.accountId)?.lots || []).map((l: any) => l.id).filter(Boolean),
            reason: isNetGain ? 'Prioritize tax-advantaged holdings to limit taxable gains' : 'Prioritize taxable holdings to realize losses'
          }))
          taxNotes = taxImpact > 0 ? `Estimated capital gains tax on taxable portion: $${taxImpact.toFixed(2)}` : 'Potential tax-loss harvesting opportunity'

          // Smart reinvestment suggestions: cascade proceeds into underweight assets in same sub-portfolio by drift %
          const proceeds = Math.max(0, (allocation.amount || 0) + (taxImpact || 0))
          const underweightAssets = allocations
            .filter((a: any) => a.action === 'buy' && a.sub_portfolio_id === allocation.sub_portfolio_id)
            .sort((a: any, b: any) => Math.abs(b.drift_percentage) - Math.abs(a.drift_percentage))
          const suggestions: any[] = []
          let remainingProceeds = proceeds
          for (const asset of underweightAssets) {
            if (remainingProceeds <= 0) break
            const needed = asset.amount || 0
            const take = Math.min(needed, remainingProceeds)
            if (take <= 0) continue
            const price = latestPrices.get(asset.asset_id)?.price || 0
            const shares = price > 0 ? take / price : 0
            suggestions.push({ asset_id: asset.asset_id, ticker: asset.ticker, name: asset.name, suggested_amount: take, suggested_shares: shares, reason: `Underweight by ${Math.abs(asset.drift_percentage).toFixed(2)}% — highest drift prioritized` })
            remainingProceeds -= take
          }
          reinvestmentSuggestions = suggestions
        }
      }

      if (allocation.action === 'sell') {
        console.log(`Sell allocation: asset=${allocation.asset_id}, amount=${allocation.amount}, taxImpact=${taxImpact}, proceeds=${Math.max(0, (allocation.amount || 0) + taxImpact)}`)
      }

      return {
        asset_id: allocation.asset_id,
        sub_portfolio_id: allocation.sub_portfolio_id,
        tax_impact: taxImpact,
        recommended_accounts: recommendedAccounts,
        tax_notes: taxNotes,
        reinvestment_suggestions: reinvestmentSuggestions
      }
    })

    // Post-process taxUpdates per sub-portfolio to produce consolidated, netted suggestions
    const grouped = new Map<string, any[]>()
    taxUpdates.forEach((t: any) => {
      const key = t.sub_portfolio_id || 'unassigned'
      if (!grouped.has(key)) grouped.set(key, [])
      grouped.get(key)!.push(t)
    })

    grouped.forEach((group) => {
      const totalSellProceeds = group.filter((g: any) => g.action === 'sell').reduce((s: number, g: any) => s + Math.max(0, (g.amount || 0) + (g.tax_impact || 0)), 0)
      const totalBuyNeeds = group.filter((g: any) => g.action === 'buy').reduce((s: number, g: any) => s + (g.amount || 0), 0)
      let remainingProceeds = Math.max(0, totalSellProceeds - totalBuyNeeds)

      // Fund buys first
      const buys = group.filter((g: any) => g.action === 'buy').sort((a: any, b: any) => Math.abs(b.drift_percentage) - Math.abs(a.drift_percentage))
      const suggestions: any[] = []
      let fundingPool = totalSellProceeds
      for (const b of buys) {
        if (fundingPool <= 0) break
        const take = Math.min(b.amount || 0, fundingPool)
        const price = latestPrices.get(b.asset_id)?.price || 0
        const shares = price > 0 ? take / price : 0
        if (take > 0) suggestions.push({ asset_id: b.asset_id, ticker: b.ticker, name: b.name, suggested_amount: take, suggested_shares: shares, reason: `Fund buy: ${Math.abs(b.drift_percentage || 0).toFixed(2)}% underweight` })
        fundingPool -= take
      }

      if (remainingProceeds > 0) {
        const underweights = group.filter((g: any) => g.action === 'buy').sort((a: any, b: any) => Math.abs(b.drift_percentage) - Math.abs(a.drift_percentage))
        let rem = remainingProceeds
        for (const u of underweights) {
          if (rem <= 0) break
          const needed = u.amount || 0
          const already = suggestions.reduce((s, it) => s + (it.asset_id === u.asset_id ? it.suggested_amount : 0), 0)
          const want = Math.max(0, needed - already)
          const take = Math.min(want, rem)
          if (take > 0) {
            const price = latestPrices.get(u.asset_id)?.price || 0
            const shares = price > 0 ? take / price : 0
            suggestions.push({ asset_id: u.asset_id, ticker: u.ticker, name: u.name, suggested_amount: take, suggested_shares: shares, reason: `Deploy remaining proceeds to ${u.ticker} (underweight ${Math.abs(u.drift_percentage || 0).toFixed(2)}%)` })
            rem -= take
          }
        }
      }

      console.log(`Recalc Sub-portfolio ${group[0]?.sub_portfolio_id || 'unknown'}: totalSellProceeds=${totalSellProceeds}, totalBuyNeeds=${totalBuyNeeds}, remainingProceeds=${remainingProceeds}, suggestions.length=${suggestions.length}`)

      const firstSell = group.find((g: any) => g.action === 'sell')
      if (firstSell) {
        firstSell.reinvestment_suggestions = suggestions
        group.forEach((g: any) => { if (g !== firstSell) g.reinvestment_suggestions = [] })
      } else {
        const firstBuy = group.find((g: any) => g.action === 'buy')
        if (firstBuy) {
          firstBuy.reinvestment_suggestions = suggestions
          group.forEach((g: any) => { if (g !== firstBuy) g.reinvestment_suggestions = [] })
        } else {
          group.forEach((g: any) => { g.reinvestment_suggestions = [] })
        }
      }
    })

    return NextResponse.json(taxUpdates)
  } catch (error) {
    console.error('Error recalculating tax data:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}