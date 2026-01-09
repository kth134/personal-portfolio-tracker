// app/api/historical-prices/route.ts
import { supabaseServer } from '@/lib/supabase/server';
import { NextResponse } from 'next/server';
import { format, getUnixTime } from 'date-fns';

export async function POST(request: Request) {
  try {
    const { tickers, startDate, endDate } = await request.json(); // dates as 'YYYY-MM-DD'
    if (!tickers?.length || !startDate || !endDate) {
      return NextResponse.json({ error: 'Missing parameters' }, { status: 400 });
    }

    const supabase = await supabaseServer();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) throw new Error('Unauthorized');

    const polygonKey = process.env.POLYGON_API_KEY;
    if (!polygonKey) throw new Error('Missing POLYGON_API_KEY');

    // Build absolute base URL for any internal calls (prevents relative URL issues)
    const baseUrl = process.env.NEXT_PUBLIC_BASE_URL || 'http://localhost:3000';

    const from = getUnixTime(new Date(startDate));
    const to = getUnixTime(new Date(endDate));

    const tickerMap: Record<string, string> = {
      SPX: '^GSPC',
      IXIC: '^IXIC',
      BTCUSD: 'bitcoin',
    };

    const historicalData: Record<string, { date: string; close: number }[]> = {};

    for (const ticker of tickers) {
      // Try DB first (daily closes)
      const { data: cached } = await supabase
        .from('asset_prices')
        .select('timestamp, price')
        .eq('ticker', ticker)
        .gte('timestamp', startDate)
        .lte('timestamp', endDate)
        .order('timestamp', { ascending: true });

      if (cached && cached.length > 0) {
        historicalData[ticker] = cached.map(r => ({
          date: format(new Date(r.timestamp), 'yyyy-MM-dd'),
          close: r.price
        }));
        continue;
      }

      // Fetch live
      let prices: { date: string; close: number }[] = [];

      const isCrypto = ticker.toLowerCase().includes('usd') || ticker === 'BTCUSD';
      if (isCrypto) {
        const cgId = tickerMap[ticker] || ticker.toLowerCase().replace('usd', '');
        const cgUrl = `https://api.coingecko.com/api/v3/coins/${cgId}/market_chart/range?vs_currency=usd&from=${from}&to=${to}`;
        const res = await fetch(cgUrl);
        if (!res.ok) {
          console.error(`CoinGecko historical error for ${cgId}: ${res.statusText}`);
          prices = [];
        } else {
          const { prices: cg } = await res.json();
          prices = cg.map(([ts, p]: [number, number]) => ({
            date: format(new Date(ts), 'yyyy-MM-dd'),
            close: p
          }));
        }
      } else {
        const polygonTicker = tickerMap[ticker] || ticker;
        const url = `https://api.polygon.io/v2/aggs/ticker/${polygonTicker}/range/1/day/${startDate}/${endDate}?apiKey=${polygonKey}`;
        const res = await fetch(url);
        if (!res.ok) {
          console.error(`Polygon historical error for ${polygonTicker}: ${res.statusText}`);
          prices = [];
        } else {
          const data = await res.json();
          if (data.results?.length) {
            prices = data.results.map((r: any) => ({
              date: format(new Date(r.t), 'yyyy-MM-dd'), // Polygon t is ms
              close: r.c
            }));
          }
        }
      }

      if (prices.length) {
        historicalData[ticker] = prices;
        // Cache in DB
        await supabase.from('asset_prices').insert(
          prices.map(p => ({
            ticker,
            price: p.close,
            timestamp: p.date,
            source: isCrypto ? 'coingecko' : 'polygon'
          }))
        );
      }
    }

    return NextResponse.json({ historicalData, fetched: Object.keys(historicalData).length });
  } catch (error) {
    console.error('Historical prices error:', error);
    return NextResponse.json({ error: (error as Error).message }, { status: 500 });
  }
}