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
    }
    cashBalances.set(tx.account_id, current + delta)
  })
  const totalCash = Array.from(cashBalances.values()).reduce((sum, bal) => sum + bal, 0)

  // Prices fetch - live prices
  const uniqueTickers = new Set(lots?.map(lot => lot.asset.ticker) || [])
  const { data: assetsData } = await supabase
    .from('assets')
    .select('ticker, asset_subtype')
    .in('ticker', Array.from(uniqueTickers))
    .eq('user_id', user.id)

  const assetMap = new Map<string, string>()
  assetsData?.forEach((a: any) => assetMap.set(a.ticker, a.asset_subtype))

  const cryptoTickers = Array.from(uniqueTickers).filter(t => assetMap.get(t)?.toLowerCase() === 'crypto')
  const stockTickers = Array.from(uniqueTickers).filter(t => assetMap.get(t)?.toLowerCase() !== 'crypto')

  const latestPrices = new Map<string, number>()

  // Fetch crypto prices from CoinGecko
  if (cryptoTickers.length > 0) {
    const idMap: Record<string, string> = {
      BTC: 'bitcoin',
      ETH: 'ethereum',
    }
    const cgIds = cryptoTickers.map(t => idMap[t] || t.toLowerCase())
    const cgUrl = `https://api.coingecko.com/api/v3/simple/price?ids=${cgIds.join(',')}&vs_currencies=usd`
    try {
      const cgResponse = await fetch(cgUrl)
      if (cgResponse.ok) {
        const cgPrices = await cgResponse.json()
        cryptoTickers.forEach((ticker, i) => {
          const cgId = cgIds[i]
          const price = cgPrices[cgId]?.usd
          if (price) latestPrices.set(ticker, price)
        })
      }
    } catch (error) {
      console.error('CoinGecko fetch error:', error)
    }
  }

  // Fetch stock prices from Finnhub
  if (stockTickers.length > 0) {
    const finnhubKey = process.env.FINNHUB_API_KEY
    const alphaKey = process.env.ALPHA_VANTAGE_API_KEY
    if (finnhubKey) {
      for (const ticker of stockTickers) {
        let price: number | undefined
        try {
          const finnhubUrl = `https://finnhub.io/api/v1/quote?symbol=${ticker}&token=${finnhubKey}`
          const finnhubResponse = await fetch(finnhubUrl)
          if (finnhubResponse.ok) {
            const finnhubData = await finnhubResponse.json()
            price = finnhubData.c || finnhubData.pc
          }
        } catch (error) {
          console.error(`Finnhub fetch error for ${ticker}:`, error)
        }

        // Alpha Vantage fallback if no price from Finnhub
        if ((!price || price <= 0) && alphaKey) {
          try {
            console.log(`Attempting Alpha Vantage fallback for ${ticker}`)
            const alphaUrl = `https://www.alphavantage.co/query?function=GLOBAL_QUOTE&symbol=${ticker}&apikey=${alphaKey}`
            const alphaResponse = await fetch(alphaUrl)
            if (alphaResponse.ok) {
              const alphaData = await alphaResponse.json()
              const quote = alphaData['Global Quote']
              if (quote && quote['05. price']) {
                price = parseFloat(quote['05. price'])
                console.log(`Alpha Vantage price for ${ticker}: $${price}`)
              }
            }
          } catch (error) {
            console.error(`Alpha Vantage fetch error for ${ticker}:`, error)
          }
        }

        if (price && price > 0) latestPrices.set(ticker, price)
      }
    }
  }

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