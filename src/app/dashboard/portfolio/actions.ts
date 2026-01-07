'use server'

import { supabaseServer } from '@/lib/supabase/server'
import { revalidatePath } from 'next/cache'

const CRYPTO_TICKERS = ['BITCOIN']; // Expand if more cryptos are added (e.g., 'FBTC')

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

  // Step 2: Split tickers by type
  const cryptoTickers = uniqueTickers.filter(t => CRYPTO_TICKERS.includes(t));
  const stockTickers = uniqueTickers.filter(t => !CRYPTO_TICKERS.includes(t));

  // Step 3: Fetch crypto prices from CoinGecko
  let pricesData: Record<string, { usd?: number }> = {};
  if (cryptoTickers.length > 0) {
    const cryptoIds = cryptoTickers.map(t => t === 'BITCOIN' ? 'bitcoin' : t.toLowerCase()).join(',');
    if (!cryptoIds) {
      return { success: true, message: 'No supported crypto tickers found.' }
    }

    const res = await fetch(`https://api.coingecko.com/api/v3/simple/price?ids=${cryptoIds}&vs_currencies=usd`)
    if (!res.ok) {
      throw new Error('Failed to fetch prices from CoinGecko')
    }
    pricesData = await res.json()
  }

  // Step 4: Fetch stock prices from Polygon
  let stockPricesData: Record<string, number | null> = {};
  if (stockTickers.length > 0) {
    const polygonApiKey = process.env.POLYGON_API_KEY;
    if (!polygonApiKey) {
      throw new Error('POLYGON_API_KEY is not set in environment variables');
    }
    const stockTickerParam = stockTickers.join(',');
    const polyRes = await fetch(`https://api.polygon.io/v3/snapshot?ticker=${stockTickerParam}&apiKey=${polygonApiKey}`);
    if (!polyRes.ok) {
      throw new Error(`Failed to fetch prices from Polygon: ${polyRes.statusText}`);
    }
    const polyData = await polyRes.json();
    polyData.results.forEach((item: { ticker: string; session?: { close?: number }; prev_day?: { close?: number } }) => {
      // Use session.close for current day's last price (updates live); fallback to prev_day.close if market not open
      const price = item.session?.close || item.prev_day?.close || null;
      stockPricesData[item.ticker] = price;
    });
  }

  // Step 5: Prepare inserts (not upsert)
  const inserts: { ticker: string; price: number; timestamp: string; source: string }[] = [];

  // Crypto from CoinGecko
  cryptoTickers.forEach(ticker => {
    const geckoId = ticker === 'BITCOIN' ? 'bitcoin' : ticker.toLowerCase();
    const price = pricesData?.[geckoId]?.usd || null;
    if (price !== null) {
      inserts.push({
        ticker,
        price,
        timestamp: new Date().toISOString(),
        source: 'coingecko',
      });
    }
  });

  // Stocks from Polygon (with fallback for invalid tickers like CASH)
  stockTickers.forEach(ticker => {
    let price = stockPricesData[ticker];
    if (price === null || price === undefined) {
      // Fallback for cash or invalid: assume $1.00; log for debugging
      console.warn(`No price found for ${ticker}; defaulting to 1.00`);
      price = 1.00;
    }
    inserts.push({
      ticker,
      price,
      timestamp: new Date().toISOString(),
      source: 'polygon',
    });
  });

  if (inserts.length > 0) {
    const { error } = await supabase.from('asset_prices').insert(inserts)
    if (error) throw error
  }

  // Revalidate the portfolio page to show fresh prices
  revalidatePath('/portfolio')

  return { success: true, message: `Refreshed prices for ${inserts.length} assets.` }
}