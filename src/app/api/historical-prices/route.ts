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

    const apiKey = process.env.FINNHUB_API_KEY;
    if (!apiKey) throw new Error('Missing FINNHUB_API_KEY');

    // Build absolute base URL for any internal calls (prevents relative URL issues)
    const baseUrl = process.env.NEXT_PUBLIC_BASE_URL || 'http://localhost:3000';

    const from = getUnixTime(new Date(startDate));
    const to = getUnixTime(new Date(endDate));

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

      if (ticker === 'BTCUSD' || ticker.toLowerCase().includes('usd')) {
        // CoinGecko fallback for crypto benchmarks
        const cgId = ticker === 'BTCUSD' ? 'bitcoin' : ticker.toLowerCase().replace('usd', '');
        const cgUrl = `https://api.coingecko.com/api/v3/coins/${cgId}/market_chart/range?vs_currency=usd&from=${from}&to=${to}`;
        const res = await fetch(cgUrl);
        if (res.ok) {
          const { prices: cg } = await res.json();
          prices = cg.map(([ts, p]: [number, number]) => ({
            date: format(new Date(ts), 'yyyy-MM-dd'),
            close: p
          }));
        }
      } else {
        // Finnhub for stocks/indices (SPX, IXIC, etc.)
        const url = `https://finnhub.io/api/v1/stock/candle?symbol=${ticker}&resolution=D&from=${from}&to=${to}&token=${apiKey}`;
        const res = await fetch(url);
        if (res.ok) {
          const data = await res.json();
          if (data.c?.length) {
            prices = data.t.map((ts: number, i: number) => ({
              date: format(new Date(ts * 1000), 'yyyy-MM-dd'),
              close: data.c[i]
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
            source: ticker === 'BTCUSD' ? 'coingecko' : 'finnhub'
          }))
        );
      }
    }

    return NextResponse.json({ historicalData });
  } catch (error) {
    console.error('Historical prices error:', error);
    return NextResponse.json({ error: (error as Error).message }, { status: 500 });
  }
}