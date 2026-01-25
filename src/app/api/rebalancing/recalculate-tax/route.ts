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

    // Fetch tax lots for cost basis calculations
    const { data: detailedTaxLots } = await supabase
      .from('tax_lots')
      .select(`
        asset_id,
        remaining_quantity,
        cost_basis_per_unit,
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
        // Calculate tax impact for selling
        const assetTaxLots = detailedTaxLots?.filter((lot: any) =>
          lot.asset_id === allocation.asset_id && lot.account_id
        ) || []

        let totalCostBasis = 0
        let estimatedGain = 0

        // Calculate weighted average cost basis
        assetTaxLots.forEach((lot: any) => {
          const lotCostBasis = lot.remaining_quantity * lot.cost_basis_per_unit
          totalCostBasis += lotCostBasis

          const currentPrice = latestPrices.get(lot.asset_id)?.price || 0
          const lotValue = lot.remaining_quantity * currentPrice
          const sellRatio = currentPrice > 0 ? Math.min(1, allocation.amount / lotValue) : 0
          estimatedGain += (lotValue * sellRatio) - (lotCostBasis * sellRatio)
        })

        // Estimate capital gains tax (simplified - long-term rate)
        taxImpact = Math.max(0, estimatedGain) * 0.15 // 15% long-term capital gains rate

        // Recommend accounts for selling (prioritize taxable accounts)
        const sellAccounts = accounts?.filter((acc: any) => acc.tax_status === 'Taxable') || []
        recommendedAccounts = sellAccounts.slice(0, 2).map((acc: any) => ({
          id: acc.id,
          name: acc.name,
          type: acc.type,
          reason: 'Taxable account preferred for potential tax-loss harvesting'
        }))

        taxNotes = taxImpact > 0 ? 'Capital gains tax estimated' : 'Potential tax-loss harvesting opportunity'
      } else if (allocation.action === 'buy') {
        // For buying, recommend tax-advantaged accounts
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