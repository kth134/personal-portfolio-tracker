import { supabaseServer } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import AccountsList from '@/components/AccountsList'
import AssetsList from '@/components/AssetsList'
import PortfolioHoldingsClient from './portfolio/PortfolioHoldingsClient'

// Updated types to reflect new schema
type AssetDetail = {
  ticker: string
  name: string | null
  asset_subtype: string | null
  sub_portfolio_id: string | null
  sub_portfolio: { name: string } | null
}
type TaxLot = {
  asset_id: string
  account_id: string
  remaining_quantity: number
  cost_basis_per_unit: number
  asset: AssetDetail
}
type Holding = {
  asset_id: string
  ticker: string
  name: string | null
  total_quantity: number
  total_basis: number
  current_price?: number
  current_value?: number
  unrealized_gain: number
}
type GroupedHolding = {
  key: string // account name or sub_portfolio name
  holdings: Holding[]
  total_basis: number
  total_value: number
  unrealized_gain: number
}

export default async function PortfolioPage() {
  const supabase = await supabaseServer()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/')

  // Updated query: Join sub_portfolios to get name for grouping/display
  const [lotsRes, accountsRes, assetsRes, transactionsRes] = await Promise.all([
    supabase
      .from('tax_lots')
      .select(`
        asset_id, 
        account_id, 
        remaining_quantity, 
        cost_basis_per_unit, 
        asset:assets (
          ticker, 
          name, 
          asset_subtype, 
          sub_portfolio_id,
          sub_portfolio:sub_portfolios (name)
        )
      `)
      .gt('remaining_quantity', 0)
      .eq('user_id', user.id),
    supabase.from('accounts').select('*').eq('user_id', user.id),
    supabase.from('assets').select('*').eq('user_id', user.id),
    supabase.from('transactions').select('*').eq('user_id', user.id)
  ])

  const lots = lotsRes.data as TaxLot[] | null
  const initialAccounts = accountsRes.data || []
  const initialAssets = assetsRes.data || []
  const transactions = transactionsRes.data || []

  // Compute cash balances per account (unchanged)
  const cashBalances = new Map<string, number>()
  transactions.forEach(tx => {
    if (!tx.account_id) return
    const current = cashBalances.get(tx.account_id) || 0
    let delta = Number(tx.amount || 0)
    if (tx.type === 'Buy' && tx.funding_source === 'cash') delta = -Math.abs(Number(tx.amount || 0))
    cashBalances.set(tx.account_id, current + delta)
  })
  const totalCash = Array.from(cashBalances.values()).reduce((sum, bal) => sum + bal, 0)

  // Fetch latest prices (unchanged)
  const uniqueTickers = new Set(lots?.map(lot => lot.asset.ticker) || [])
  const { data: pricesList } = await supabase
    .from('asset_prices')
    .select('ticker, price, timestamp')
    .in('ticker', Array.from(uniqueTickers))
    .order('timestamp', { ascending: false })

  const latestPrices = new Map<string, number>()
  pricesList?.forEach(p => {
    if (!latestPrices.has(p.ticker)) {
      latestPrices.set(p.ticker, p.price)
    }
  })

  // Process holdings (unchanged logic)
  const holdingsMap = new Map<string, Holding>()
  let investedTotalBasis = 0
  let investedCurrentValue = 0
  if (lots) {
    for (const lot of lots) {
      const key = lot.asset_id
      const qty = Number(lot.remaining_quantity)
      const basisPer = Number(lot.cost_basis_per_unit)
      const basisThisLot = qty * basisPer
      investedTotalBasis += basisThisLot

      const assetDetail = lot.asset
      const currentPrice = latestPrices.get(assetDetail.ticker) || 0
      const valueThisLot = qty * currentPrice

      if (holdingsMap.has(key)) {
        const existing = holdingsMap.get(key)!
        existing.total_quantity += qty
        existing.total_basis += basisThisLot
        existing.current_value = (existing.current_value || 0) + valueThisLot
      } else {
        holdingsMap.set(key, {
          asset_id: key,
          ticker: assetDetail.ticker,
          name: assetDetail.name,
          total_quantity: qty,
          total_basis: basisThisLot,
          current_price: currentPrice,
          current_value: valueThisLot,
          unrealized_gain: valueThisLot - basisThisLot,
        })
      }
      investedCurrentValue += valueThisLot
    }
  }
  const investedHoldings: Holding[] = Array.from(holdingsMap.values()).map(h => ({
    ...h,
    unrealized_gain: (h.current_value || 0) - h.total_basis,
  }))
  const grandTotalBasis = investedTotalBasis + totalCash
  const grandTotalValue = investedCurrentValue + totalCash
  const overallUnrealized = grandTotalValue - grandTotalBasis

  // Precompute grouped data (updated to use sub_portfolio.name)
  const accountMap = new Map(initialAccounts.map(a => [a.id, a.name]))
  const groupedByAccount: GroupedHolding[] = []
  const groupedBySubPortfolio: GroupedHolding[] = []
  if (lots) {
    const accHoldings = new Map<string, { holdings: Map<string, Holding>, total_basis: number, total_value: number }>()
    const subHoldings = new Map<string, { holdings: Map<string, Holding>, total_basis: number, total_value: number }>()

    for (const lot of lots) {
      const assetKey = lot.asset_id
      const accKey = accountMap.get(lot.account_id) || 'Unknown'
      const subKey = lot.asset.sub_portfolio?.name || 'Untagged'
      const qty = Number(lot.remaining_quantity)
      const basisThis = qty * Number(lot.cost_basis_per_unit)
      const currentPrice = latestPrices.get(lot.asset.ticker) || 0
      const valueThis = qty * currentPrice

      // Group by account (unchanged)
      if (!accHoldings.has(accKey)) accHoldings.set(accKey, { holdings: new Map(), total_basis: 0, total_value: 0 })
      const accGroup = accHoldings.get(accKey)!
      if (!accGroup.holdings.has(assetKey)) {
        accGroup.holdings.set(assetKey, {
          asset_id: assetKey,
          ticker: lot.asset.ticker,
          name: lot.asset.name,
          total_quantity: 0,
          total_basis: 0,
          current_price: currentPrice,
          current_value: 0,
          unrealized_gain: 0,
        })
      }
      const accAsset = accGroup.holdings.get(assetKey)!
      accAsset.total_quantity += qty
      accAsset.total_basis += basisThis
      accAsset.current_value! += valueThis
      accAsset.unrealized_gain = accAsset.current_value! - accAsset.total_basis
      accGroup.total_basis += basisThis
      accGroup.total_value += valueThis

      // Group by sub-portfolio name (updated)
      if (!subHoldings.has(subKey)) subHoldings.set(subKey, { holdings: new Map(), total_basis: 0, total_value: 0 })
      const subGroup = subHoldings.get(subKey)!
      if (!subGroup.holdings.has(assetKey)) {
        subGroup.holdings.set(assetKey, {
          asset_id: assetKey,
          ticker: lot.asset.ticker,
          name: lot.asset.name,
          total_quantity: 0,
          total_basis: 0,
          current_price: currentPrice,
          current_value: 0,
          unrealized_gain: 0,
        })
      }
      const subAsset = subGroup.holdings.get(assetKey)!
      subAsset.total_quantity += qty
      subAsset.total_basis += basisThis
      subAsset.current_value! += valueThis
      subAsset.unrealized_gain = subAsset.current_value! - subAsset.total_basis
      subGroup.total_basis += basisThis
      subGroup.total_value += valueThis
    }

    // Add cash to account groups (unchanged)
    for (const [accId, bal] of cashBalances) {
      const accKey = accountMap.get(accId) || 'Unknown'
      if (!accHoldings.has(accKey)) accHoldings.set(accKey, { holdings: new Map(), total_basis: 0, total_value: 0 })
      const accGroup = accHoldings.get(accKey)!
      accGroup.holdings.set('cash', {
        asset_id: 'cash',
        ticker: 'Cash',
        name: null,
        total_quantity: 0,
        total_basis: bal,
        current_price: 1,
        current_value: bal,
        unrealized_gain: 0,
      })
      accGroup.total_basis += bal
      accGroup.total_value += bal
    }

    // Convert to arrays (unchanged)
    groupedByAccount.push(...Array.from(accHoldings, ([key, g]) => ({
      key,
      holdings: Array.from(g.holdings.values()),
      total_basis: g.total_basis,
      total_value: g.total_value,
      unrealized_gain: g.total_value - g.total_basis
    })))
    groupedBySubPortfolio.push(...Array.from(subHoldings, ([key, g]) => ({
      key,
      holdings: Array.from(g.holdings.values()),
      total_basis: g.total_basis,
      total_value: g.total_value,
      unrealized_gain: g.total_value - g.total_basis
    })))
  }

  return (
    <main className="p-8">
      <h1 className="text-3xl font-bold mb-8">Portfolio</h1>
      <Tabs defaultValue="holdings">
        <TabsList>
          <TabsTrigger value="holdings">Holdings</TabsTrigger>
          <TabsTrigger value="accounts">Accounts</TabsTrigger>
          <TabsTrigger value="assets">Assets</TabsTrigger>
        </TabsList>
        <TabsContent value="holdings">
          <PortfolioHoldingsClient
            groupedAccounts={groupedByAccount}
            groupedSubs={groupedBySubPortfolio}
            cash={totalCash}
            grandTotalBasis={grandTotalBasis}
            grandTotalValue={grandTotalValue}
            overallUnrealized={overallUnrealized}
          />
        </TabsContent>
        <TabsContent value="accounts">
          <AccountsList initialAccounts={initialAccounts} />
        </TabsContent>
        <TabsContent value="assets">
          <AssetsList initialAssets={initialAssets} />
        </TabsContent>
      </Tabs>
    </main>
  )
}