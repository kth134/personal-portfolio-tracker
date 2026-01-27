import { createClient } from '@/lib/supabase/server';
import { NextResponse } from 'next/server';
import { format, differenceInDays, parseISO } from 'date-fns';
import { calculateIRR, normalizeTransactionToFlow } from '@/lib/finance';

/*
  Notes (canonical conventions):
  - Cash-flow normalization follows the rules in `src/lib/finance.ts` via
    `normalizeTransactionToFlow` (buys/sells, deposits/withdrawals, fees handling).
  - Grouping is performed by stable IDs (account.id, sub_portfolio.id, or explicit
    tag values). Transactions are fetched with joined asset/account fields so
    grouping/filtering is ID-based and unambiguous.
*/

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
          account:accounts!inner (id, name)
      `)
      .gt('remaining_quantity', 0)
      .eq('user_id', user.id);

    // Fetch transactions joined with asset and account metadata so we can
    // group and filter by IDs server-side (single query, then group in-memory).
    let txQuery = supabase
      .from('transactions')
      .select(`
        id,
        date,
        type,
        amount,
        fees,
        realized_gain,
        funding_source,
        notes,
        asset:assets (id, ticker, sub_portfolio_id, asset_type, asset_subtype, geography, size_tag, factor_tag),
        account:accounts (id, name)
      `)
      .gte('date', start)
      .lte('date', end)
      .eq('user_id', user.id);

    if (lens !== 'total' && selectedValues.length > 0) {
      // Simple tag filters (for string columns)
      if (['asset_type', 'asset_subtype', 'geography', 'size_tag', 'factor_tag'].includes(lens)) {
        lotsQuery = lotsQuery.in(`asset.${lens}`, selectedValues);
        txQuery = txQuery.in(`asset.${lens}`, selectedValues); // transactions don't have direct tag, but join later if needed
      } else if (lens === 'sub_portfolio') {
        // Filter by sub_portfolio id
        lotsQuery = lotsQuery.in('asset.sub_portfolio.id', selectedValues);
        txQuery = txQuery.in('asset.sub_portfolio_id', selectedValues);
      } else if (lens === 'account') {
        // Filter by account id
        lotsQuery = lotsQuery.in('account.id', selectedValues);
        txQuery = txQuery.in('account.id', selectedValues);
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

    // Unique tickers for portfolio + benchmarks (normalize joined shapes)
    const portfolioTickers = [...new Set(lotsTyped.map(l => {
      const asset = Array.isArray(l.asset) ? l.asset[0] : l.asset;
      return asset?.ticker;
    }))];
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

    // Group lots by lens using IDs for correctness. Keep a display name map
    // so the UI still receives readable labels while we filter/group by IDs.
    const groups = new Map<string, { name: string; lots: any[] }>();
    const groupMeta = new Map<string, string>(); // id -> display name

    lotsTyped.forEach(lot => {
      const asset = Array.isArray(lot.asset) ? lot.asset[0] : lot.asset;
      const account = Array.isArray(lot.account) ? lot.account[0] : lot.account;
      let idKey = 'portfolio';
      let display = 'Portfolio';
      if (lens !== 'total') {
        switch (lens) {
          case 'sub_portfolio':
            idKey = String(asset?.sub_portfolio?.id ?? 'unassigned');
            display = asset?.sub_portfolio?.name ?? 'Untagged';
            break;
          case 'account':
            idKey = String(account?.id ?? 'unassigned');
            display = account?.name ?? 'Untagged';
            break;
          default:
            // For tag-like lenses (strings on the asset), use the tag value as the id/display.
            idKey = String(asset?.[lens] ?? 'Untagged');
            display = idKey;
        }
      }

      // If the caller passed selectedValues, treat them as IDs (or tag values)
      if (lens !== 'total' && Array.isArray(selectedValues) && selectedValues.length > 0 && !selectedValues.includes(idKey)) return;

      if (!groups.has(idKey)) {
        groups.set(idKey, { name: display, lots: [] });
        groupMeta.set(idKey, display);
      }
      groups.get(idKey)!.lots.push(lot);
    });

    // Compute daily values per group
    const groupValues = new Map<string, number[]>();
    groups.forEach(({ lots: groupLots }, key) => {
      const values = dates.map(date => {
        return groupLots.reduce((sum, lot) => {
          const asset = Array.isArray(lot.asset) ? lot.asset[0] : lot.asset;
          const series = historicalData[asset?.ticker] || [];
          let price = series.find(p => p.date === date)?.close || 0;
          if (price === 0) {
            // Forward fill: find the most recent available price up to this date
            for (let i = series.length - 1; i >= 0; i--) {
              if (series[i].date <= date) {
                price = series[i].close;
                break;
              }
            }
          }
          return sum + (Number(lot.remaining_quantity) || 0) * price;
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

    // If requested, add an aggregated 'Portfolio' group summing all groups so
    // we can compute portfolio-level TWR/MWR when `aggregate` is true.
    if (aggregate && groups.size > 1) {
      const groupKeys = Array.from(groupValues.keys());
      const aggValues = dates.map((_, i) => {
        return groupKeys.reduce((s, k) => s + ((groupValues.get(k) || [])[i] || 0), 0);
      });
      groupValues.set('Portfolio', aggValues);
      initialByGroup.set('Portfolio', aggValues[0] || 1);
      finalByGroup.set('Portfolio', aggValues[aggValues.length - 1] || 1);
    }

    // TWR per group
    const twrByGroup = new Map<string, number>();
    groupValues.forEach((vals, key) => {
      const init = initialByGroup.get(key) || 1;
      twrByGroup.set(key, init > 0 ? (vals[vals.length - 1] / init) - 1 : 0);
    });

    // MWR per group (cash flows + final value) — normalize flows and use centralized IRR
    const mwrByGroup = new Map<string, number>();
    // Group transactions by the same ID keys so MWR includes only group-relevant flows.
    const txsByGroup = new Map<string, any[]>();
    (transactions || []).forEach((tx: any) => {
      // Normalize joined shapes (Supabase may return joins as arrays)
      const txAsset = Array.isArray(tx.asset) ? tx.asset[0] : tx.asset;
      const txAccount = Array.isArray(tx.account) ? tx.account[0] : tx.account;

      // Determine tx's group id according to the lens (use joined asset/account fields)
      let txGroupId = 'portfolio';
      if (lens !== 'total') {
        switch (lens) {
          case 'sub_portfolio':
            txGroupId = String(txAsset?.sub_portfolio_id ?? 'unassigned');
            break;
          case 'account':
            txGroupId = String(txAccount?.id ?? 'unassigned');
            break;
          default:
            txGroupId = String(txAsset?.[lens] ?? 'Untagged');
        }
      }
      // Only include transactions for groups we care about (selectedValues filter applied earlier to lots)
      if (groups.has(txGroupId)) {
        if (!txsByGroup.has(txGroupId)) txsByGroup.set(txGroupId, []);
        txsByGroup.get(txGroupId)!.push(tx);
      }
    });

    // Compute MWR per group and also compute Portfolio MWR when present
    groups.forEach((_, key) => {
      const groupTx = txsByGroup.get(key) || [];

      const cfs: number[] = [];
      const cfDates: Date[] = [];
      groupTx.forEach((tx: any) => {
        const d = parseISO(tx.date);
        if (isNaN(d.getTime())) return;
        cfs.push(normalizeTransactionToFlow(tx));
        cfDates.push(d);
      });

      const finalVal = finalByGroup.get(key) || 0;
      cfs.push(finalVal);
      cfDates.push(endDate);

      const irr = cfs.length > 1 ? calculateIRR(cfs, cfDates) : NaN;
      mwrByGroup.set(key, irr); // may be NaN — handle fallback when producing metrics
    });

    // If we added an aggregated 'Portfolio' key earlier, compute its MWR from
    // the union of group transactions and the aggregated final value.
    if (groupValues.has('Portfolio')) {
      const portfolioTxs = Array.from(txsByGroup.values()).flat();
      const cfs: number[] = [];
      const cfDates: Date[] = [];
      portfolioTxs.forEach((tx: any) => {
        const d = parseISO(tx.date);
        if (isNaN(d.getTime())) return;
        cfs.push(normalizeTransactionToFlow(tx));
        cfDates.push(d);
      });
      const finalVal = finalByGroup.get('Portfolio') || 0;
      cfs.push(finalVal);
      cfDates.push(endDate);
      const irr = cfs.length > 1 ? calculateIRR(cfs, cfDates) : NaN;
      mwrByGroup.set('Portfolio', irr);
    }

    // Net gains per group (all time filtered)
    const netGainByGroup = new Map<string, number>();
    // Compute net gains per group using only transactions assigned to that group
    groups.forEach(({ lots: groupLots }, key) => {
      const unreal = (finalByGroup.get(key) || 0) - groupLots.reduce((sum, l) => sum + (Number(l.remaining_quantity) || 0) * Number(l.cost_basis_per_unit || 0), 0);
      const groupTxs = txsByGroup.get(key) || [];
      const realized = groupTxs.reduce((sum: number, t: any) => sum + (t.realized_gain || 0), 0);
      const div = groupTxs.filter((t: any) => t.type === 'Dividend' || t.type === 'Interest').reduce((sum: number, t: any) => sum + (Number(t.amount) || 0), 0);
      const fees = groupTxs.reduce((sum: number, t: any) => sum + Math.abs(Number(t.fees) || 0), 0);
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
      const twrVal = twrByGroup.get(key) || 0;
      const mwrVal = mwrByGroup.get(key); // may be NaN

      // Determine totalReturn for display purposes (keep previous behavior: twr is multi-period return)
      const totalReturn = metric === 'twr' ? twrVal : (!isNaN(mwrVal as number) ? (mwrVal as number) : twrVal);

      // Annualized: if TWR metric, annualize the multi-period totalReturn; if MWR metric, use IRR (already annual).
      let annualized: number;
      if (metric === 'twr') {
        annualized = years > 0 ? Math.pow(1 + twrVal, 1 / years) - 1 : twrVal;
      } else {
        // MWR
        if (!isNaN(mwrVal as number)) annualized = mwrVal as number;
        else annualized = years > 0 ? Math.pow(1 + twrVal, 1 / years) - 1 : twrVal; // fallback
      }

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