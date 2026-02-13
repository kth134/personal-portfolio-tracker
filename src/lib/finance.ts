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

export const lenses = ['total', 'account', 'sub_portfolio', 'asset_type', 'asset_subtype', 'geography', 'size_tag', 'factor_tag'] as const;

export interface Transaction {
  id: string;
  user_id: string;
  account_id: string;
  asset_id?: string;
  type: string;
  date: string;
  amount: number;
  fees: number;
  account?: { id: string; name: string; type: string };
  asset?: { id: string; ticker: string; name: string };
}

export const fetchAllUserTransactionsServer = async (supabase: any, userId: string): Promise<Transaction[]> => {
  const { data: transactions, error } = await supabase
    .from('transactions')
    .select(`
      *,
      accounts (id, name, type),
      assets (id, ticker, name)
    `)
    .eq('user_id', userId)
    .order('date', { ascending: false });
  if (error) {
    console.error('Error fetching transactions:', error);
    throw error;
  }
  return transactions ?? [];
};

export const calculateCashBalances = (transactions: Transaction[]): { balances: Map<string, number>; totalCash: number } => {
  const balances = new Map<string, number>();
  const byAccount: Record<string, Transaction[]> = {};
  transactions.forEach((tx) => {
    const accId = tx.account_id ?? tx.account?.id;
    if (accId) {
      if (!byAccount[accId]) byAccount[accId] = [];
      byAccount[accId].push(tx);
    }
  });
  Object.entries(byAccount).forEach(([accId, txs]) => {
    txs.sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());
    let bal = 0;
    txs.forEach((tx) => {
      const amt = Number(tx.amount || 0);
      const fee = Math.abs(Number(tx.fees || 0));
      const type = tx.type;
      switch (type) {
        case 'Deposit':
          bal += amt;
          break;
        case 'Withdrawal':
          bal -= amt;
          break;
        case 'Dividend':
        case 'Interest':
          bal += amt;
          break;
        case 'Buy':
          bal -= amt + fee;
          break;
        case 'Sell':
          bal += amt - fee;
          break;
      }
    });
    balances.set(accId, bal);
  });
  const totalCash = Array.from(balances.values()).reduce((sum, b) => sum + b, 0);
  return { balances, totalCash };
};

export const refreshAssetPrices = async () => {
  // Server action: trigger price fetch
  // await fetch('/api/fetch-prices', { method: 'POST' });
};

export const fetchAllUserTransactions = async () => {
  // Client-side: use useQuery
  return [];
};

export const formatCashFlowsDebug = (flows: number[], dates: Date[]) => {
  if (!flows || !dates) return '';
  return flows.map((f, i) => `${dates[i].toLocaleDateString()}: $${f.toFixed(2)}`).join('\n');
};

export const getPerformanceData = async () => []; // Use API endpoints
