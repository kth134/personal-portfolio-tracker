import { parseISO, differenceInDays } from 'date-fns';
import { calculateIRR, transactionFlowForIRR, netCashFlowsByDate } from './finance';

export interface PerformanceMetric {
  totalReturn: number;
  annualized: number;
  netGain: number;
  unrealized?: number;
  realized?: number;
  income?: number;
}

/**
 * Robustly calculates performance metrics for any grouping of transactions and assets.
 * Centralizes logic to prevent "split brain" between different dashboard views.
 */
export async function computePerformanceForGroup(
  transactions: any[],
  currentMarketValue: number,
  cashBalance: number,
  startDate: string,
  endDate: string,
  includeInternalTrades: boolean = false
): Promise<PerformanceMetric> {
  const start = parseISO(startDate);
  const end = parseISO(endDate);
  const years = (differenceInDays(end, start) + 1) / 365.25;

  // 1. Filter and Normalize Cash Flows
  // External flows (Money Entering/Leaving the system)
  const externalTypes = ['Deposit', 'Withdrawal', 'Dividend', 'Interest'];
  
  const flows: number[] = [];
  const dates: Date[] = [];

  transactions.forEach((tx) => {
    const type = tx.type;
    const d = parseISO(tx.date);
    if (isNaN(d.getTime())) return;

    if (externalTypes.includes(type)) {
      flows.push(transactionFlowForIRR(tx));
      dates.push(d);
    } else if (includeInternalTrades && (type === 'Buy' || type === 'Sell')) {
      // For asset-level IRR, Buys/Sells ARE external flows for that specific asset
      flows.push(transactionFlowForIRR(tx));
      dates.push(d);
    }
  });

  // 2. Add Terminal Value (The "What is it worth now" inflow)
  // For total portfolio, we include market value of assets + cash balance.
  const terminalValue = currentMarketValue + cashBalance;
  if (terminalValue > 0) {
    flows.push(terminalValue);
    dates.push(end);
  }

  // 3. Solve for MWR/IRR
  const { netFlows, netDates } = netCashFlowsByDate(flows, dates);
  const irr = netFlows.length >= 2 ? calculateIRR(netFlows, netDates) : NaN;

  // 4. Calculate Net Gain components
  const realized = transactions.reduce((sum, t) => sum + (Number(t.realized_gain) || 0), 0);
  const income = transactions
    .filter((t) => t.type === 'Dividend' || t.type === 'Interest')
    .reduce((sum, t) => sum + (Number(t.amount) || 0), 0);
  const fees = transactions.reduce((sum, t) => sum + Math.abs(Number(t.fees) || 0), 0);

  // Note: Unrealized calculation usually requires original cost basis comparison
  // which is handled upstream in the specific route logic for now.
  
  return {
    totalReturn: isNaN(irr) ? 0 : irr, // Simplified for this helper
    annualized: isNaN(irr) ? 0 : irr,
    netGain: realized + income - fees, // Components like unrealized are added outside
    realized,
    income
  };
}
