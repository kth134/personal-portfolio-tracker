import { createClient } from '@/lib/supabase/server'
import { calculateCashBalances, fetchAllUserTransactionsServer } from '@/lib/finance'
import { redirect } from 'next/navigation'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import PortfolioHoldingsWithSlicers from './PortfolioHoldingsWithSlicers'
import RebalancingPage from '../strategy/RebalancingPage'
import { DashboardPageShell } from '@/components/dashboard-shell'
import { BannerRefreshButton } from '@/components/BannerRefreshButton'

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

export default async function PortfolioPage({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }> | { [key: string]: string | string[] | undefined }
}) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/')

  const resolvedSearchParams = await Promise.resolve(searchParams)

  // Fetch data
  const [lotsRes, accountsRes, transactionsRes] = await Promise.all([
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
    // Fetch all transactions using server-side pagination for comprehensive cash calculations
    fetchAllUserTransactionsServer(supabase, user.id)
  ])

  const lots = lotsRes.data as TaxLot[] | null
  const initialAccounts = accountsRes.data || []
  const transactions = transactionsRes
  const tabParam = Array.isArray(resolvedSearchParams?.tab) ? resolvedSearchParams.tab[0] : resolvedSearchParams?.tab
  const initialTab = tabParam === 'rebalancing' ? 'rebalancing' : 'holdings'

  // Compute cash balances using centralized helper to ensure canonical behavior
  const { balances: cashBalances, totalCash } = calculateCashBalances(transactions || [])

  // Map cash by account name for account-specific display
  const cashByAccountName = new Map<string, number>()
  initialAccounts.forEach(account => {
    const balance = cashBalances.get(account.id) || 0
    cashByAccountName.set(account.name.trim(), balance)
  })

  return (
    <DashboardPageShell
      eyebrow="Portfolio"
      title="Portfolio Management"
      description="Review current holdings, inspect allocation slices, and switch into rebalancing decisions from one portfolio workspace."
      action={<BannerRefreshButton eventName="dashboard:portfolio-refresh" />}
    >
      <Tabs key={initialTab} defaultValue={initialTab} className="dashboard-tabs">
        <TabsList className="w-full sm:w-auto">
          <TabsTrigger value="holdings">Holdings</TabsTrigger>
          <TabsTrigger value="rebalancing">Rebalancing</TabsTrigger>
        </TabsList>

        <TabsContent value="holdings" className="mt-0">
          {lots?.length ? (
            <PortfolioHoldingsWithSlicers
              cash={totalCash}
              cashByAccountName={cashByAccountName}
            />
          ) : (
            <div className="rounded-[26px] border border-zinc-200/80 bg-white px-6 py-12 text-center text-muted-foreground shadow-sm">
              <p className="text-lg mb-2">No holdings yet</p>
              <p>Add a Buy transaction to see positions here.</p>
            </div>
          )}
        </TabsContent>

        <TabsContent value="rebalancing" className="mt-0">
          <RebalancingPage />
        </TabsContent>
      </Tabs>
    </DashboardPageShell>
  )
}