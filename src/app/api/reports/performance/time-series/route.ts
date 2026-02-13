import { createClient } from '@/lib/supabase/server';
import { NextRequest, NextResponse } from 'next/server';
import { format, parseISO, addDays } from 'date-fns';
import { calculateIRR, normalizeTransactionToFlow, logCashFlows, netCashFlowsByDate, transactionFlowForIRR, calculateCashBalances } from '@/lib/finance';

const LENSES = [
  { value: 'total', label: 'Total Portfolio' },
  { value: 'asset', label: 'Asset' },
  { value: 'asset_type', label: 'Asset Type' },
  { value: 'asset_subtype', label: 'Asset Sub-Type' },
  { value: 'sub_portfolio', label: 'Sub-Portfolio' },
  { value: 'account', label: 'Account' },
  { value: 'geography', label: 'Geography' },
  { value: 'size_tag', label: 'Size' },
  { value: 'factor_tag', label: 'Factor' },
];

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const {
      lens = 'total',
      aggregate = true,
      selectedValues = [],
      start = '2020-01-01',
      end = format(new Date(), 'yyyy-MM-dd'),
      granularity = 'month',
      benchmarks = ['SPX', 'IXIC', 'TLT', 'VXUS'],
    } = body;

    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    const userId = user.id;

    const startDate = parseISO(start);
    const endDate = parseISO(end);

    // Fetch lots and transactions (join asset/account for grouping/filtering)
    const { data: lots } = await supabase
      .from('tax_lots')
      .select(`
        *,
        asset:assets!inner (*, sub_portfolios (*), accounts (*))
      `)
      .gt('remaining_quantity', 0)
      .eq('user_id', userId);

    const { data: transactions } = await supabase
      .from('transactions')
      .select(`
        *,
        asset:assets!inner (*, sub_portfolios (*), accounts (*))
      `)
      .gte('date', start)
      .lte('date', end)
      .eq('user_id', userId);

    if (!lots || lots.length === 0) {
      return NextResponse.json({ series: [], metrics: [], benchmarks: null });
    }

    // Portfolio tickers
    const portfolioTickers = [...new Set(lots.map((l: any) => l.asset?.ticker))];

    // Fetch historical prices (Finnhub/Alpha/CoinGecko pattern from code)
    const historicalData: Record<string, { date: string; close: number }[]> = await fetchHistoricalPrices(portfolioTickers, benchmarks, startDate, endDate, supabase);

    // Dates
    const dates = Object.values(historicalData).flatMap(s => s.map(p => p.date)).filter(Boolean).sort();
    const uniqueDates = [...new Set(dates)];

    // Group lots by lens
    const groups = new Map();
    lots.forEach((lot: any) => {
      let key = 'total';
      let display = 'Portfolio';
      const asset = lot.asset;
      switch (lens) {
        case 'sub_portfolio':
          key = asset.sub_portfolios?.id || 'untagged';
          display = asset.sub_portfolios?.name || 'Untagged';
          break;
        case 'account':
          key = asset.accounts?.id || 'untagged';
          display = asset.accounts?.name || 'Untagged';
          break;
        case 'asset':
          key = asset.id;
          display = asset.ticker;
          break;
        // Add more
        default:
          key = asset[lens] || 'untagged';
      }
      if (!groups.has(key)) groups.set(key, { name: display, lots: [], tx: [] });
      groups.get(key).lots.push(lot);
    });

    // TWR/MWR per group (copy dashboard/performance pattern)
    const series = [];
    // ... (implement TWR MWR agg/non-agg like dashboard)

    return NextResponse.json({ series, metrics: [], benchmarks: historicalData });
  } catch (error) {
    console.error(error);
    return NextResponse.json({ error: 'Internal error' }, { status: 500 });
  }
}

// Stub fetchHistoricalPrices (extend Finnhub/Alpha/CoinGecko)
async function fetchHistoricalPrices(tickers: string[], benchmarks: string[], start: Date, end: Date, supabase: any) {
  // Implement Finnhub primary Alpha fallback CoinGecko crypto cache asset_prices
  return {};
}
