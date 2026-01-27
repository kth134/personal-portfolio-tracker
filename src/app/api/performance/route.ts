// src/app/api/performance/route.ts
import { createClient } from '@/lib/supabase/server';
import { NextResponse } from 'next/server';
import { subDays, subMonths, subYears, format, differenceInDays } from 'date-fns';
import { POST as historicalPOST } from '../historical-prices/route';
import { calculateIRR, normalizeTransactionToFlow } from '@/lib/finance';

// use centralized calculateIRR from src/lib/finance

export async function POST(request: Request) {
  try {
    const {
      period = '1Y',
      lens = 'all',
      metricType = 'mwr',
      benchmarks = ['SPX', 'IXIC', 'BTCUSD']
    } = await request.json();

    const supabase = await createClient();
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

    // === Fetch open tax lots — ONLY needed fields, strict join ===
    const lotsQuery = supabase
      .from('tax_lots')
      .select(`
        remaining_quantity,
        cost_basis_per_unit,
        asset_id,
        asset:assets(ticker)
      `)
      .gt('remaining_quantity', 0)
      .eq('user_id', user.id);

    // Apply lens filtering only if needed — on the asset tag column
    if (lens !== 'all') {
      lotsQuery.ilike(`asset.${lens}`, '%');
    }

    const { data: lotsRaw, error: lotsError } = await lotsQuery;

    if (lotsError) {
      console.error('Tax lots query failed:', lotsError);
      throw new Error(`Failed to fetch tax lots: ${lotsError.message}`);
    }

    console.log(`Fetched ${lotsRaw?.length || 0} open tax lots`);

    type LotEntry = {
      remaining_quantity: number;
      cost_basis_per_unit: number;
      asset: { ticker: string }[];
    };

    const validLots: LotEntry[] = (lotsRaw || [])
      .filter((lot: any): lot is LotEntry =>
        lot &&
        lot.remaining_quantity > 0 &&
        lot.asset &&
        lot.asset.length > 0 &&
        typeof lot.asset[0].ticker === 'string'
      );

    // === Fetch transactions in period ===
    const { data: transactionsRaw, error: txError } = await supabase
      .from('transactions')
      .select('date, type, amount, fees, realized_gain')
      .gte('date', startStr)
      .lte('date', endStr)
      .eq('user_id', user.id);

    if (txError) {
      console.error('Transactions query error:', txError);
      throw txError;
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
        tx && typeof tx.date === 'string'
      );

    // === Tickers for prices ===
    const assetTickers = [...new Set(validLots.map(l => l.asset[0].ticker))];
    const allTickers = [...new Set([...assetTickers, ...benchmarks])];

    // === Historical prices ===
    const mockRequest = new Request('http://localhost/placeholder', {
      method: 'POST',
      body: JSON.stringify({ tickers: allTickers, startDate: startStr, endDate: endStr }),
      headers: { 'Content-Type': 'application/json' }
    });

    const histResponse = await historicalPOST(mockRequest);
    if (!histResponse.ok) throw new Error('Historical fetch failed');

    const { historicalData } = await histResponse.json() as {
      historicalData: Record<string, { date: string; close: number }[]>;
    };

    console.log(`Historical data for ${Object.keys(historicalData).length}/${allTickers.length} tickers`);

    // === Unified dates ===
    const allDatesSet = new Set<string>();
    Object.values(historicalData).forEach(s => s.forEach(e => allDatesSet.add(e.date)));
    const dates = Array.from(allDatesSet).sort();

    if (dates.length === 0) {
      return NextResponse.json({
        totalReturn: 0,
        annualized: 0,
        factors: { unrealized: 0, realized: 0, dividends: 0, fees: 0, netGain: 0 },
        series: [],
        datesCount: 0
      });
    }

    // === Portfolio values (forward-fill) ===
    const portfolioValues = dates.map(date => {
      return validLots.reduce((sum, lot) => {
        const series = historicalData[lot.asset[0].ticker] || [];
        let price = 0;
        for (let i = series.length - 1; i >= 0; i--) {
          if (series[i].date <= date) {
            price = series[i].close;
            break;
          }
        }
        return sum + lot.remaining_quantity * price;
      }, 0);
    });

    const initialValue = portfolioValues[0] || 1;
    const currentValue = portfolioValues[portfolioValues.length - 1] || initialValue;

    // === Series for chart ===
    const series = dates.map((date, i) => {
      const entry: Record<string, any> = {
        date,
        portfolio: ((portfolioValues[i] / initialValue) - 1) * 100
      };

      benchmarks.forEach((b: string) => {
        const s = historicalData[b] || [];
        let price = 0;
        for (let j = s.length - 1; j >= 0; j--) {
          if (s[j].date <= date) {
            price = s[j].close;
            break;
          }
        }
        const init = s.find(p => p.date === dates[0])?.close || s[0]?.close || 1;
        entry[b] = init > 0 ? ((price / init) - 1) * 100 : 0;
      });

      return entry;
    });

    // === Factors ===
    const realized = transactions.reduce((s, t) => s + (t.realized_gain || 0), 0);
    const dividends = transactions.filter(t => t.type === 'Dividend').reduce((s, t) => s + (t.amount || 0), 0);
    const fees = transactions.reduce((s, t) => s + Math.abs(t.fees || 0), 0);
    const totalBasis = validLots.reduce((s, l) => s + l.remaining_quantity * l.cost_basis_per_unit, 0);
    const unrealized = currentValue - totalBasis;

    const netGain = realized + unrealized + dividends - fees;

    // === Returns ===
    const totalReturn = initialValue > 0 ? (currentValue / initialValue) - 1 : 0;
    const twr = totalReturn;

    // Build cash flows and matching dates (only include tx with valid dates)
    const cashFlows: number[] = [];
    const flowDates: Date[] = [];
    transactions.forEach((tx: any) => {
      const date = new Date(tx.date);
      if (isNaN(date.getTime())) return;
      cashFlows.push(normalizeTransactionToFlow(tx));
      flowDates.push(date);
    });

    // Terminal value
    if (cashFlows.length >= 0) {
      cashFlows.push(currentValue);
      flowDates.push(today);
    }

    // Compute MWR (IRR) using centralized solver. calculateIRR returns an annual rate (decimal).
    const irrVal = cashFlows.length > 1 ? calculateIRR(cashFlows, flowDates) : NaN;
    const mwr = !isNaN(irrVal) ? irrVal : NaN;

    const years = differenceInDays(today, startDate) / 365.25;

    // Final annualized metric: TWR must be annualized from multi-period total return;
    // MWR (IRR) is already an annual rate returned by calculateIRR. If IRR fails, fall back to annualized TWR.
    let annualized: number;
    if (metricType === 'twr') {
      annualized = years > 0 ? Math.pow(1 + twr, 1 / years) - 1 : twr;
    } else {
      if (!isNaN(mwr)) {
        annualized = mwr;
      } else {
        // Fallback: derive annualized from totalReturn
        annualized = years > 0 ? Math.pow(1 + totalReturn, 1 / years) - 1 : totalReturn;
      }
    }

    // Return a consistent `totalReturn` field similar to previous behavior:
    // - for TWR metric return multi-period TWR
    // - for MWR metric return the IRR (annual) when available, else fallback to multi-period totalReturn
    const finalReturn = metricType === 'twr' ? twr : (!isNaN(mwr) ? mwr : totalReturn);

    return NextResponse.json({
      totalReturn: finalReturn,
      annualized,
      factors: { unrealized, realized, dividends, fees, netGain },
      series,
      datesCount: dates.length
    });
  } catch (error) {
    console.error('Performance error:', error);
    return NextResponse.json({ error: (error as Error).message }, { status: 500 });
  }
}