import { createClient } from '@/lib/supabase/server';
import { NextResponse } from 'next/server';

export async function GET() {
  try {
    const supabase = await createClient();
    // Fetch unique tickers from user's assets (scoped to user_id for multi-user future-proofing)
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) throw new Error('Unauthorized');

    const { data: assets, error: assetsError } = await supabase
      .from('assets')
      .select('ticker, asset_subtype')
      .eq('user_id', user.id);
    const idMap: Record<string, string> = {
      BTC: 'bitcoin',
      ETH: 'ethereum',
      // Add more common ones as needed, e.g., SOL: 'solana', DOGE: 'dogecoin'
    };
    if (assetsError) throw assetsError;

    const uniqueTickers = [...new Set(assets?.map((a: any) => a.ticker) || [])];
    if (!uniqueTickers.length) {
      console.log('No assets found; skipping price fetch');
      return NextResponse.json({ success: true, message: 'No assets' });
    }

    // Split by type (assuming asset_subtype 'crypto' for CoinGecko, else Finnhub)
    const cryptoAssets = assets?.filter((a: any) => a.asset_subtype?.toLowerCase() === 'crypto') || [];
    const cryptoTickers = cryptoAssets.map((a: any) => a.ticker.toUpperCase()); // Keep original for insert

    const stockAssets = assets?.filter((a: any) => a.asset_subtype?.toLowerCase() !== 'crypto') || [];
    const stockTickers = stockAssets.map((a: any) => a.ticker.toUpperCase());

    // CoinGecko fetch (no API key needed) – unchanged
    if (cryptoTickers.length) {
      const cgIds = cryptoTickers.map((t: any) => idMap[t] || t.toLowerCase());
      const cgUrl = `https://api.coingecko.com/api/v3/simple/price?ids=${cgIds.join(',')}&vs_currencies=usd`;
      const cgResponse = await fetch(cgUrl);
      if (!cgResponse.ok) {
        console.error(`CoinGecko error: ${cgResponse.statusText} for tickers ${cgIds.join(',')}`);
        console.error(`CoinGecko error: ${cgResponse.statusText}`);
      } else {
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
      }
    }

    // Finnhub fetch for stocks, ETFs, indices (replaces Polygon)
    if (stockTickers.length) {
      const apiKey = process.env.FINNHUB_API_KEY;
      if (!apiKey) throw new Error('Missing FINNHUB_API_KEY');

      for (const ticker of stockTickers) {
        // Primary: Finnhub /quote
        let price: number | undefined;
        let source = 'finnhub';
        const finnhubUrl = `https://finnhub.io/api/v1/quote?symbol=${ticker}&token=${apiKey}`;
        const finnhubResponse = await fetch(finnhubUrl);
        if (finnhubResponse.ok) {
          const finnhubData = await finnhubResponse.json();
          price = finnhubData.c; // 'c' = current close price
        } else {
          console.error(`Finnhub error for ${ticker}: ${finnhubResponse.statusText}`);
        }

        // Fallback: If Finnhub price invalid (e.g., for mutual funds), try Yahoo Finance
        if (!price || price <= 0) {
          source = 'yahoo';
          const yahooUrl = `https://query1.finance.yahoo.com/v7/finance/quote?symbols=${ticker}`;
          const yahooResponse = await fetch(yahooUrl);
          if (yahooResponse.ok) {
            const yahooData = await yahooResponse.json();
            price = yahooData.quoteResponse?.result?.[0]?.regularMarketPrice;
          } else {
            console.error(`Yahoo fallback error for ${ticker}: ${yahooResponse.statusText}`);
            continue; // Skip if both fail
          }
        }

        if (price && price > 0) {
          await supabase.from('asset_prices').insert({ ticker, price, source });
          console.log(`Inserted ${source} price for ${ticker}: $${price}`);
        } else {
          console.warn(`Invalid price for ${ticker}: ${price}`);
        }
      }
    }

    return NextResponse.json({ success: true, inserted: { crypto: cryptoTickers.length, stocks: stockTickers.length } });
  } catch (error) {
    console.error('Price fetch error:', error);
    return NextResponse.json({ success: false, error: (error as Error).message }, { status: 500 });
  }
}