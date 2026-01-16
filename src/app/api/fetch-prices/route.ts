import { createClient } from '@/lib/supabase/server';
import { NextResponse } from 'next/server';

export async function GET() {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) throw new Error('Unauthorized');

    const { data: assets, error: assetsError } = await supabase
      .from('assets')
      .select('ticker, asset_subtype')
      .eq('user_id', user.id);

    const idMap: Record<string, string> = {
      BTC: 'bitcoin',
      BITCOIN: 'bitcoin',
      ETH: 'ethereum',
      ETHEREUM: 'ethereum',
    };
    if (assetsError) throw assetsError;

    const uniqueTickers = [...new Set(assets?.map((a: any) => a.ticker) || [])];
    if (!uniqueTickers.length) {
      console.log('No assets found; skipping price fetch');
      return NextResponse.json({ success: true, message: 'No assets' });
    }

    const cryptoAssets = assets?.filter((a: any) => a.asset_subtype?.toLowerCase() === 'crypto') || [];
    const cryptoTickers = cryptoAssets.map((a: any) => a.ticker.toUpperCase());

    const stockAssets = assets?.filter((a: any) => a.asset_subtype?.toLowerCase() !== 'crypto') || [];
    const stockTickers = stockAssets.map((a: any) => a.ticker.toUpperCase());

    // CoinGecko for crypto (unchanged)
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

    // Finnhub primary + Alpha Vantage fallback
    if (stockTickers.length) {
      const finnhubKey = process.env.FINNHUB_API_KEY;
      const alphaKey = process.env.ALPHA_VANTAGE_API_KEY;
      if (!finnhubKey) throw new Error('Missing FINNHUB_API_KEY');
      if (!alphaKey) throw new Error('Missing ALPHA_VANTAGE_API_KEY for mutual fund fallback');

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

        // Alpha Vantage fallback (mutual funds + backup for others)
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
            continue; // Skip insert if both fail
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

    return NextResponse.json({ success: true, inserted: { crypto: cryptoTickers.length, stocks: stockTickers.length } });
  } catch (error) {
    console.error('Price fetch error:', error);
    return NextResponse.json({ success: false, error: (error as Error).message }, { status: 500 });
  }
}