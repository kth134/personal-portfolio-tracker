import { createServiceRoleClient } from '@/lib/supabase/service'

// Single source of truth for refreshing asset prices.
//
// Used by:
//   - the Vercel daily cron at /api/fetch-prices (no user, refreshes every
//     distinct ticker across all users);
//   - the `Refresh prices` Server Action in the portfolio dashboard
//     (refreshes only the calling user's tickers).
//
// Writes go through the service-role client because asset_prices now has
// RLS enabled with service_role-only write policies (audit ref C1). The
// data being written is non-sensitive and global (ticker:price:timestamp),
// so bypassing per-user RLS here is appropriate.

const COINGECKO_ID_MAP: Record<string, string> = {
  BTC: 'bitcoin',
  BITCOIN: 'bitcoin',
  ETH: 'ethereum',
  ETHEREUM: 'ethereum',
}

type PriceRow = { ticker: string; price: number; source: string }

export type RefreshResult = {
  success: boolean
  refreshedAt: string
  inserted: { crypto: number; stocks: number }
  failed: string[]
}

async function fetchCoinGeckoPrices(tickers: string[]): Promise<PriceRow[]> {
  if (!tickers.length) return []
  const ids = tickers.map((t) => COINGECKO_ID_MAP[t] || t.toLowerCase())
  const url = `https://api.coingecko.com/api/v3/simple/price?ids=${ids.join(',')}&vs_currencies=usd`
  const response = await fetch(url)
  if (!response.ok) {
    console.error(`CoinGecko error: ${response.status} ${response.statusText}`)
    return []
  }
  const payload = await response.json()
  const rows: PriceRow[] = []
  for (let i = 0; i < tickers.length; i++) {
    const price = payload[ids[i]]?.usd
    if (typeof price === 'number' && price > 0) {
      rows.push({ ticker: tickers[i], price, source: 'coingecko' })
    }
  }
  return rows
}

async function fetchStockPrice(
  ticker: string,
  finnhubKey: string,
  alphaKey: string | undefined,
): Promise<PriceRow | null> {
  const finnhubUrl = `https://finnhub.io/api/v1/quote?symbol=${ticker}&token=${finnhubKey}`
  const finnhubResponse = await fetch(finnhubUrl)
  if (finnhubResponse.ok) {
    const data = await finnhubResponse.json()
    const price = data.c || data.pc
    if (typeof price === 'number' && price > 0) {
      return { ticker, price, source: 'finnhub' }
    }
  }

  if (!alphaKey) return null
  const alphaUrl = `https://www.alphavantage.co/query?function=GLOBAL_QUOTE&symbol=${ticker}&apikey=${alphaKey}`
  const alphaResponse = await fetch(alphaUrl)
  if (!alphaResponse.ok) return null
  const alphaData = await alphaResponse.json()
  const raw = alphaData['Global Quote']?.['05. price']
  if (raw == null) return null
  const price = parseFloat(raw)
  if (!Number.isFinite(price) || price <= 0) return null
  return { ticker, price, source: 'alphavantage' }
}

// Pass `userId = null` to refresh every distinct ticker across all users
// (the cron path). Pass a specific userId to refresh only that user's
// tickers (the dashboard Server Action path).
export async function refreshPrices(userId: string | null): Promise<RefreshResult> {
  const refreshedAt = new Date().toISOString()
  const admin = createServiceRoleClient()

  let q = admin.from('assets').select('ticker, asset_subtype')
  if (userId) q = q.eq('user_id', userId)
  const { data: assets, error: assetsError } = await q
  if (assetsError) throw assetsError

  const assetsList = (assets ?? []) as Array<{ ticker: string; asset_subtype: string | null }>
  const cryptoTickers = [
    ...new Set(
      assetsList
        .filter((a) => (a.asset_subtype ?? '').toLowerCase() === 'crypto')
        .map((a) => a.ticker.toUpperCase()),
    ),
  ]
  const stockTickers = [
    ...new Set(
      assetsList
        .filter((a) => (a.asset_subtype ?? '').toLowerCase() !== 'crypto')
        .map((a) => a.ticker.toUpperCase()),
    ),
  ]

  const failed: string[] = []
  const rows: PriceRow[] = []

  if (cryptoTickers.length) {
    const cryptoRows = await fetchCoinGeckoPrices(cryptoTickers)
    rows.push(...cryptoRows)
    const fetched = new Set(cryptoRows.map((r) => r.ticker))
    failed.push(...cryptoTickers.filter((t) => !fetched.has(t)))
  }

  if (stockTickers.length) {
    const finnhubKey = process.env.FINNHUB_API_KEY
    if (!finnhubKey) throw new Error('FINNHUB_API_KEY is not set')
    const alphaKey = process.env.ALPHA_VANTAGE_API_KEY

    for (const ticker of stockTickers) {
      const row = await fetchStockPrice(ticker, finnhubKey, alphaKey)
      if (row) rows.push(row)
      else failed.push(ticker)
    }
  }

  let insertedCrypto = 0
  let insertedStocks = 0
  if (rows.length) {
    const { error: insertError } = await admin.from('asset_prices').insert(rows)
    if (insertError) throw insertError
    for (const r of rows) {
      if (r.source === 'coingecko') insertedCrypto++
      else insertedStocks++
    }
  }

  return {
    success: true,
    refreshedAt,
    inserted: { crypto: insertedCrypto, stocks: insertedStocks },
    failed,
  }
}
