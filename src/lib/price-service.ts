import { createClient } from './supabase/server';

/**
 * Centralized service to fetch and cache asset prices.
 * Uses Polygon as primary source with local Supabase caching.
 */
export async function updateAssetPrices(tickers: string[]) {
  const supabase = await createClient();
  const polygonKey = process.env.POLYGON_API_KEY;

  if (!polygonKey) throw new Error('POLYGON_API_KEY not found');

  // Filter out duplicates and empty strings
  const uniqueTickers = [...new Set(tickers.filter(Boolean))];
  
  // TO OPTIMIZE: Use Polygon Snapshot API to get all prices in ONE request
  // This is significantly faster than looping.
  const url = `https://api.polygon.io/v2/snapshot/locale/us/markets/stocks/tickers?tickers=${uniqueTickers.join(',')}&apiKey=${polygonKey}`;
  
  try {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`Polygon Snapshot failed: ${res.statusText}`);
    
    const data = await res.json();
    const updates = data.tickers?.map((t: any) => ({
      ticker: t.ticker,
      price: t.day.c || t.lastTrade.p,
      source: 'polygon',
      timestamp: new Date().toISOString()
    })) || [];

    if (updates.length > 0) {
      const { error } = await supabase.from('asset_prices').insert(updates);
      if (error) throw error;
    }

    return { 
      success: true, 
      count: updates.length,
      tickers: updates.map((u: any) => u.ticker)
    };
  } catch (err) {
    console.error('Price Update Error:', err);
    return { success: false, error: (err as Error).message };
  }
}
