// src/app/api/performance/route.ts
import { supabaseServer } from '@/lib/supabase/server';
import { NextResponse } from 'next/server';
import { subDays, subMonths, subYears, format, differenceInDays } from 'date-fns';
import { POST as historicalPOST } from '../historical-prices/route';

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

    // Determine start date based on period
    let startDate: Date;
    if (period === 'All') {
      const { data: first } = await supabase
        .from('transactions')
        .select('date')
        .order('date')
        .limit(1)
        .eq('user_id', user.id);
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

    // === Fetch open tax lots — only ticker, quantity, and basis needed ===
    let lotsQuery = supabase
      .from('tax_lots')
      .select(`
        remaining_quantity,
        cost_basis_per_unit,
        asset:assets!inner (
          ticker
        )
      `)
      .gt('remaining_quantity', 0)
      .eq('user_id', user.id);

    // Apply lens filter if not 'all' (e.g., sub_portfolio = 'High-Growth')
    if (lens !== 'all') {
      lotsQuery = lotsQuery.ilike(`asset.${lens}`, '%');
    }

    const { data: lots, error: lotsError } = await lotsQuery;
    if (lotsError) {
      console.error('Tax lots query error:', lotsError);
      throw new Error(`Failed to fetch tax lots: ${lotsError.message}`);
    }

    console.log(`Fetched ${lots?.length || 0} open tax lots for lens: ${lens}`);

    type LotEntry = {
      remaining_quantity: number;
      cost_basis_per_unit: number;
      asset: { ticker: any; }[];
    };

    const validLots: LotEntry[] = (lots || [])
      .filter((lot: any): lot is LotEntry =>
        lot &&
        lot.remaining_quantity > 0 &&
        lot.asset &&
        Array.isArray(lot.asset) &&
        lot.asset.length > 0 &&
        typeof lot.asset[0].ticker === 'string'
      );

    // === Fetch transactions in period (for cash flows and factors) ===
    const { data: transactionsRaw, error: txError } = await supabase
      .from('transactions')
      .select('date, type, amount, fees, realized_gain')
      .gte('date', startStr)
      .lte('date', endStr)
      .eq('user_id', user.id);

    if (txError) {
      console.error('Transactions query error:', txError);
      throw new Error(`Failed to fetch transactions: ${txError.message}`);
    }

    type TransactionEntry = {
      date: string;
      type: string;
      amount: number | null;
      fees: number | null;
      realized_gain: number | null;
    };

    const transactions: TransactionEntry[] = (transactionsRaw || [])
      .filter((tx: any): tx is TransactionEntry =>
        tx &&
        typeof tx.date === 'string' &&
        typeof tx.type === 'string'
      );

    // === Collect tickers for historical prices ===
    const assetTickers = [...new Set(validLots.map(l => l.asset[0].ticker))];
    const allTickers = [...new Set([...assetTickers, ...benchmarks])];

    // === Fetch historical prices ===
    const mockRequest = new Request('http://localhost/placeholder', {
      method: 'POST',
      body: JSON.stringify({ tickers: allTickers, startDate: startStr, endDate: endStr }),
      headers: { 'Content-Type': 'application/json' }
    });

    const histResponse = await historicalPOST(mockRequest);
    if (!histResponse.ok) {
      throw new Error(`Historical prices fetch failed: ${histResponse.status}`);
    }

    const { historicalData } = await histResponse.json() as {
      historicalData: Record<string, { date: string; close: number }[]>;
    };

    console.log(`Historical data received for ${Object.keys(historicalData).length} of ${allTickers.length} tickers`);

    // === Unified date timeline ===
    const allDatesSet = new Set<string>();
    Object.values(historicalData).forEach(series => {
      series.forEach(entry => allDatesSet.add(entry.date));
    });
    const dates = Array.from(allDatesSet).sort();

    if (dates.length === 0) {
      console.warn('No historical dates available');
      return NextResponse.json({
        totalReturn: 0,
        annualized: 0,
        factors: { unrealized: 0, realized: 0, dividends: 0, fees: 0 },
        series: [],
        datesCount: 0
      });
    }

    console.log(`Aligned timeline: ${dates.length} dates from ${dates[0]} to ${dates[dates.length - 1]}`);

    // === Portfolio value series with forward-fill ===
    const portfolioValues = dates.map(date => {
      return validLots.reduce((total, lot) => {
        const series = historicalData[lot.asset[0].ticker] || [];
        let price = 0;
        for (let i = series.length - 1; i >= 0; i--) {
          if (series[i].date <= date) {
            price = series[i].close;
            break;
          }
        }
        return total + lot.remaining_quantity * price;
      }, 0);
    });

    const initialPortfolioValue = portfolioValues[0] || 1;
    if (initialPortfolioValue <= 0) console.warn('Initial value <= 0; using 1');
    const currentPortfolioValue = portfolioValues[portfolioValues.length - 1] || initialPortfolioValue;

    // === Normalized chart series ===
    const series = dates.map((date, i) => {
      const entry: Record<string, string | number> = {
        date,
        portfolio: ((portfolioValues[i] / initialPortfolioValue) - 1) * 100
      };

      benchmarks.forEach((benchmark: string) => {
        const benchSeries = historicalData[benchmark] || [];
        let benchPrice = 0;
        for (let j = benchSeries.length - 1; j >= 0; j--) {
          if (benchSeries[j].date <= date) {
            benchPrice = benchSeries[j].close;
            break;
          }
        }
        const benchInitial = benchSeries.find(p => p.date === dates[0])?.close || benchSeries[0]?.close || 1;
        entry[benchmark] = benchInitial > 0 ? ((benchPrice / benchInitial) - 1) * 100 : 0;
      });

      return entry;
    });

    // === Performance factors ===
    const realized = transactions.reduce((sum, t) => sum + (t.realized_gain || 0), 0);
    const dividends = transactions
      .filter(t => t.type === 'Dividend')
      .reduce((sum, t) => sum + (t.amount || 0), 0);
    const fees = transactions.reduce((sum, t) => sum + Math.abs(t.fees || 0), 0);

    const totalBasis = validLots.reduce((sum, l) => sum + l.remaining_quantity * l.cost_basis_per_unit, 0);
    const unrealized = currentPortfolioValue - totalBasis;

    // === Returns ===
    const totalReturn = initialPortfolioValue > 0
      ? (currentPortfolioValue / initialPortfolioValue) - 1
      : 0;

    const twr = totalReturn;

    const cashFlows = transactions.map(tx => {
      let flow = 0;
      if (tx.type === 'Buy') flow = -(tx.amount || 0);
      if (tx.type === 'Sell') flow = tx.amount || 0;
      if (tx.type === 'Dividend') flow = tx.amount || 0;
      flow -= (tx.fees || 0);
      return flow;
    });
    cashFlows.push(currentPortfolioValue);

    const flowDates = transactions.map(tx => new Date(tx.date));
    flowDates.push(today);

    const mwr = cashFlows.length > 1 && !isNaN(calculateIRR(cashFlows, flowDates))
      ? calculateIRR(cashFlows, flowDates)
      : totalReturn;

    const finalReturn = metricType === 'twr' ? twr : mwr;
    const years = differenceInDays(today, startDate) / 365.25;
    const annualized = years > 0 ? Math.pow(1 + finalReturn, 1 / years) - 1 : finalReturn;

    return NextResponse.json({
      totalReturn: finalReturn,
      annualized,
      factors: { unrealized, realized, dividends, fees },
      series,
      datesCount: dates.length
    });
  } catch (error) {
    console.error('Performance calculation error:', error);
    return NextResponse.json(
      { error: (error as Error).message, details: 'Check server logs' },
      { status: 500 }
    );
  }
}