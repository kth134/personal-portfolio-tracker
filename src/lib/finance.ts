import { format, parseISO } from 'date-fns';

export function calculateIRR(cashflows: number[], dates: Date[], tolerance: number = 1e-7, maxIterations: number = 200, guess: number = 0.10): number {
  const calcNPV = (rate: number): number => {
    let npv = 0;
    for (let i = 0; i < cashflows.length; i++) {
      const years = (dates[i].getTime() - dates[0].getTime()) / (365.25 * 24 * 60 * 60 * 1000);
      npv += cashflows[i] * Math.pow(1 + rate, -years);
    }
    return npv;
  };

  const calcNPVDerivative = (rate: number): number => {
    let deriv = 0;
    for (let i = 0; i < cashflows.length; i++) {
      const years = (dates[i].getTime() - dates[0].getTime()) / (365.25 * 24 * 60 * 60 * 1000);
      deriv += -years * cashflows[i] * Math.pow(1 + rate, -(years + 1));
    }
    return deriv;
  };

  let irr = guess;
  for (let i = 0; i < maxIterations; i++) {
    const npv = calcNPV(irr);
    if (Math.abs(npv) < tolerance) return irr;

    const deriv = calcNPVDerivative(irr);
    if (Math.abs(deriv) < 1e-10) break;

    const delta = npv / deriv;
    irr -= delta;
    if (Math.abs(delta) < tolerance) return irr;
  }
  return NaN;
}

export function transactionFlowForIRR(tx: any): number {
  const amount = Number(tx.amount || 0);
  const fees = Number(tx.fees || 0);
  const type = tx.type;

  const signs: Record<string, number> = {
    Deposit: -1,
    Withdrawal: 1,
    Dividend: 1,
    Interest: 1,
    Buy: -1,
    Sell: 1,
  };

  const sign = signs[type] || 0;
  return sign * amount - Math.abs(fees);
}

export function netCashFlowsByDate(flows: number[], dates: Date[]) {
  const dailyNet: Record<string, number> = {};
  for (let i = 0; i < flows.length; i++) {
    const dateStr = format(dates[i], 'yyyy-MM-dd');
    dailyNet[dateStr] = (dailyNet[dateStr] || 0) + flows[i];
  }

  const sortedDates = Object.keys(dailyNet).sort();
  const netDates: Date[] = [];
  const netFlows: number[] = [];
  sortedDates.forEach(dateStr => {
    netDates.push(parseISO(dateStr));
    netFlows.push(dailyNet[dateStr]);
  });

  return { netFlows, netDates };
}

export function logCashFlows(label: string, flows: number[], dates: Date[]) {
  console.group(label);
  for (let i = 0; i < flows.length; i++) {
    console.log(`${format(dates[i], 'yyyy-MM-dd')}: ${flows[i].toFixed(4)}`);
  }
  console.groupEnd();
}

export function normalizeTransactionToFlow(tx: any): number {
  return transactionFlowForIRR(tx);
}

// Keep other stubs for compatibility
export const getPerformanceData = () => [{ date: 'Jan', mwr: 2.5, twr: 2.0 }];
export const lenses = ['Total'];
export const calculateCashBalances = (transactions: any[]) => ({ balances: new Map(), totalCash: 0 });
export const fetchAllUserTransactionsServer = async (supabase: any, userId: string) => [];
export const refreshAssetPrices = async () => {};
export const fetchAllUserTransactions = async () => [];
export const formatCashFlowsDebug = () => '';
