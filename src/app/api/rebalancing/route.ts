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

    // Fetch detailed tax lots for cost basis calculations (include id and purchase_date)
    const { data: detailedTaxLots } = await supabase
      .from('tax_lots')
      .select(`
        id,
        asset_id,
        remaining_quantity,
        cost_basis_per_unit,
        purchase_date,
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
          }
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

    const holdingsValue = taxLots?.reduce((sum, lot) => {
      const price = latestPrices.get(lot.asset.ticker)?.price || 0
      return sum + (lot.remaining_quantity * price)
    }, 0) || 0
    // Exclude cash from total portfolio value for rebalancing calculations (assume fully invested)
    const totalValue = holdingsValue

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

        // Calculate target value and transaction amount
        // Target value = (Total sub-portfolio value * target allocation % of the asset) / 100
        const targetValue = (subValue * assetTarget) / 100
        const transactionAmount = Math.abs(targetValue - item.current_value)

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

        // Action logic based on drift percentage and thresholds
        if (driftPercentage <= -Math.abs(downsideThreshold)) {
          action = 'buy'
        } else if (driftPercentage >= Math.abs(upsideThreshold)) {
          action = 'sell'
        } else {
          action = 'hold'
        }

        // Calculate transaction amount based on band mode
        if (action === 'buy' || action === 'sell') {
          if (bandMode) {
            // Band mode: calculate amount to get back to threshold
            const targetDrift = action === 'sell' ? upsideThreshold : -downsideThreshold
            const targetPercentage = assetTarget * (1 + targetDrift / 100)
            const targetValue = (subValue * targetPercentage) / 100
            amount = Math.abs(targetValue - item.current_value)
          } else {
            // Full rebalancing: calculate amount to reach exact target
            amount = transactionAmount
          }
        }

        allocations.push({
          ...item,
          current_percentage: currentOverallPercentage,
          sub_portfolio_percentage: subPortfolioPercentage,
          sub_portfolio_target_percentage: assetTarget,
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

      if (allocation.action === 'buy') {
        // For buys, recommend tax-advantaged accounts and suggest sell sources to generate required cash
        const buyAccounts = accounts?.filter(acc => acc.tax_status === 'Tax-Advantaged') || []
        recommendedAccounts = buyAccounts.map(acc => ({
          id: acc.id,
          name: acc.name,
          type: acc.type,
          reason: 'Tax-advantaged account preferred for tax-deferred growth'
        }))

        taxNotes = 'Use tax-advantaged accounts for long-term tax benefits.'

        // Funding suggestions: pick portfolio sell candidates to raise required buy amount
        const sellCandidates = allocations.filter(a => a.action === 'sell' && a.amount > 0).sort((a, b) => b.amount - a.amount)
        let remainingNeed = allocation.amount || 0
        const fundingSuggestions: any[] = []
        for (const cand of sellCandidates) {
          if (remainingNeed <= 0) break
          const take = Math.min(cand.amount, remainingNeed)
          const price = latestPrices.get(cand.ticker)?.price || 0
          const shares = price > 0 ? take / price : 0
          fundingSuggestions.push({ asset_id: cand.asset_id, ticker: cand.ticker, name: cand.name, suggested_amount: take, suggested_shares: shares, reason: `Sell to fund buy of ${allocation.ticker}` })
          remainingNeed -= take
        }
        if (fundingSuggestions.length > 0) {
          reinvestmentSuggestions = fundingSuggestions
        }
      } else if (allocation.action === 'sell') {
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

        if (accountMap.size === 0) {
          // Fallback: proportional across lots, apply per-lot rates
          const now = new Date()
          const SHORT_TERM_DAYS = 365
          const SHORT_TERM_RATE = 0.37
          const LONG_TERM_RATE = 0.15
          let gainTaxSum = 0
          let lossBenefitSum = 0
          assetTaxLots.forEach((lot: any) => {
            const lotCostBasis = lot.remaining_quantity * lot.cost_basis_per_unit
            const lotValue = lot.remaining_quantity * price
            const sellRatio = price > 0 ? Math.min(1, allocation.amount / lotValue) : 0
            const lotGain = (lotValue * sellRatio) - (lotCostBasis * sellRatio)
            let lotRate = LONG_TERM_RATE
            if (lot.purchase_date) {
              const ageDays = Math.floor((now.getTime() - new Date(lot.purchase_date).getTime()) / (1000 * 60 * 60 * 24))
              if (ageDays < SHORT_TERM_DAYS) lotRate = SHORT_TERM_RATE
            }
            if (lotGain > 0) gainTaxSum += lotGain * lotRate
            else if (lotGain < 0) lossBenefitSum += Math.abs(lotGain) * lotRate
          })
          taxImpact = lossBenefitSum - gainTaxSum
          // Recommend taxable accounts if available
          const sellAccounts = accounts?.filter(acc => acc.tax_status === 'Taxable') || []
          recommendedAccounts = sellAccounts.map(acc => ({ id: acc.id, name: acc.name, type: acc.type, reason: 'Taxable account preferred for potential tax-loss harvesting' }))
        } else {
          // Determine net unrealized gain/loss across holdings
          let totalUnrealizedGain = 0
          accountMap.forEach(entry => { totalUnrealizedGain += (entry.totalValue - entry.totalCostBasis) })
          const isNetGain = totalUnrealizedGain > 0

          // Sort accounts by priority (net gain -> prefer tax-advantaged; net loss -> prefer taxable)
          const accountsList = Array.from(accountMap.entries()).map(([id, entry]) => ({ id, ...entry }))
          accountsList.sort((a, b) => {
            if (isNetGain) {
              const aAdv = a.tax_status && a.tax_status !== 'Taxable'
              const bAdv = b.tax_status && b.tax_status !== 'Taxable'
              if (aAdv && !bAdv) return -1
              if (!aAdv && bAdv) return 1
            } else {
              const aTax = a.tax_status === 'Taxable'
              const bTax = b.tax_status === 'Taxable'
              if (aTax && !bTax) return -1
              if (!aTax && bTax) return 1
            }
            return b.totalValue - a.totalValue
          })

          let remaining = allocation.amount || 0
          const accountSellPlan: { accountId: string; amount: number; account?: any }[] = []
          for (const accEntry of accountsList) {
            if (remaining <= 0) break
            const sellFromAccount = Math.min(accEntry.totalValue, remaining)
            if (sellFromAccount <= 0) continue
            accountSellPlan.push({ accountId: accEntry.id, amount: sellFromAccount, account: accEntry.account })
            remaining -= sellFromAccount
          }

          // Compute tax impact and loss benefit for taxable accounts, per-lot
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
              if (acc.tax_status === 'Taxable') {
                let lotRate = LONG_TERM_RATE
                if (lot.purchase_date) {
                  const ageDays = Math.floor((now.getTime() - new Date(lot.purchase_date).getTime()) / (1000 * 60 * 60 * 24))
                  if (ageDays < SHORT_TERM_DAYS) lotRate = SHORT_TERM_RATE
                }
                if (lotGain > 0) gainTaxSum += lotGain * lotRate
                else if (lotGain < 0) lossBenefitSum += Math.abs(lotGain) * lotRate
              }
            })
          })

          // net = gains tax - loss benefit; taxImpact = lossBenefit - gainTax (positive benefit, negative payable)
          taxImpact = lossBenefitSum - gainTaxSum

          // Recommended accounts with holding values and lot ids used
          recommendedAccounts = accountSellPlan.map(p => ({
            id: p.accountId,
            name: p.account?.name || 'Account',
            type: p.account?.type || 'Account',
            amount: p.amount,
            holding_value: accountMap.get(p.accountId)?.totalValue || 0,
            lot_ids: (accountMap.get(p.accountId)?.lots || []).map((l: any) => l.id).filter(Boolean),
            reason: isNetGain ? 'Prioritize tax-advantaged holdings to limit taxable gains' : 'Prioritize taxable holdings to realize losses'
          }))

          // Smart reinvestment suggestions based on proceeds after estimated tax
          const proceeds = Math.max(0, (allocation.amount || 0) + (taxImpact || 0))
          const underweightAssets = allocations
            .filter(a => a.action === 'buy' && a.sub_portfolio_id === allocation.sub_portfolio_id)
            .sort((a, b) => Math.abs(b.drift_percentage) - Math.abs(a.drift_percentage))

          const suggestions: any[] = []
          let remainingProceeds = proceeds
          for (const asset of underweightAssets) {
            if (remainingProceeds <= 0) break
            const needed = asset.amount || 0
            const take = Math.min(needed, remainingProceeds)
            if (take <= 0) continue
            const price = latestPrices.get(asset.ticker)?.price || 0
            const shares = price > 0 ? take / price : 0
            suggestions.push({
              asset_id: asset.asset_id,
              ticker: asset.ticker,
              name: asset.name,
              suggested_amount: take,
              suggested_shares: shares,
              reason: `Underweight by ${Math.abs(asset.drift_percentage).toFixed(2)}% — highest drift prioritized`
            })
            remainingProceeds -= take
          }
          reinvestmentSuggestions = suggestions
        }
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

        // Smart funding suggestions: cascade sells from overweight assets in same sub-portfolio
        const need = allocation.amount || 0
        const sellSources = allocations
          .filter(a => a.sub_portfolio_id === allocation.sub_portfolio_id && a.action === 'sell')
          .sort((a, b) => Math.abs(b.drift_percentage) - Math.abs(a.drift_percentage))

        const funding: any[] = []
        let remainingNeed = need
        for (const src of sellSources) {
          if (remainingNeed <= 0) break
          const avail = src.amount || 0
          const take = Math.min(avail, remainingNeed)
          if (take <= 0) continue
          const price = latestPrices.get(src.ticker)?.price || 0
          const shares = price > 0 ? take / price : 0
          funding.push({ asset_id: src.asset_id, ticker: src.ticker, name: src.name, suggested_amount: take, suggested_shares: shares, reason: `Trim ${Math.abs(src.drift_percentage).toFixed(2)}% overweight first` })
          remainingNeed -= take
        }
        if (funding.length > 0) reinvestmentSuggestions = funding
      }

      return {
        ...allocation,
        tax_impact: taxImpact,
        reinvestment_suggestions: reinvestmentSuggestions,
        recommended_accounts: recommendedAccounts,
        tax_notes: taxNotes
      }
    })

    // Post-process enhancedAllocations to compute sub-portfolio netting and consolidated suggestions
    const groupedBySub = new Map<string, any[]>()
    enhancedAllocations.forEach((ea: any) => {
      const key = ea.sub_portfolio_id || 'unassigned'
      if (!groupedBySub.has(key)) groupedBySub.set(key, [])
      groupedBySub.get(key)!.push(ea)
    })

    groupedBySub.forEach((group, key) => {
      // compute total sell proceeds (after estimated tax) and total buy needs
      const totalSellProceeds = group.filter((g: any) => g.action === 'sell').reduce((s: number, g: any) => s + Math.max(0, (g.amount || 0) + (g.tax_impact || 0)), 0)
      const totalBuyNeeds = group.filter((g: any) => g.action === 'buy').reduce((s: number, g: any) => s + (g.amount || 0), 0)
      let remainingProceeds = Math.max(0, totalSellProceeds - totalBuyNeeds)

      // build suggestions: first, fund buys (these are essentially the buy allocations themselves, but include them for clarity)
      const buys = group.filter((g: any) => g.action === 'buy').sort((a: any, b: any) => Math.abs(b.drift_percentage) - Math.abs(a.drift_percentage))
      const suggestions: any[] = []
      let fundingPool = totalSellProceeds
      for (const b of buys) {
        if (fundingPool <= 0) break
        const take = Math.min(b.amount || 0, fundingPool)
        const price = latestPrices.get(b.ticker)?.price || 0
        const shares = price > 0 ? take / price : 0
        if (take > 0) suggestions.push({ asset_id: b.asset_id, ticker: b.ticker, name: b.name, suggested_amount: take, suggested_shares: shares, reason: `Fund buy: ${Math.abs(b.drift_percentage).toFixed(2)}% underweight` })
        fundingPool -= take
      }

      // if any proceeds remain after funding buys, cascade into remaining underweights by drift %
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
            const price = latestPrices.get(u.ticker)?.price || 0
            const shares = price > 0 ? take / price : 0
            suggestions.push({ asset_id: u.asset_id, ticker: u.ticker, name: u.name, suggested_amount: take, suggested_shares: shares, reason: `Deploy remaining proceeds to ${u.ticker} (underweight ${Math.abs(u.drift_percentage).toFixed(2)}%)` })
            rem -= take
          }
        }
      }

      // attach consolidated suggestions to the first sell allocation in group (so UI shows them once)
      const firstSell = group.find((g: any) => g.action === 'sell')
      if (firstSell) {
        firstSell.reinvestment_suggestions = suggestions
        // clear reinvestment suggestions from other allocations to avoid duplication
        group.forEach((g: any) => { if (g !== firstSell) g.reinvestment_suggestions = [] })
      } else {
        // no sells: attach consolidated suggestions to the first buy allocation so UI can display them
        const firstBuy = group.find((g: any) => g.action === 'buy')
        if (firstBuy) {
          firstBuy.reinvestment_suggestions = suggestions
          group.forEach((g: any) => { if (g !== firstBuy) g.reinvestment_suggestions = [] })
        } else {
          // nothing actionable: clear any reinvestment suggestions
          group.forEach((g: any) => { g.reinvestment_suggestions = [] })
        }
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