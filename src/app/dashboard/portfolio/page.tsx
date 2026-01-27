import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import AccountsList from '@/components/AccountsList'
import AssetsList from '@/components/AssetsList'
import PortfolioHoldingsWithSlicers from './PortfolioHoldingsWithSlicers'

// Types (simplified for this page)
type TaxLot = {
  asset_id: string
  account_id: string
  remaining_quantity: number
  cost_basis_per_unit: number
  asset: {
    ticker: string
    name: string | null
    asset_subtype: string | null
    sub_portfolio_id: string | null
    sub_portfolio: { name: string } | null
  }
}

export default async function PortfolioPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/')

  // Fetch data
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

  // Compute cash using transaction-centric unified signed math.
  // Portfolio total includes all transactions; per-account balances only include transactions tied to that account.
  const cashBalances = new Map<string, number>()

  // First compute per-account balances by summing (amount - fees) for transactions with an account_id
  // Use transaction-type-aware cash delta:
  // - Buys/Sells: `amount` is already the net cash delta (fees included when created)
  // - Dividend/Interest/Deposit/Withdrawal: `amount` is stored as gross, so net = amount - |fees|
  const txCashDelta = (tx: any) => {
    const amt = Number(tx.amount || 0)
    const fee = Math.abs(Number(tx.fees || 0))
    if (tx.type === 'Buy' || tx.type === 'Sell') return amt
    if (tx.type === 'Dividend' || tx.type === 'Interest' || tx.type === 'Deposit' || tx.type === 'Withdrawal') return amt - fee
    return amt
  }

  transactions.forEach((tx: any) => {
    const acctId = tx.account_id
    if (!acctId) return
    const current = cashBalances.get(acctId) || 0
    cashBalances.set(acctId, current + txCashDelta(tx))
  })

  // Total portfolio cash should include all transactions (including those not tied to an account)
  const totalCash = transactions.reduce((sum: number, tx: any) => sum + txCashDelta(tx), 0)

  // Map cash by account name for account-specific display
  const cashByAccountName = new Map<string, number>()
  initialAccounts.forEach(account => {
    const balance = cashBalances.get(account.id) || 0
    cashByAccountName.set(account.name.trim(), balance)
  })

  // Prices fetch
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
          {lots?.length ? (
            <PortfolioHoldingsWithSlicers
              cash={totalCash}
              cashByAccountName={cashByAccountName}
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

        <TabsContent value="assets">
          <AssetsList initialAssets={initialAssets} />
        </TabsContent>
      </Tabs>
    </main>
  )
}