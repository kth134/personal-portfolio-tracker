import { createClient } from '@/lib/supabase/server';
import { NextResponse } from 'next/server';
import { format, differenceInDays, parseISO } from 'date-fns';

function calculateIRR(cashFlows: number[], dates: Date[]): number {
  let guess = 0.1;
  const maxIter = 100;
  const precision = 1e-8;
  for (let i = 0; i < maxIter; i++) {
    let npv = 0;
    let dnpv = 0;
    cashFlows.forEach((cf, j) => {
      const years = (dates[j].getTime() - dates[0].getTime()) / (365.25 * 24 * 60 * 60 * 1000);
      const denom = Math.pow(1 + guess, years);
      npv += cf / denom;
      dnpv -= years * cf / (denom * (1 + guess));
    });
    if (Math.abs(npv) < precision) return guess;
    guess -= npv / dnpv;
  }
  return NaN;
}

export async function POST(req: Request) {
  try {
    const {
      start,
      end,
      lens,
      selectedValues = [],
      aggregate = true,
      metric = 'twr',
      benchmarks = false,
    } = await req.json();

    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const startDate = parseISO(start);
    const endDate = parseISO(end);
    const days = differenceInDays(endDate, startDate) + 1;
    const years = days / 365.25;

    // Build filter condition for lens
    let lotsQuery = supabase
      .from('tax_lots')
      .select(`
        remaining_quantity,
        cost_basis_per_unit,
        asset_id,
        asset:assets (
          id,
          ticker,
          name,
          asset_type,
          asset_subtype,
          geography,
          size_tag,
          factor_tag,
          sub_portfolio:sub_portfolios!inner (id, name)
        ),
        account:accounts!inner (name)
      `)
      .gt('remaining_quantity', 0)
      .eq('user_id', user.id);

    let txQuery = supabase
      .from('transactions')
      .select('date, type, amount, fees, realized_gain, asset_id')
      .gte('date', start)
      .lte('date', end)
      .eq('user_id', user.id);

    if (lens !== 'total' && selectedValues.length > 0) {
      // Simple tag filters (for string columns)
      if (['asset_type', 'asset_subtype', 'geography', 'size_tag', 'factor_tag'].includes(lens)) {
        lotsQuery = lotsQuery.in(`asset.${lens}`, selectedValues);
        txQuery = txQuery.in(`asset.${lens}`, selectedValues); // transactions don't have direct tag, but join later if needed
      } else if (lens === 'sub_portfolio') {
        // Sub-portfolio uses name → need IDs or filter on name
        lotsQuery = lotsQuery.in('asset.sub_portfolio.name', selectedValues);
      } else if (lens === 'account') {
        lotsQuery = lotsQuery.in('account.name', selectedValues);
      }
    }

    const [{ data: lots }, { data: transactions }] = await Promise.all([lotsQuery, txQuery]);
    const lotsTyped = lots as any[];
    if (!lotsTyped || lotsTyped.length === 0) {
      return NextResponse.json({
        series: [],
        lines: [],
        metrics: [],
        benchmarks: null,
      });
    }

    // Unique tickers for portfolio + benchmarks
    const portfolioTickers = [...new Set(lotsTyped.map(l => l.asset.ticker))];
    const benchmarkTickers = benchmarks ? ['^GSPC', '^IXIC', 'BTCUSD'] : [];
    const allTickers = [...new Set([...portfolioTickers, ...benchmarkTickers])];

    // Fetch historical prices (reuse logic from your existing historical-prices route)
    const polygonKey = process.env.POLYGON_API_KEY;
    if (!polygonKey && benchmarkTickers.length > 0) throw new Error('Missing POLYGON_API_KEY');

    const historicalData: Record<string, { date: string; close: number }[]> = {};

    for (const ticker of allTickers) {
      // Try cached first
      const { data: cached } = await supabase
        .from('asset_prices')
        .select('timestamp, price')
        .eq('ticker', ticker)
        .gte('timestamp', start)
        .lte('timestamp', end)
        .order('timestamp', { ascending: true });

      if (cached && cached.length > 0) {
        historicalData[ticker] = cached.map((r: any) => ({
          date: format(parseISO(r.timestamp as string), 'yyyy-MM-dd'),
          close: r.price,
        }));
        continue;
      }

      // Live fetch
      let prices: { date: string; close: number }[] = [];
      const isBenchmark = benchmarkTickers.includes(ticker);
      const isCrypto = ticker === 'BTCUSD';

      if (isCrypto) {
        const cgId = 'bitcoin';
        const from = Math.floor(startDate.getTime() / 1000);
        const to = Math.floor(endDate.getTime() / 1000);
        const cgUrl = `https://api.coingecko.com/api/v3/coins/${cgId}/market_chart/range?vs_currency=usd&from=${from}&to=${to}`;
        const res = await fetch(cgUrl);
        if (res.ok) {
          const { prices: cg } = await res.json();
          prices = cg.map(([ts, p]: [number, number]) => ({
            date: format(new Date(ts), 'yyyy-MM-dd'),
            close: p,
          }));
        }
      } else {
        const polyTicker = ticker === '^GSPC' ? '^GSPC' : ticker === '^IXIC' ? '^IXIC' : ticker;
        const url = `https://api.polygon.io/v2/aggs/ticker/${polyTicker}/range/1/day/${start}/${end}?apiKey=${polygonKey}`;
        const res = await fetch(url);
        if (res.ok) {
          const data = await res.json();
          if (data.results?.length) {
            prices = data.results.map((r: any) => ({
              date: format(new Date(r.t), 'yyyy-MM-dd'),
              close: r.c,
            }));
          }
        }
      }

      if (prices.length > 0) {
        historicalData[ticker] = prices;
        // Cache
        await supabase.from('asset_prices').insert(
          prices.map(p => ({
            ticker,
            price: p.close,
            timestamp: p.date,
            source: isCrypto ? 'coingecko' : 'polygon',
          }))
        );
      }
    }

    // Unified dates
    const allDates = new Set<string>();
    Object.values(historicalData).forEach(series => series.forEach(e => allDates.add(e.date)));
    const dates = Array.from(allDates).sort();

    if (dates.length === 0) {
      return NextResponse.json({ series: [], lines: [], metrics: [], benchmarks: null });
    }

    // Group lots by lens key
    const groups = new Map<string, any[]>();
    lotsTyped.forEach(lot => {
      let key = 'Portfolio';
      if (lens !== 'total') {
        switch (lens) {
          case 'sub_portfolio': key = lot.asset.sub_portfolio?.name || 'Untagged'; break;
          case 'account': key = lot.account?.name || 'Untagged'; break;
          default: key = lot.asset[lens] || 'Untagged';
        }
      }
      if (!selectedValues.includes(key) && lens !== 'total') return; // filter
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key)!.push(lot);
    });

    // Compute daily values per group
    const groupValues = new Map<string, number[]>();
    groups.forEach((groupLots, key) => {
      const values = dates.map(date => {
        return groupLots.reduce((sum, lot) => {
          const series = historicalData[lot.asset.ticker] || [];
          let price = series.find(p => p.date === date)?.close || 0;
          if (price === 0) {
            // Forward fill
            for (let i = series.findIndex(p => p.date >= date); i >= 0; i--) {
              if (series[i]) {
                price = series[i].close;
                break;
              }
            }
          }
          return sum + lot.remaining_quantity * price;
        }, 0);
      });
      groupValues.set(key, values);
    });

    // Initial and final values
    const initialByGroup = new Map<string, number>();
    const finalByGroup = new Map<string, number>();
    groupValues.forEach((vals, key) => {
      initialByGroup.set(key, vals[0] || 1);
      finalByGroup.set(key, vals[vals.length - 1] || 1);
    });

    // TWR per group
    const twrByGroup = new Map<string, number>();
    groupValues.forEach((vals, key) => {
      const init = initialByGroup.get(key) || 1;
      twrByGroup.set(key, init > 0 ? (vals[vals.length - 1] / init) - 1 : 0);
    });

    // MWR per group (cash flows + final value)
    const mwrByGroup = new Map<string, number>();
    groups.forEach((_, key) => {
      const groupTx = (transactions || []).filter((tx: any) => {
        // Approximate filter - in real app, join properly
        return true; // refine with asset tag match
      });
      const cfs = groupTx.map((tx: any) => {
        let f = 0;
        if (tx.type === 'Buy') f = tx.amount || 0;
        if (tx.type === 'Sell') f = tx.amount || 0;
        if (tx.type === 'Dividend') f = (tx.amount || 0) - (tx.fees || 0);
        if (tx.type === 'Deposit') f = (tx.amount || 0) - (tx.fees || 0);
        if (tx.type === 'Withdrawal') f = -(Math.abs(tx.amount || 0)) - (tx.fees || 0);
        if (tx.type === 'Interest') f = (tx.amount || 0) - (tx.fees || 0);
        return f;
      });
      const finalVal = finalByGroup.get(key) || 0;
      cfs.push(finalVal);
      const cfDates = [...groupTx.map((t: any) => parseISO(t.date)), endDate];
      const irr = calculateIRR(cfs, cfDates);
      mwrByGroup.set(key, isNaN(irr) ? 0 : irr);
    });

    // Net gains per group (all time filtered)
    const netGainByGroup = new Map<string, number>();
    groups.forEach((groupLots, key) => {
      const unreal = finalByGroup.get(key)! - groupLots.reduce((sum, l) => sum + l.remaining_quantity * l.cost_basis_per_unit, 0);
      const realized = (transactions || []).reduce((sum: number, t: any) => sum + (t.realized_gain || 0), 0);
      const div = (transactions || []).filter((t: any) => t.type === 'Dividend' || t.type === 'Interest').reduce((sum: number, t: any) => sum + (t.amount || 0), 0);
      const fees = (transactions || []).reduce((sum: number, t: any) => sum + Math.abs(t.fees || 0), 0);
      netGainByGroup.set(key, unreal + realized + div - fees);
    });

    // Build series
    const series = dates.map((date, i) => {
      const entry: Record<string, string | number> = { date };
      groupValues.forEach((vals, key) => {
        const init = initialByGroup.get(key) || 1;
        entry[key] = init > 0 ? ((vals[i] / init) - 1) * 100 : 0;
      });
      if (benchmarks) {
        ['^GSPC', '^IXIC', 'BTCUSD'].forEach(t => {
          const series = historicalData[t] || [];
          const price = series.find(p => p.date === date)?.close || 0;
          const init = series[0]?.close || 1;
          entry[t === '^GSPC' ? 'SPX' : t === '^IXIC' ? 'IXIC' : 'BTCUSD'] = init > 0 ? ((price / init) - 1) * 100 : 0;
        });
      }
      return entry;
    });

    // Lines and metrics
    const lines: { key: string; name: string }[] = [];
    const metrics: { key: string; totalReturn: number; annualized: number; netGain: number }[] = [];

    const keys = aggregate && groups.size > 1 ? ['Portfolio'] : Array.from(groups.keys());
    keys.forEach(key => {
      const totalReturn = metric === 'twr' ? twrByGroup.get(key) || 0 : mwrByGroup.get(key) || 0;
      const annualized = years > 0 ? Math.pow(1 + totalReturn, 1 / years) - 1 : totalReturn;
      lines.push({ key, name: key });
      metrics.push({
        key,
        totalReturn,
        annualized,
        netGain: aggregate ? Array.from(netGainByGroup.values()).reduce((a, b) => a + b, 0) : netGainByGroup.get(key) || 0,
      });
    });

    return NextResponse.json({
      series,
      lines,
      metrics,
      benchmarks: benchmarks ? { SPX: true, IXIC: true, BTCUSD: true } : null,
    });
  } catch (err) {
    console.error('Performance API error:', err);
    return NextResponse.json({ error: 'Server error' }, { status: 500 });
  }
}