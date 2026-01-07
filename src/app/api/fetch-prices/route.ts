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

    if (assetsError) throw assetsError;

    const uniqueTickers = [...new Set(assets?.map(a => a.ticker) || [])];
    if (!uniqueTickers.length) {
      console.log('No assets found; skipping price fetch');
      return NextResponse.json({ success: true, message: 'No assets' });
    }

    // Split by type (assuming asset_subtype 'crypto' for CoinGecko, else Polygon)
    const cryptoTickers = assets?.filter(a => a.asset_subtype === 'crypto').map(a => a.ticker.toLowerCase()) || [];
    const stockTickers = assets?.filter(a => a.asset_subtype !== 'crypto').map(a => a.ticker.toUpperCase()) || [];

    // CoinGecko fetch (no API key needed)
    if (cryptoTickers.length) {
      const cgUrl = `https://api.coingecko.com/api/v3/simple/price?ids=${cryptoTickers.join(',')}&vs_currencies=usd`;
      const cgResponse = await fetch(cgUrl);
      if (!cgResponse.ok) throw new Error(`CoinGecko error: ${cgResponse.statusText}`);
      const cgPrices = await cgResponse.json();
      for (const ticker in cgPrices) {
        const price = cgPrices[ticker]?.usd;
        if (price) {
          await supabase.from('asset_prices').insert({ ticker: ticker.toUpperCase(), price, source: 'coingecko' });
          console.log(`Inserted price for ${ticker}: $${price}`);
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