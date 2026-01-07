import { supabaseServer } from '@/lib/supabase/server';
import { NextResponse } from 'next/server';

export async function GET() {
  try {
    const supabase = await supabaseServer();
    // Fetch unique tickers from user's assets (scoped to user_id for multi-user future-proofing)
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) throw new Error('Unauthorized');

    const { data: assets, error: assetsError } = await supabase
      .from('assets')
      .select('ticker, asset_subtype')
      .eq('user_id', user.id);
const idMap: Record<string, string> = {
  btc: 'bitcoin',
  eth: 'ethereum',
  // Add more common ones as needed, e.g., sol: 'solana', doge: 'dogecoin'
};
    if (assetsError) throw assetsError;

    const uniqueTickers = [...new Set(assets?.map(a => a.ticker) || [])];
    if (!uniqueTickers.length) {
      console.log('No assets found; skipping price fetch');
      return NextResponse.json({ success: true, message: 'No assets' });
    }

    // Split by type (assuming asset_subtype 'crypto' for CoinGecko, else Polygon)
    const cryptoAssets = assets?.filter(a => a.asset_subtype?.toLowerCase() === 'crypto') || [];
const cryptoTickers = cryptoAssets.map(a => a.ticker.toUpperCase()); // Keep original for insert

const stockAssets = assets?.filter(a => a.asset_subtype?.toLowerCase() !== 'crypto') || [];
const stockTickers = stockAssets.map(a => a.ticker.toUpperCase());
   
// CoinGecko fetch (no API key needed)
if (cryptoTickers.length) {
  const cgIds = cryptoTickers.map(t => idMap[t.toLowerCase()] || t.toLowerCase()); // Map BTC -> bitcoin
  const cgUrl = `https://api.coingecko.com/api/v3/simple/price?ids=${cgIds.join(',')}&vs_currencies=usd`;
  const cgResponse = await fetch(cgUrl);
  if (!cgResponse.ok) {
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

    // Polygon fetch (requires API key)
    if (stockTickers.length) {
      const apiKey = process.env.POLYGON_API_KEY;
      if (!apiKey) throw new Error('Missing POLYGON_API_KEY');
      for (const ticker of stockTickers) {
        const polyUrl = `https://api.polygon.io/v2/aggs/ticker/${ticker}/prev?apiKey=${apiKey}`;
        const polyResponse = await fetch(polyUrl);
        if (!polyResponse.ok) {
          console.error(`Polygon error for ${ticker}: ${polyResponse.statusText}`);
          continue;  // Skip individual failures
        }
        const polyData = await polyResponse.json();
        const price = polyData.results?.[0]?.c;
        if (price) {
          await supabase.from('asset_prices').insert({ ticker, price, source: 'polygon' });
          console.log(`Inserted price for ${ticker}: $${price}`);
        }
      }
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Price fetch error:', error);
    return NextResponse.json({ success: false, error: (error as Error).message }, { status: 500 });
  }
}