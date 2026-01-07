'use server'

import { supabaseServer } from '@/lib/supabase/server'
import { revalidatePath } from 'next/cache'

const CRYPTO_TICKERS = ['BITCOIN']; // Expand as needed

export async function refreshAssetPrices() {
  const supabase = await supabaseServer()

  // Step 1: Get unique tickers from holdings
  const { data: lots } = await supabase
    .from('tax_lots')
    .select('asset:assets(ticker)')
    .gt('remaining_quantity', 0)

  if (!lots || lots.length === 0) {
    return { success: true, message: 'No holdings to refresh prices for.' }
  }

  const uniqueTickers = [...new Set(lots.map(l => (l.asset as any).ticker))]

  // Step 2: Split by type
  const cryptoTickers = uniqueTickers.filter(t => CRYPTO_TICKERS.includes(t));
  const stockTickers = uniqueTickers.filter(t => !CRYPTO_TICKERS.includes(t));

  // Step 3: CoinGecko for crypto
  let pricesData: Record<string, { usd?: number }> = {};
  if (cryptoTickers.length > 0) {
    const cryptoIds = cryptoTickers.map(t => t === 'BITCOIN' ? 'bitcoin' : t.toLowerCase()).join(',');
    const res = await fetch(`https://api.coingecko.com/api/v3/simple/price?ids=${cryptoIds}&vs_currencies=usd`)
    if (!res.ok) {
      console.error('CoinGecko fetch failed:', await res.text());
    } else {
      pricesData = await res.json()
    }
  }

  // Step 4: Finnhub for stocks (batch quote)
  let stockPricesData: Record<string, number | null> = {};
  if (stockTickers.length > 0) {
    const finnhubKey = process.env.FINNHUB_API_KEY;
    if (!finnhubKey) {
      throw new Error('FINNHUB_API_KEY not set');
    }
    const tickerParam = stockTickers.join(',');
    const finnhubRes = await fetch(`https://finnhub.io/api/v1/quote?symbol=${tickerParam}&token=${finnhubKey}`);
    if (!finnhubRes.ok) {
      console.error('Finnhub fetch failed:', await finnhubRes.text());
    } else {
      const data = await finnhubRes.json();
      // Finnhub batch returns object with each ticker as key (c = current price)
      Object.keys(data).forEach(ticker => {
        stockPricesData[ticker] = data[ticker]?.c || null; // 'c' is current price
      });
    }
  }

  // Step 5: Prepare inserts
  const inserts: { ticker: string; price: number; timestamp: string; source: string }[] = [];

  cryptoTickers.forEach(ticker => {
    const geckoId = ticker === 'BITCOIN' ? 'bitcoin' : ticker.toLowerCase();
    const price = pricesData[geckoId]?.usd || null;
    if (price !== null) {
      inserts.push({ ticker, price, timestamp: new Date().toISOString(), source: 'coingecko' });
    }
  });

  stockTickers.forEach(ticker => {
    let price = stockPricesData[ticker];
    if (price === null || price === undefined || price === 0) {
      console.warn(`No valid price for ${ticker} from Finnhub; defaulting to 1.00`);
      price = 1.00; // For CASH or errors
    }
    inserts.push({ ticker, price, timestamp: new Date().toISOString(), source: 'finnhub' });
  });

  if (inserts.length > 0) {
    const { error } = await supabase.from('asset_prices').insert(inserts)
    if (error) throw error
  }

  revalidatePath('/portfolio')

  return { success: true, message: `Refreshed prices for ${inserts.length} assets.` }
}