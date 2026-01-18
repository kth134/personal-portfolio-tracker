'use server'

import { createClient } from '@/lib/supabase/server'
import { revalidatePath } from 'next/cache'
import { headers } from 'next/headers' // ← Add this import

export async function refreshAssetPrices() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { success: false, message: 'Unauthorized' }

  // Step 1: Get unique tickers from active holdings (unchanged)
  const { data: lots } = await supabase
    .from('tax_lots')
    .select('asset:assets(ticker, asset_subtype)')
    .eq('user_id', user.id)
    .gt('remaining_quantity', 0)

  if (!lots || lots.length === 0) {
    return { success: true, message: 'No holdings to refresh prices for.' }
  }

  const uniqueTickers = [...new Set(lots.map((l: any) => (l.asset as any).ticker))] as string[]

  if (uniqueTickers.length === 0) {
    return { success: true, message: 'No tickers found in holdings.' }
  }

  const idMap: Record<string, string> = {
    BTC: 'bitcoin',
    BITCOIN: 'bitcoin',
    ETH: 'ethereum',
    ETHEREUM: 'ethereum',
  };

  const cryptoAssets = lots.filter((l: any) => (l.asset as any).asset_subtype?.toLowerCase() === 'crypto');
  const cryptoTickers = cryptoAssets.map((l: any) => (l.asset as any).ticker.toUpperCase());

  const stockAssets = lots.filter((l: any) => (l.asset as any).asset_subtype?.toLowerCase() !== 'crypto');
  const stockTickers = stockAssets.map((l: any) => (l.asset as any).ticker.toUpperCase());

  // CoinGecko for crypto
  if (cryptoTickers.length) {
    const cgIds = cryptoTickers.map((t: any) => idMap[t] || t.toLowerCase());
    const cgUrl = `https://api.coingecko.com/api/v3/simple/price?ids=${cgIds.join(',')}&vs_currencies=usd`;
    const cgResponse = await fetch(cgUrl);
    if (cgResponse.ok) {
      const cgPrices = await cgResponse.json();
      for (let i = 0; i < cryptoTickers.length; i++) {
        const originalTicker = cryptoTickers[i];
        const cgId = cgIds[i];
        const price = cgPrices[cgId]?.usd;
        if (price) {
          await supabase.from('asset_prices').insert({ ticker: originalTicker, price, source: 'coingecko' });
          console.log(`Inserted CoinGecko price for ${originalTicker}: $${price}`);
        }
      }
    } else {
      console.error(`CoinGecko error: ${cgResponse.statusText}`);
    }
  }

  // Finnhub primary + Alpha Vantage fallback for stocks
  if (stockTickers.length) {
    const finnhubKey = process.env.FINNHUB_API_KEY;
    const alphaKey = process.env.ALPHA_VANTAGE_API_KEY;
    if (!finnhubKey || !alphaKey) {
      return { success: false, message: 'Missing API keys for price fetch' };
    }

    for (const ticker of stockTickers) {
      let price: number | undefined;
      let source = 'finnhub';

      // Finnhub primary
      const finnhubUrl = `https://finnhub.io/api/v1/quote?symbol=${ticker}&token=${finnhubKey}`;
      const finnhubResponse = await fetch(finnhubUrl);
      if (finnhubResponse.ok) {
        const finnhubData = await finnhubResponse.json();
        price = finnhubData.c || finnhubData.pc || undefined;
      } else {
        console.error(`Finnhub failed for ${ticker}: ${finnhubResponse.status} ${await finnhubResponse.text()}`);
      }

      // Alpha Vantage fallback
      if (!price || price <= 0) {
        source = 'alphavantage';
        console.log(`Attempting Alpha Vantage fallback for ${ticker}`);
        const alphaUrl = `https://www.alphavantage.co/query?function=GLOBAL_QUOTE&symbol=${ticker}&apikey=${alphaKey}`;
        const alphaResponse = await fetch(alphaUrl);
        if (alphaResponse.ok) {
          const alphaData = await alphaResponse.json();
          const quote = alphaData['Global Quote'];
          if (quote && quote['05. price']) {
            price = parseFloat(quote['05. price']);
            console.log(`Alpha Vantage price for ${ticker}: $${price}`);
          } else {
            console.warn(`No price data in Alpha Vantage response for ${ticker}`);
          }
        } else {
          console.error(`Alpha Vantage failed for ${ticker}: ${alphaResponse.status} ${await alphaResponse.text()}`);
          continue;
        }
      }

      if (price && price > 0) {
        await supabase.from('asset_prices').insert({ ticker, price, source });
        console.log(`Inserted ${source} price for ${ticker}: $${price}`);
      } else {
        console.warn(`No valid price inserted for ${ticker}`);
      }
    }
  }

  // Success → revalidate to show updated prices
  revalidatePath('/dashboard/portfolio')

  return {
    success: true,
    message: `Refreshed prices for ${cryptoTickers.length + stockTickers.length} assets.`,
  }
}
