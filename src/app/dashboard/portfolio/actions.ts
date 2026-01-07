'use server'

import { supabaseServer } from '@/lib/supabase/server'
import { revalidatePath } from 'next/cache'

// Reuse your existing price-fetching logic here (copy/paste/adapt from your current /api/fetch-prices if it exists)
// For now, assuming you have a function or inline logic – replace the placeholder comments with your actual fetch code.

export async function refreshAssetPrices() {
  const supabase = await supabaseServer()

  // Step 1: Get unique tickers from current holdings (tax_lots with remaining_quantity > 0)
  const { data: lots } = await supabase
    .from('tax_lots')
    .select('asset:assets(ticker)')
    .gt('remaining_quantity', 0)

  if (!lots || lots.length === 0) {
    return { success: true, message: 'No holdings to refresh prices for.' }
  }

  const uniqueTickers = [...new Set(lots.map(l => (l.asset as any).ticker))]

  // Step 2: Fetch latest prices (adapt this to your current providers – e.g., CoinGecko for crypto, yfinance/Polygon for stocks)
  // Example using CoinGecko for demo (free, no key needed for basic use):
  const tickerIds = uniqueTickers.map(t => {
    // Map common tickers to CoinGecko IDs (expand this map as needed)
    const map: Record<string, string> = {
      BTC: 'bitcoin',
      ETH: 'ethereum',
      // Add more: TSLA: 'tesla-inc', etc. For stocks, you may need Polygon/yfinance separately
    }
    return map[t.toUpperCase()] || t.toLowerCase()
  }).join(',')

  if (!tickerIds) {
    return { success: true, message: 'No supported tickers found.' }
  }

  const res = await fetch(`https://api.coingecko.com/api/v3/simple/price?ids=${tickerIds}&vs_currencies=usd`)
  if (!res.ok) {
    throw new Error('Failed to fetch prices from external API')
  }
  const pricesData = await res.json()

  // Step 3: Upsert into asset_prices table
  const upserts = uniqueTickers.map(ticker => {
    const geckoId = ticker.toLowerCase() // simplify; improve mapping as needed
    const price = pricesData[geckoId]?.usd || null
    return {
      ticker,
      price,
      timestamp: new Date().toISOString(),
    }
  }).filter(p => p.price !== null)

  if (upserts.length > 0) {
    const { error } = await supabase.from('asset_prices').upsert(upserts, { onConflict: 'ticker' })
    if (error) throw error
  }

  // Revalidate the portfolio page to show fresh prices
  revalidatePath('/portfolio')

  return { success: true, message: `Refreshed prices for ${upserts.length} assets.` }
}