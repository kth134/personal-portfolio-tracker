import { supabaseServer } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import AccountsList from '@/components/AccountsList'
import AssetsList from '@/components/AssetsList'
import PortfolioHoldingsClient from './PortfolioHoldingsClient'

// Reuse types, but extend AssetDetail with sub_portfolio and account_id on TaxLot
type AssetDetail = {
  ticker: string
  name: string | null
  asset_subtype: string | null
  sub_portfolio: string | null
}
type TaxLot = {
  asset_id: string
  account_id: string // Add for account grouping
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
  unrealized_gain: number // Changed to required
}
type GroupedHolding = {
  key: string // account name or sub_portfolio
  holdings: Holding[]
  total_basis: number
  total_value: number
  unrealized_gain: number
}

export default async function PortfolioPage() {
  const supabase = await supabaseServer()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/')

  // Fetch with account_id and sub_portfolio
  const [lotsRes, accountsRes, assetsRes, cashRes] = await Promise.all([
    supabase.from('tax_lots').select(`asset_id, account_id, remaining_quantity, cost_basis_per_unit, asset:assets (ticker, name, asset_subtype, sub_portfolio)`).gt('remaining_quantity', 0).eq('user_id', user.id),
    supabase.from('accounts').select('*').eq('user_id', user.id),
    supabase.from('assets').select('*').eq('user_id', user.id),
    supabase.from('transactions').select('amount').eq('user_id', user.id).eq('type', 'Cash')
  ])

  const lots = lotsRes.data as TaxLot[] | null
  const initialAccounts = accountsRes.data || []
  const initialAssets = assetsRes.data || []
  const cashBalance = cashRes.data?.reduce((sum, tx) => sum + Number(tx.amount || 0), 0) || 0

// Fetch latest prices for all unique tickers at once (optimized)
const uniqueTickers = new Set(lots?.map(lot => lot.asset.ticker) || []);
const { data: pricesList } = await supabase
  .from('asset_prices')
  .select('ticker, price, timestamp')
  .in('ticker', Array.from(uniqueTickers))
  .order('timestamp', { ascending: false });  // New: Sort DESC for latest first

// Map to latest price per ticker (take first after sort)
const latestPrices = new Map<string, number>();
pricesList?.forEach(p => {
  if (!latestPrices.has(p.ticker)) {
    latestPrices.set(p.ticker, p.price);  // Only set if not already (since sorted DESC)
  }
});

  // Process flat holdings (for reference, though not used in view anymore)
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
      const currentPrice = latestPrices.get(assetDetail.ticker) || 0 // Use fetched price or 0
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
  const grandTotalBasis = investedTotalBasis + cashBalance
  const grandTotalValue = investedCurrentValue + cashBalance
  const overallUnrealized = grandTotalValue - grandTotalBasis

  // Precompute grouped data for client
  const accountMap = new Map(initialAccounts.map(a => [a.id, a.name]))
  const groupedByAccount: GroupedHolding[] = []
  const groupedBySubPortfolio: GroupedHolding[] = []
  if (lots) {
    const accHoldings = new Map<string, { holdings: Map<string, Holding>, total_basis: number, total_value: number }>()
    const subHoldings = new Map<string, { holdings: Map<string, Holding>, total_basis: number, total_value: number }>()
    for (const lot of lots) {
      const assetKey = lot.asset_id
      const accKey = accountMap.get(lot.account_id) || 'Unknown'
      const subKey = lot.asset.sub_portfolio || 'Untagged'
      const qty = Number(lot.remaining_quantity)
      const basisThis = qty * Number(lot.cost_basis_per_unit)
      const currentPrice = latestPrices.get(lot.asset.ticker) || 0
      const valueThis = qty * currentPrice

      // Group by account
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
      accAsset.unrealized_gain = (accAsset.current_value || 0) - accAsset.total_basis
      accGroup.total_basis += basisThis
      accGroup.total_value += valueThis

      // Group by sub-portfolio (similar)
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
      subAsset.unrealized_gain = (subAsset.current_value || 0) - subAsset.total_basis
      subGroup.total_value += valueThis
    }

    // Convert to arrays
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
            cash={cashBalance}
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