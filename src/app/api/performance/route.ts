// app/api/performance/route.ts (final version)
import { supabaseServer } from '@/lib/supabase/server';
import { NextResponse } from 'next/server';
import { subDays, subMonths, subYears, format, differenceInDays } from 'date-fns';

function calculateIRR(cashFlows: number[], dates: Date[]): number {
  // unchanged from before
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

export async function POST(request: Request) {
  try {
    const {
      period = '1Y',
      lens = 'all',
      metricType = 'mwr',
      benchmarks = ['SPX', 'IXIC', 'BTCUSD']
    } = await request.json();

    const supabase = await supabaseServer();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) throw new Error('Unauthorized');

    const today = new Date();

    let startDate: Date;
    if (period === 'All') {
      const { data: first } = await supabase.from('transactions').select('date').order('date').limit(1).eq('user_id', user.id);
      startDate = first?.[0] ? new Date(first[0].date) : subYears(today, 5);
    } else {
      switch (period) {
        case '1D': startDate = subDays(today, 1); break;
        case '1M': startDate = subMonths(today, 1); break;
        case '1Y': startDate = subYears(today, 1); break;
        default: startDate = subYears(today, 5);
      }
    }

    const startStr = format(startDate, 'yyyy-MM-dd');
    const endStr = format(today, 'yyyy-MM-dd');

    // Tax lots (current holdings – filtered)
    const lotsSelectFields = lens !== 'all' 
      ? `remaining_quantity, cost_basis_per_unit, asset_id, asset:assets!inner(ticker, ${lens})`
      : `remaining_quantity, cost_basis_per_unit, asset_id, asset:assets!inner(ticker)`;
    let lotsQuery = supabase.from('tax_lots').select(lotsSelectFields).gt('remaining_quantity', 0).eq('user_id', user.id);
    if (lens !== 'all') {
      lotsQuery = lotsQuery.ilike(`asset.${lens}`, '%');
    }
    const { data: lots } = await lotsQuery;

    // Define the type for lot entries
    type LotEntry = {
      remaining_quantity: number;
      cost_basis_per_unit: number;
      asset_id: string;
      asset: { ticker: string } | null;
    };

    // Filter out any error entries and ensure proper typing
    const validLots = ((lots || []) as unknown as LotEntry[]).filter((lot): lot is LotEntry & { asset: { ticker: string } } => 
      lot !== null && lot.asset !== null && typeof lot.asset === 'object' && 'ticker' in lot.asset
    );

    // Transactions for flows
    const txSelectFields = lens !== 'all'
      ? `*, asset:assets!inner(ticker, ${lens})`
      : `*, asset:assets!inner(ticker)`;
    let txQuery = supabase.from('transactions').select(txSelectFields).gte('date', startStr).lte('date', endStr).eq('user_id', user.id);
    if (lens !== 'all') {
      txQuery = txQuery.ilike(`asset.${lens}`, '%');
    }
    const { data: transactionsRaw } = await txQuery;

    // Define the type for transaction entries
    type TransactionEntry = {
      date: string;
      type: string;
      amount: number | null;
      fees: number | null;
      realized_gain: number | null;
      asset: { ticker: string } | null;
    };

    // Filter out any error entries and ensure proper typing
    const transactions = ((transactionsRaw || []) as unknown as TransactionEntry[]).filter((tx): tx is TransactionEntry => 
      tx !== null && typeof tx === 'object' && 'date' in tx
    );

    // All tickers needed
    const assetTickers = [...new Set(validLots.map(l => l.asset.ticker))];
    const allTickers = [...assetTickers, ...benchmarks];

    // Fetch historical prices
    const baseUrl = process.env.NEXT_PUBLIC_BASE_URL || 'http://localhost:3000';
    const histRes = await fetch(`${baseUrl}/api/historical-prices`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ tickers: allTickers, startDate: startStr, endDate: endStr })
    });
    const { historicalData } = await histRes.json() as { historicalData: Record<string, { date: string; close: number }[]> };

    // Build portfolio value time series (daily)
    const dates = Object.values(historicalData)[0]?.map((d) => d.date) || [];
    const portfolioSeries = dates.map((date: string) => {
      const value = validLots.reduce((sum, lot) => {
        const price = historicalData[lot.asset.ticker]?.find((p: any) => p.date === date)?.close || 0;
        return sum + lot.remaining_quantity * price;
      }, 0);
      return { date, value };
    });

    // Normalize to cumulative return % (starting at 0%)
    const initialPortfolioValue = portfolioSeries[0]?.value || 1;
    const portfolioNormalized: { date: string; portfolio: number; [key: string]: number | string }[] = portfolioSeries.map(p => ({
      date: p.date,
      portfolio: ((p.value / initialPortfolioValue) - 1) * 100
    }));

    // Benchmarks normalized
    benchmarks.forEach((b: string) => {
      const series = historicalData[b] || [];
      const init = series[0]?.close || 1;
      series.forEach((p: { date: string; close: number }, i: number) => {
        portfolioNormalized[i][b] = ((p.close / init) - 1) * 100;
      });
    });

    // Factors (current)
    const realized = transactions?.reduce((s, t) => s + (t.realized_gain || 0), 0) || 0;
    const dividends = transactions?.filter(t => t.type === 'Dividend').reduce((s, t) => s + (t.amount || 0), 0) || 0;
    const fees = transactions?.reduce((s, t) => s + Math.abs(t.fees || 0), 0) || 0;
    const basis = validLots.reduce((s, l) => s + l.remaining_quantity * l.cost_basis_per_unit, 0);
    const currentValue = portfolioSeries[portfolioSeries.length - 1]?.value || 0;
    const unrealized = currentValue - basis;

    // Returns
    let totalReturn = 0;
    if (initialPortfolioValue > 0) {
      totalReturn = (currentValue / initialPortfolioValue) - 1;
    }

    // Simple TWR ≈ total return (with historical it's very close)
    const twr = totalReturn;
    const mwr = transactions?.length ? calculateIRR(
      transactions.map(tx => {
        let f = 0;
        if (tx.type === 'Buy') f = -(tx.amount || 0);
        if (tx.type === 'Sell') f = tx.amount || 0;
        if (tx.type === 'Dividend') f = tx.amount || 0;
        f -= (tx.fees || 0);
        return f;
      }).concat(currentValue),
      transactions.map(tx => new Date(tx.date)).concat(today)
    ) : totalReturn;

    const finalReturn = metricType === 'twr' ? twr : mwr;
    const years = differenceInDays(today, startDate) / 365.25;
    const annualized = years > 0 ? Math.pow(1 + finalReturn, 1 / years) - 1 : finalReturn;

    return NextResponse.json({
      totalReturn: finalReturn,
      annualized,
      factors: { unrealized, realized, dividends, fees },
      series: portfolioNormalized // For line chart
    });
  } catch (error) {
    console.error(error);
    return NextResponse.json({ error: (error as Error).message }, { status: 500 });
  }
}