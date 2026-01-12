'use server'

import { createClient } from '@/lib/supabase/server'
import { revalidatePath } from 'next/cache'

const CRYPTO_TICKERS = ['BITCOIN']; // Expand as needed

export async function refreshAssetPrices() {
  const supabase = await createClient()

  // Step 1: Get unique tickers from holdings
  const { data: lots } = await supabase
    .from('tax_lots')
    .select('asset:assets(ticker)')
    .gt('remaining_quantity', 0)

  if (!lots || lots.length === 0) {
    return { success: true, message: 'No holdings to refresh prices for.' }
  }

  const uniqueTickers = [...new Set(lots.map((l: any) => (l.asset as any).ticker))] as string[]

  // Step 2: Split by type
  const cryptoTickers = uniqueTickers.filter((t: string) => CRYPTO_TICKERS.includes(t));
  const stockTickers = uniqueTickers.filter((t: string) => !CRYPTO_TICKERS.includes(t));

  // Step 3: CoinGecko for crypto
  let pricesData: Record<string, { usd?: number }> = {};
  if (cryptoTickers.length > 0) {
    const cryptoIds = cryptoTickers.map((t: string) => t === 'BITCOIN' ? 'bitcoin' : t.toLowerCase()).join(',');
    const res = await fetch(`https://api.coingecko.com/api/v3/simple/price?ids=${cryptoIds}&vs_currencies=usd`);
    if (!res.ok) {
      console.error('CoinGecko fetch failed:', await res.text());
    } else {
      pricesData = await res.json();
    }
  }

  // Step 4: Finnhub for stocks – fetch one by one
  const stockPricesData: Record<string, number | null> = {};
  if (stockTickers.length > 0) {
    const finnhubKey = process.env.FINNHUB_API_KEY;
    if (!finnhubKey) {
      throw new Error('FINNHUB_API_KEY not set');
    }

    for (const ticker of stockTickers) {
      try {
        const res = await fetch(`https://finnhub.io/api/v1/quote?symbol=${ticker}&token=${finnhubKey}`);
        if (!res.ok) {
          console.error(`Finnhub failed for ${ticker}: ${res.status} ${await res.text()}`);
          stockPricesData[ticker as string] = null;
          continue;
        }
        const data = await res.json();
        // 'c' = current price; fallback to previous close if market closed
        const price = data.c !== 0 ? data.c : data.pc || null;
        stockPricesData[ticker as string] = price;
      } catch (err) {
        console.error(`Error fetching ${ticker} from Finnhub:`, err);
        stockPricesData[ticker as string] = null;
      }
    }
  }

  // Step 5: Prepare inserts
  const inserts: { ticker: string; price: number; timestamp: string; source: string }[] = [];

  cryptoTickers.forEach((ticker: string) => {
    const geckoId = ticker === 'BITCOIN' ? 'bitcoin' : ticker.toLowerCase();
    const price = pricesData[geckoId]?.usd || null;
    if (price !== null) {
      inserts.push({ ticker, price, timestamp: new Date().toISOString(), source: 'coingecko' });
    }
  });

  stockTickers.forEach((ticker: string) => {
    let price = stockPricesData[ticker as string];
    if (price === null || price === undefined || price === 0) {
      console.warn(`No valid price for ${ticker} from Finnhub; defaulting to 1.00`);
      price = 1.00; // For CASH or errors
    }
    inserts.push({ ticker, price, timestamp: new Date().toISOString(), source: 'finnhub' });
  });

  if (inserts.length > 0) {
    const { error } = await supabase.from('asset_prices').insert(inserts);
    if (error) throw error;
  }

  revalidatePath('/portfolio');

  return { success: true, message: `Refreshed prices for ${inserts.length} assets.` };
}