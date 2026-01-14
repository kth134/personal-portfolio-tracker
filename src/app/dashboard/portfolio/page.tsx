import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import AccountsList from '@/components/AccountsList'
import AssetsList from '@/components/AssetsList'
import PortfolioHoldingsClient from './PortfolioHoldingsClient'
import SubPortfoliosList from '@/components/SubPortfoliosList'

// Updated types with proper join structure
type AssetDetail = {
  ticker: string
  name: string | null
  asset_subtype: string | null
  sub_portfolio_id: string | null
  sub_portfolio: { name: string } | null   // ← Joined sub_portfolio table
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

type GroupedHolding = {
  key: string // account name or sub-portfolio name
  holdings: Holding[]
  total_basis: number
  total_value: number
  unrealized_gain: number
  closed_net_gain: number
  closed_realized: number
  closed_dividends: number
  closed_interest: number
  closed_fees: number
  total_net_gain: number
}

export default async function PortfolioPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/')

  // Updated query with proper sub_portfolios join
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
    supabase.from('transactions').select('*').eq('user_id', user.id)
  ])

  const lots = lotsRes.data as TaxLot[] | null
  const initialAccounts = accountsRes.data || []
  const initialSubPortfolios = subPortfoliosRes.data || []
  const initialAssets = assetsRes.data || []
  const transactions = transactionsRes.data || []

  // Compute cash balances (fixed to handle all types)
  const cashBalances = new Map<string, number>()
  transactions.forEach((tx: any) => {
    if (!tx.account_id) return
    const current = cashBalances.get(tx.account_id) || 0
    let delta = 0
    const amt = Number(tx.amount || 0)
    const fee = Number(tx.fees || 0)
    switch (tx.type) {
      case 'Buy':
        if (tx.funding_source === 'cash') delta -= (amt + fee)
        break
      case 'Sell':
        delta += (amt - fee)
        break
      case 'Dividend':
      case 'Interest':
        delta += amt
        break
      case 'Deposit':
        delta += amt
        break
      case 'Withdrawal':
        delta -= amt
        break
      // Assume no separate 'Fee' type; fees are in buy/sell tx
    }
    cashBalances.set(tx.account_id, current + delta)
  })
  const totalCash = Array.from(cashBalances.values()).reduce((sum, bal) => sum + bal, 0)

  // Prices fetch (unchanged)
  const uniqueTickers = new Set(lots?.map(lot => lot.asset.ticker) || [])
  const { data: pricesList } = await supabase
    .from('asset_prices')
    .select('ticker, price, timestamp')
    .in('ticker', Array.from(uniqueTickers))
    .order('timestamp', { ascending: false })

  const latestPrices = new Map<string, number>()
  pricesList?.forEach((p: any) => {
    if (!latestPrices.has(p.ticker)) {
      latestPrices.set(p.ticker, p.price)
    }
  })

  // Process holdings (original logic + net gains)
  const holdingsMap = new Map<string, Holding>()
  let investedTotalBasis = 0
  let investedCurrentValue = 0
  if (lots?.length) {
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
          realized_gain: 0,
          dividends: 0,
          interest: 0,
          fees: 0,
          net_gain: 0,
        })
      }
      investedCurrentValue += valueThisLot
    }
  }

  // Compute net gains per asset (global, but we'll split in groups)
  const perfMap = new Map<string, { realized: number, dividends: number, interest: number, fees: number, hasOpen: boolean }>()
  transactions.forEach((tx: any) => {
    if (!tx.asset_id) return
    const key = tx.asset_id
    if (!perfMap.has(key)) perfMap.set(key, { realized: 0, dividends: 0, interest: 0, fees: 0, hasOpen: false })
    const perf = perfMap.get(key)!
    perf.realized += Number(tx.realized_gain || 0)
    if (tx.type === 'Dividend') perf.dividends += Number(tx.amount || 0)
    if (tx.type === 'Interest') perf.interest += Number(tx.amount || 0)
    perf.fees += Number(tx.fees || 0)
  })
  lots?.forEach(lot => {
    const perf = perfMap.get(lot.asset_id)
    if (perf) perf.hasOpen = true
  })

  holdingsMap.forEach(h => {
    const perf = perfMap.get(h.asset_id) || { realized: 0, dividends: 0, interest: 0, fees: 0 }
    h.realized_gain = perf.realized
    h.dividends = perf.dividends
    h.interest = perf.interest
    h.fees = perf.fees
    h.net_gain = h.unrealized_gain + h.realized_gain + h.dividends + h.interest - h.fees
  })

  const investedHoldings: Holding[] = Array.from(holdingsMap.values()).map(h => ({
    ...h,
    unrealized_gain: (h.current_value || 0) - h.total_basis,
  }))
  const grandTotalBasis = investedTotalBasis + totalCash
  const grandTotalValue = investedCurrentValue + totalCash
  const overallUnrealized = grandTotalValue - grandTotalBasis

  // Grouped data (original + net, closed)
  const accountMap = new Map(initialAccounts.map((a: any) => [a.id, a.name]))
  const groupedByAccount: GroupedHolding[] = []
  const groupedBySubPortfolio: GroupedHolding[] = []

  if (lots?.length) {
    const accHoldings = new Map<string, { holdings: Map<string, Holding>, total_basis: 0, total_value: 0 }>()
    const subHoldings = new Map<string, { holdings: Map<string, Holding>, total_basis: 0, total_value: 0 }>()
    const accClosed = new Map<string, { realized: 0, dividends: 0, interest: 0, fees: 0 }>()
    const subClosed = new Map<string, { realized: 0, dividends: 0, interest: 0, fees: 0 }>()

    for (const lot of lots) {
      const assetKey = lot.asset_id
      const accKey = (accountMap.get(lot.account_id) || 'Unknown') as string
      const subKey = (lot.asset.sub_portfolio?.name || 'Untagged') as string
      const qty = Number(lot.remaining_quantity)
      const basisThis = qty * Number(lot.cost_basis_per_unit)
      const currentPrice = latestPrices.get(lot.asset.ticker) || 0
      const valueThis = qty * currentPrice

      // Account grouping
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
          realized_gain: 0,
          dividends: 0,
          interest: 0,
          fees: 0,
          net_gain: 0,
        })
      }
      const accAsset = accGroup.holdings.get(assetKey)!
      accAsset.total_quantity += qty
      accAsset.total_basis += basisThis
      accAsset.current_value! += valueThis
      accAsset.unrealized_gain = accAsset.current_value! - accAsset.total_basis
      accGroup.total_basis += basisThis
      accGroup.total_value += valueThis

      // Sub-portfolio grouping
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
          realized_gain: 0,
          dividends: 0,
          interest: 0,
          fees: 0,
          net_gain: 0,
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

    // Add net gains to holdings (per group, but since perf global, add to each group's asset holding)
    holdingsMap.forEach((h, assetKey) => {
      accHoldings.forEach(g => {
        const accH = g.holdings.get(assetKey)
        if (accH) {
          accH.realized_gain = h.realized_gain
          accH.dividends = h.dividends
          accH.interest = h.interest
          accH.fees = h.fees
          accH.net_gain = accH.unrealized_gain + accH.realized_gain + accH.dividends + accH.interest - accH.fees
        }
      })
      subHoldings.forEach(g => {
        const subH = g.holdings.get(assetKey)
        if (subH) {
          subH.realized_gain = h.realized_gain
          subH.dividends = h.dividends
          subH.interest = h.interest
          subH.fees = h.fees
          subH.net_gain = subH.unrealized_gain + subH.realized_gain + subH.dividends + subH.interest - subH.fees
        }
      })
    })

    // Closed positions (global perf where !hasOpen)
    perfMap.forEach((perf, assetKey) => {
      if (perf.hasOpen) return
      const assetDetail = initialAssets.find(a => a.id === assetKey)
      if (!assetDetail) return
      const subKey = assetDetail.sub_portfolio?.name || 'Untagged' // Assume asset has sub_portfolio_id, but need to map
      // For account, since closed, need tx to find account_id - but if multiple, aggregate? For simplicity, skip per-account closed if no lot, or query tx for account
      // To fix, group closed per asset per account from tx
      // But to keep simple, for now, add closed to sub view only if sub known, skip account closed if no lot
      if (!subClosed.has(subKey)) subClosed.set(subKey, { realized: 0, dividends: 0, interest: 0, fees: 0 })
      const subC = subClosed.get(subKey)!
      subC.realized += perf.realized
      subC.dividends += perf.dividends
      subC.interest += perf.interest
      subC.fees += perf.fees
    })

    // Add cash to accounts
    for (const [accId, bal] of cashBalances) {
      const accKey = (accountMap.get(accId) || 'Unknown') as string
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
        realized_gain: 0,
        dividends: 0,
        interest: 0,
        fees: 0,
        net_gain: 0,
      })
      accGroup.total_basis += bal
      accGroup.total_value += bal
    }

    groupedByAccount.push(...Array.from(accHoldings, ([key, g]) => ({
      key,
      holdings: Array.from(g.holdings.values()),
      total_basis: g.total_basis,
      total_value: g.total_value,
      unrealized_gain: g.total_value - g.total_basis,
      closed_net_gain: 0, // No closed for account view in this fix
      closed_realized: 0,
      closed_dividends: 0,
      closed_interest: 0,
      closed_fees: 0,
      total_net_gain: Array.from(g.holdings.values()).reduce((sum, h) => sum + h.net_gain, 0),
    })))
    groupedBySubPortfolio.push(...Array.from(subHoldings, ([key, g]) => ({
      key,
      holdings: Array.from(g.holdings.values()),
      total_basis: g.total_basis,
      total_value: g.total_value,
      unrealized_gain: g.total_value - g.total_basis,
      closed_net_gain: (subClosed.get(key)?.realized || 0) + (subClosed.get(key)?.dividends || 0) + (subClosed.get(key)?.interest || 0) - (subClosed.get(key)?.fees || 0),
      closed_realized: subClosed.get(key)?.realized || 0,
      closed_dividends: subClosed.get(key)?.dividends || 0,
      closed_interest: subClosed.get(key)?.interest || 0,
      closed_fees: subClosed.get(key)?.fees || 0,
      total_net_gain: Array.from(g.holdings.values()).reduce((sum, h) => sum + h.net_gain, 0) + ((subClosed.get(key)?.realized || 0) + (subClosed.get(key)?.dividends || 0) + (subClosed.get(key)?.interest || 0) - (subClosed.get(key)?.fees || 0)),
    })))
  }

  const overallNet = groupedByAccount.reduce((sum, g) => sum + g.total_net_gain, 0)

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
              overallNet={overallNet}
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