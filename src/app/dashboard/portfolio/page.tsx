import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import AccountsList from '@/components/AccountsList'
import AssetsList from '@/components/AssetsList'
import PortfolioHoldingsClient from './PortfolioHoldingsClient'
import SubPortfoliosList from '@/components/SubPortfoliosList'

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
  realized_gain: number
  dividends: number
  interest: number
  fees: number
  net_gain: number
}

type ClosedBreakdown = {
  realized: number
  dividends: number
  interest: number
  fees: number
}

type GroupedHolding = {
  key: string
  holdings: Holding[]
  total_basis: number
  total_value: number
  unrealized_gain: number
  closed_net: number
  closed_breakdown: ClosedBreakdown
  total_net_gain: number
}

export default async function PortfolioPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/')

  const [lotsRes, accountsRes, subPortfoliosRes, assetsRes, transactionsRes] = await Promise.all([
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
    supabase.from('sub_portfolios').select('*').eq('user_id', user.id),
    supabase.from('assets').select('*').eq('user_id', user.id),
    supabase.from('transactions').select('*').eq('user_id', user.id).order('date', { ascending: true }),
  ])

  const lots = lotsRes.data as TaxLot[] | null
  const initialAccounts = accountsRes.data || []
  const initialSubPortfolios = subPortfoliosRes.data || []
  const initialAssets = assetsRes.data || []
  const transactions = transactionsRes.data || []

  const accountMap = new Map(initialAccounts.map((a: any) => [a.id, a.name]))
  const assetMap = new Map(initialAssets.map((a: any) => [a.id, a]))

  // Cash balances
  const cashBalances = new Map<string, number>()
  transactions.forEach((tx: any) => {
    if (!tx.account_id) return
    const current = cashBalances.get(tx.account_id) || 0
    let delta = 0
    if (tx.type === 'Buy' && tx.funding_source === 'cash') delta -= Number(tx.amount || 0) + Number(tx.fees || 0)
    if (tx.type === 'Sell') delta += Number(tx.amount || 0) - Number(tx.fees || 0)
    if (tx.type === 'Dividend' || tx.type === 'Interest') delta += Number(tx.amount || 0)
    if (tx.type === 'Fee') delta -= Number(tx.amount || 0)
    // Add if you have 'Deposit'/'Withdrawal' types: delta +=/- tx.amount
    cashBalances.set(tx.account_id, current + delta)
  })
  const totalCash = Array.from(cashBalances.values()).reduce((sum, bal) => sum + (bal > 0 ? bal : 0), 0) // Ignore negative if any

  // Prices
  const uniqueTickers = new Set(lots?.map(lot => lot.asset.ticker) || [])
  const { data: pricesList } = await supabase
    .from('asset_prices')
    .select('ticker, price, timestamp')
    .in('ticker', Array.from(uniqueTickers))
    .order('timestamp', { ascending: false })

  const latestPrices = new Map<string, number>()
  pricesList?.forEach((p: any) => {
    if (!latestPrices.has(p.ticker)) latestPrices.set(p.ticker, p.price)
  })

  // Performance sums per asset-account (using stored realized_gain, fees, etc.)
  const performanceMap = new Map<string, {
    realized_gain: number
    dividends: number
    interest: number
    fees: number
  }>()

  transactions.forEach((tx: any) => {
    if (!tx.asset_id || !tx.account_id) return
    const key = `${tx.account_id}-${tx.asset_id}`
    if (!performanceMap.has(key)) performanceMap.set(key, { realized_gain: 0, dividends: 0, interest: 0, fees: 0 })
    const perf = performanceMap.get(key)!
    perf.realized_gain += Number(tx.realized_gain || 0)
    if (tx.type === 'Dividend') perf.dividends += Number(tx.amount || 0)
    if (tx.type === 'Interest') perf.interest += Number(tx.amount || 0)
    perf.fees += Number(tx.fees || 0)
  })

  // Build holdings from open lots
  const holdingsMap = new Map<string, Holding>()
  let investedTotalBasis = 0
  let investedCurrentValue = 0

  lots?.forEach(lot => {
    const assetKey = lot.asset_id
    const accKey = lot.account_id
    const perfKey = `${accKey}-${assetKey}`
    const perf = performanceMap.get(perfKey) || { realized_gain: 0, dividends: 0, interest: 0, fees: 0 }

    const qty = Number(lot.remaining_quantity)
    const basisThis = qty * Number(lot.cost_basis_per_unit)
    const currentPrice = latestPrices.get(lot.asset.ticker) || 0
    const valueThis = qty * currentPrice

    investedTotalBasis += basisThis
    investedCurrentValue += valueThis

    if (holdingsMap.has(assetKey)) {
      const h = holdingsMap.get(assetKey)!
      h.total_quantity += qty
      h.total_basis += basisThis
      h.current_value! += valueThis
      h.realized_gain += perf.realized_gain
      h.dividends += perf.dividends
      h.interest += perf.interest
      h.fees += perf.fees
    } else {
      holdingsMap.set(assetKey, {
        asset_id: assetKey,
        ticker: lot.asset.ticker,
        name: lot.asset.name,
        total_quantity: qty,
        total_basis: basisThis,
        current_price: currentPrice,
        current_value: valueThis,
        unrealized_gain: valueThis - basisThis,
        realized_gain: perf.realized_gain,
        dividends: perf.dividends,
        interest: perf.interest,
        fees: perf.fees,
        net_gain: 0, // calculated later
      })
    }
  })

  const investedHoldings = Array.from(holdingsMap.values())
  investedHoldings.forEach(h => {
    h.net_gain = h.unrealized_gain + h.realized_gain + h.dividends + h.interest - h.fees
  })

  const grandTotalBasis = investedTotalBasis + totalCash
  const grandTotalValue = investedCurrentValue + totalCash
  const overallUnrealized = grandTotalValue - grandTotalBasis

  // Grouped with closed aggregate
  const groupedByAccount: GroupedHolding[] = []
  const groupedBySubPortfolio: GroupedHolding[] = []

  const accGroups = new Map<string, GroupedHolding>()
  const subGroups = new Map<string, GroupedHolding>()

  // Open holdings grouping
  lots?.forEach(lot => {
    const assetKey = lot.asset_id
    const holding = holdingsMap.get(assetKey)!
    const accName = accountMap.get(lot.account_id) || 'Unknown'
    const subName = lot.asset.sub_portfolio?.name || 'Untagged'

    // Account group
    if (!accGroups.has(accName)) accGroups.set(accName, { key: accName, holdings: [], total_basis: 0, total_value: 0, unrealized_gain: 0, closed_net: 0, closed_breakdown: { realized: 0, dividends: 0, interest: 0, fees: 0 }, total_net_gain: 0 })
    const accG = accGroups.get(accName)!
    if (!accG.holdings.find(h => h.asset_id === assetKey)) accG.holdings.push(holding) // Dedupe if multi-account
    accG.total_basis += holding.total_basis
    accG.total_value += (holding.current_value || 0)
    accG.unrealized_gain += holding.unrealized_gain

    // Sub-portfolio group
    if (!subGroups.has(subName)) subGroups.set(subName, { key: subName, holdings: [], total_basis: 0, total_value: 0, unrealized_gain: 0, closed_net: 0, closed_breakdown: { realized: 0, dividends: 0, interest: 0, fees: 0 }, total_net_gain: 0 })
    const subG = subGroups.get(subName)!
    if (!subG.holdings.find(h => h.asset_id === assetKey)) subG.holdings.push(holding)
    subG.total_basis += holding.total_basis
    subG.total_value += (holding.current_value || 0)
    subG.unrealized_gain += holding.unrealized_gain
  })

  // Closed positions aggregation (using performanceMap for assets with no open lots but non-zero sums)
  for (const [key, perf] of performanceMap) {
    const net = perf.realized_gain + perf.dividends + perf.interest - perf.fees
    if (net === 0) continue

    const [accId, assetId] = key.split('-')
    const asset = assetMap.get(assetId)
    if (!asset) continue

    // Check if open
    const hasOpen = lots?.some(l => l.asset_id === assetId && l.account_id === accId)
    if (hasOpen) continue // Already in open holdings

    const accName = accountMap.get(accId) || 'Unknown'
    const subName = asset.sub_portfolio?.name || 'Untagged' // Assuming asset has sub_portfolio from join, but use map

    // Account closed
    if (!accGroups.has(accName)) accGroups.set(accName, { key: accName, holdings: [], total_basis: 0, total_value: 0, unrealized_gain: 0, closed_net: 0, closed_breakdown: { realized: 0, dividends: 0, interest: 0, fees: 0 }, total_net_gain: 0 })
    const accG = accGroups.get(accName)!
    accG.closed_net += net
    accG.closed_breakdown.realized += perf.realized_gain
    accG.closed_breakdown.dividends += perf.dividends
    accG.closed_breakdown.interest += perf.interest
    accG.closed_breakdown.fees += perf.fees

    // Sub closed
    if (!subGroups.has(subName)) subGroups.set(subName, { key: subName, holdings: [], total_basis: 0, total_value: 0, unrealized_gain: 0, closed_net: 0, closed_breakdown: { realized: 0, dividends: 0, interest: 0, fees: 0 }, total_net_gain: 0 })
    const subG = subGroups.get(subName)!
    subG.closed_net += net
    subG.closed_breakdown.realized += perf.realized_gain
    subG.closed_breakdown.dividends += perf.dividends
    subG.closed_breakdown.interest += perf.interest
    subG.closed_breakdown.fees += perf.fees
  }

  // Add cash to accounts
  for (const [accId, bal] of cashBalances) {
    const accName = accountMap.get(accId) || 'Unknown'
    if (!accGroups.has(accName)) accGroups.set(accName, { key: accName, holdings: [], total_basis: 0, total_value: 0, unrealized_gain: 0, closed_net: 0, closed_breakdown: { realized: 0, dividends: 0, interest: 0, fees: 0 }, total_net_gain: 0 })
    const accG = accGroups.get(accName)!
    accG.holdings.push({
      asset_id: 'cash',
      ticker: 'Cash',
      name: null,
      total_quantity: 0,
      total_basis: bal,
      current_price: 1,
      current_value: bal,
      unrealized_gain: 0,
      realized_gain: 0,
      dividends: 0,
      interest: 0,
      fees: 0,
      net_gain: 0,
    })
    accG.total_basis += bal
    accG.total_value += bal
  }

  // Finalize groups
  for (const g of accGroups.values()) {
    g.total_net_gain = g.holdings.reduce((s, h) => s + h.net_gain, 0) + g.closed_net
    groupedByAccount.push(g)
  }
  for (const g of subGroups.values()) {
    g.total_net_gain = g.holdings.reduce((s, h) => s + h.net_gain, 0) + g.closed_net
    groupedBySubPortfolio.push(g)
  }

  const overall_net = groupedByAccount.reduce((s, g) => s + g.total_net_gain, 0)

  return (
    <main className="p-8">
      <h1 className="text-3xl font-bold mb-8">Portfolio</h1>
      <Tabs defaultValue="holdings">
        <TabsList>
          <TabsTrigger value="holdings">Holdings</TabsTrigger>
          <TabsTrigger value="accounts">Accounts</TabsTrigger>
          <TabsTrigger value="subportfolios">Sub-Portfolios</TabsTrigger>
          <TabsTrigger value="assets">Assets</TabsTrigger>
        </TabsList>

        <TabsContent value="holdings">
          {lots?.length ? (
            <PortfolioHoldingsClient
              groupedAccounts={groupedByAccount}
              groupedSubs={groupedBySubPortfolio}
              cash={totalCash}
              grandTotalBasis={grandTotalBasis}
              grandTotalValue={grandTotalValue}
              overallUnrealized={overallUnrealized}
              overallNet={overall_net}
            />
          ) : (
            <div className="text-center py-12 text-muted-foreground">
              <p className="text-lg mb-2">No holdings yet</p>
              <p>Add a Buy transaction to see positions here.</p>
            </div>
          )}
        </TabsContent>

        <TabsContent value="accounts">
          <AccountsList initialAccounts={initialAccounts} />
        </TabsContent>

        <TabsContent value="subportfolios">
          <SubPortfoliosList initialSubPortfolios={initialSubPortfolios} />
        </TabsContent>

        <TabsContent value="assets">
          <AssetsList initialAssets={initialAssets} />
        </TabsContent>
      </Tabs>
    </main>
  )
}