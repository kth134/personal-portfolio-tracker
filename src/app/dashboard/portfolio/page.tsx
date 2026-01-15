import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import AccountsList from '@/components/AccountsList'
import AssetsList from '@/components/AssetsList'
import SubPortfoliosList from '@/components/SubPortfoliosList'
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

  // Fetch data (keep minimal for Holdings tab; other tabs unchanged)
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

  // Compute cash balances
  const cashBalances = new Map<string, number>()
  transactions.forEach((tx: any) => {
    if (!tx.account_id) return
    // Skip automatic deposits for external buys
    if (tx.notes === 'Auto-deposit for external buy') {
      console.log(`Skipping automatic deposit for external buy: ${tx.amount}`)
      return
    }
    const current = cashBalances.get(tx.account_id) || 0
    let delta = 0
    const amt = Number(tx.amount || 0)
    const fee = Number(tx.fees || 0)
    console.log(`Processing transaction: ${tx.type}, funding_source: ${tx.funding_source}, amount: ${amt}, fees: ${fee}`)
    switch (tx.type) {
      case 'Buy':
        if (tx.funding_source === 'cash') {
          delta -= (amt + fee)  // deduct purchase amount and fee from cash balance
          console.log(`Buy with cash: delta -= ${amt + fee}`)
        } // else (including 'external'): no impact to cash balance
        break
      case 'Sell':
        delta += (amt - fee)  // increase cash balance by sale amount less fees
        console.log(`Sell: delta += ${amt - fee}`)
        break
      case 'Dividend':
        delta += amt  // increase cash balance
        console.log(`Dividend: delta += ${amt}`)
        break
      case 'Interest':
        delta += amt  // increase cash balance
        console.log(`Interest: delta += ${amt}`)
        break
      case 'Deposit':
        delta += amt  // increase cash balance
        console.log(`Deposit: delta += ${amt}`)
        break
      case 'Withdrawal':
        delta -= amt  // decrease cash balance
        console.log(`Withdrawal: delta -= ${amt}`)
        break
    }
    const newBalance = current + delta
    cashBalances.set(tx.account_id, newBalance)
    console.log(`Account ${tx.account_id} balance: ${current} + ${delta} = ${newBalance}`)
  })
  const totalCash = Array.from(cashBalances.values()).reduce((sum, bal) => sum + bal, 0)
  console.log(`Total cash: ${totalCash}`)

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
          <TabsTrigger value="subportfolios">Sub-Portfolios</TabsTrigger>
          <TabsTrigger value="assets">Assets</TabsTrigger>
        </TabsList>

        <TabsContent value="holdings">
          {lots?.length ? (
            <PortfolioHoldingsWithSlicers
              cash={totalCash}
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