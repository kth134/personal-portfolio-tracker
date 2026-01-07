'use server'

import { supabaseServer } from '@/lib/supabase/server'
import { revalidatePath } from 'next/cache'

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

  // Step 2: Fetch latest prices
  // Adapt to your providers: CoinGecko for crypto, yfinance/Polygon for stocks (free tiers).
  // For demo, using CoinGecko—replace/extend with your cron logic for stocks (e.g., via fetch to yfinance API).
  const tickerIds = uniqueTickers.map(t => t.toLowerCase()).join(',')
  if (!tickerIds) {
    return { success: true, message: 'No supported tickers found.' }
  }

  const res = await fetch(`https://api.coingecko.com/api/v3/simple/price?ids=${tickerIds}&vs_currencies=usd`)
  if (!res.ok) {
    throw new Error('Failed to fetch prices from CoinGecko')
  }
  const pricesData = await res.json()

  // For stocks, add similar fetch (e.g., to yfinance proxy if needed)

  // Step 3: Prepare inserts (not upsert)
  const inserts = uniqueTickers.map(ticker => {
    const geckoId = ticker.toLowerCase() // Improve mapping as needed
    const price = pricesData[geckoId]?.usd || null
    return {
      ticker,
      price,
      timestamp: new Date().toISOString(),
    }
  }).filter(p => p.price !== null)

  if (inserts.length > 0) {
    const { error } = await supabase.from('asset_prices').insert(inserts)
    if (error) throw error
  }

  // Revalidate the portfolio page to show fresh prices
  revalidatePath('/portfolio')

  return { success: true, message: `Refreshed prices for ${inserts.length} assets.` }
}