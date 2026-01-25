import { createClient } from '@/lib/supabase/server'
import { NextRequest, NextResponse } from 'next/server'

export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const { allocations, totalValue } = await request.json()

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

      if (allocation.action === 'sell') {
        // Get all lots for this asset grouped by account
        const assetTaxLots = (detailedTaxLots || []).filter((lot: any) => lot.asset_id === allocation.asset_id && lot.account_id)

        const accountMap = new Map<string, { lots: any[]; totalValue: number; totalCostBasis: number; tax_status?: string; account?: any }>()
        const price = latestPrices.get(allocation.asset_id)?.price || 0

        assetTaxLots.forEach((lot: any) => {
          const accId = lot.account_id
          const lotValue = price * lot.remaining_quantity
          const lotCost = lot.remaining_quantity * lot.cost_basis_per_unit
          if (!accountMap.has(accId)) {
            const acc = accounts?.find((a: any) => a.id === accId)
            accountMap.set(accId, { lots: [], totalValue: 0, totalCostBasis: 0, tax_status: acc?.tax_status, account: acc })
          }
          const entry = accountMap.get(accId)!
          entry.lots.push({ ...lot, lotValue, lotCost })
          entry.totalValue += lotValue
          entry.totalCostBasis += lotCost
        })

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
          // Recommend accounts by tax_status available in user's accounts
          const sellAccounts = (accounts || []).filter((acc: any) => acc.tax_status === 'Taxable')
          recommendedAccounts = sellAccounts.slice(0, 2).map((acc: any) => ({ id: acc.id, name: acc.name, type: acc.type, reason: 'Taxable account preferred for potential tax-loss harvesting' }))
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

            // Compute gains only for amounts sold from taxable accounts, applying per-lot tax rates
            let taxableTaxSum = 0
            const now = new Date()
            const SHORT_TERM_DAYS = 365
            const SHORT_TERM_RATE = 0.37
            const LONG_TERM_RATE = 0.15

            accountSellPlan.forEach(plan => {
              const acc = accountMap.get(plan.accountId)!
              const accTotalValue = acc.totalValue || 0
              if (accTotalValue <= 0) return
              const sellRatioForAccount = plan.amount / accTotalValue
              // Distribute sell across lots proportionally and sum tax for taxable lots
              acc.lots.forEach((lot: any) => {
                const lotSellValue = lot.lotValue * sellRatioForAccount
                const lotCostSoldPortion = lot.lotCost * (lotSellValue / (lot.lotValue || 1) || 0)
                const lotGain = lotSellValue - lotCostSoldPortion
                const accTaxStatus = acc.tax_status || (acc.account && acc.account.tax_status)
                if (accTaxStatus === 'Taxable') {
                  // Determine lot age to choose tax rate
                  let lotRate = LONG_TERM_RATE
                  if (lot.purchase_date) {
                    const ageDays = Math.floor((now.getTime() - new Date(lot.purchase_date).getTime()) / (1000 * 60 * 60 * 24))
                    if (ageDays < SHORT_TERM_DAYS) lotRate = SHORT_TERM_RATE
                  }
                  taxableTaxSum += Math.max(0, lotGain) * lotRate
                }
              })
            })

            taxImpact = Math.max(0, taxableTaxSum)

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
        }
      } else if (allocation.action === 'buy') {
        // For buying, recommend tax-advantaged accounts where the user actually holds assets or any tax-advantaged accounts
        const buyAccounts = accounts?.filter((acc: any) => acc.tax_status !== 'Taxable') || []
        recommendedAccounts = buyAccounts.slice(0, 2).map((acc: any) => ({
          id: acc.id,
          name: acc.name,
          type: acc.type,
          reason: 'Tax-advantaged account preferred for buying'
        }))

        taxNotes = 'Consider tax-advantaged accounts for purchases'
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

    return NextResponse.json(taxUpdates)
  } catch (error) {
    console.error('Error recalculating tax data:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}