import { createClient } from '@/lib/supabase/server'
import { calculateCashBalances, fetchAllUserTransactionsServer } from '@/lib/finance'
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
    // Fetch all transactions using server-side pagination for comprehensive cash calculations
    fetchAllUserTransactionsServer(supabase, user.id)
  ])

  const lots = lotsRes.data as TaxLot[] | null
  const initialAccounts = accountsRes.data || []
  const initialAssets = assetsRes.data || []
  const transactions = transactionsRes

  // Compute cash balances using centralized helper to ensure canonical behavior
  const { balances: cashBalances, totalCash } = calculateCashBalances(transactions || [])

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