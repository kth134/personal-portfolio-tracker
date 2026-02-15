// Centralized finance utilities (IRR and cash-flow normalization)
/**
 * Canonical cash-flow & grouping conventions
 *
 * - Cash-flow sign rules (canonical):
 *   - Buys: recorded as negative outflows in DB; fees are treated as included
 *   - Sells: recorded as positive inflows in DB; fees are treated as included
 *   - Deposits / Dividends / Interest: positive inflows; fees (if any) are treated separately
 *   - Withdrawals: negative outflows; fees (if any) are treated separately
 *
 * - Fees handling: when fees are stored separately on a transaction record, callers
 *   should subtract `fees` from inflows or add them to outflows as appropriate.
 *
 * - Grouping: performance grouping (e.g. by account or sub-portfolio) should be
 *   done using stable IDs (account.id, sub_portfolio.id, or explicit tag values)
 *   fetched via joined queries. This avoids ambiguity caused by renaming/display
 *   values and ensures transactions are unambiguously assigned to groups.
 */
/**
 * Calculate IRR (annualized) given cash flows and corresponding dates.
 * - Cash flows and dates must be the same length and correspond index-wise.
 * - Dates may be non-uniform; time is measured in years using 365.25 days.
 * - Returns the annual IRR as a decimal (e.g. 0.10 for 10%).
 * - Returns NaN when IRR cannot be found or inputs are invalid.
 */
export function calculateIRR(cashFlows: number[], dates: Date[]): number {
  if (!cashFlows || !dates || cashFlows.length !== dates.length || cashFlows.length < 2) return NaN;

  // Ensure cash flows and dates are sorted together by date (stable)
  const { sortedCashFlows, sortedDates } = sortCashFlowsAndDates(cashFlows, dates);

  const precision = 1e-8;

  // Newton-Raphson with derivative (robust initial guess)
  let guess = 0.1;
  const maxIter = 1000;
  for (let i = 0; i < maxIter; i++) {
    let npv = 0;
    let dnpv = 0;
    for (let j = 0; j < sortedCashFlows.length; j++) {
      const cf = sortedCashFlows[j];
      const years = (sortedDates[j].getTime() - sortedDates[0].getTime()) / (365.25 * 24 * 60 * 60 * 1000);
      const denom = Math.pow(1 + guess, years);
      npv += cf / denom;
      dnpv -= years * cf / (denom * (1 + guess));
    }
    if (Math.abs(npv) < precision) return guess;
    if (Math.abs(dnpv) < precision) break; // avoid div/0
    guess -= npv / dnpv;
    if (guess < -0.99 || guess > 50) break;
  }

  // Bisection fallback
  let low = -0.99;
  let high = 20.0;
  const bisectionIter = 200;
  for (let i = 0; i < bisectionIter; i++) {
    const mid = (low + high) / 2;
    let npv = 0;
    for (let j = 0; j < sortedCashFlows.length; j++) {
      const cf = sortedCashFlows[j];
      const years = (sortedDates[j].getTime() - sortedDates[0].getTime()) / (365.25 * 24 * 60 * 60 * 1000);
      npv += cf / Math.pow(1 + mid, years);
    }
    if (Math.abs(npv) < precision) return mid;
    if (npv > 0) low = mid;
    else high = mid;
  }

  return NaN;
}

/**
 * Stable sort cash flows and dates by date ascending and return aligned arrays.
 */
export function sortCashFlowsAndDates(cashFlows: number[], dates: Date[]): { sortedCashFlows: number[]; sortedDates: Date[] } {
  const paired = dates.map((d, i) => ({ d: new Date(d), cf: cashFlows[i] }));
  paired.sort((a, b) => a.d.getTime() - b.d.getTime());
  return {
    sortedCashFlows: paired.map(p => p.cf),
    sortedDates: paired.map(p => p.d),
  };
}

/**
 * Format cash flows and dates for debug display.
 * Returns an array of { date: string, flow: number } items.
 */
export function formatCashFlowsDebug(cashFlows: number[], dates: Date[]): { date: string; flow: number }[] {
  const { sortedCashFlows, sortedDates } = sortCashFlowsAndDates(cashFlows, dates);
  return sortedDates.map((d, i) => ({ date: sortedDates[i].toISOString(), flow: sortedCashFlows[i] }));
}

/**
 * Log cash flows to the server console when `DEBUG_IRR` env var is truthy.
 * This is intentionally verbose for debugging and may be removed later.
 */
export function logCashFlows(label: string, cashFlows: number[], dates: Date[]) {
  try {
    if (!process.env.DEBUG_IRR) return;
    const formatted = formatCashFlowsDebug(cashFlows, dates);
    // Use console.debug for detailed diagnostic output
    // Limit output size to a reasonable amount to avoid spamming logs
    const max = 200;
    const out = formatted.slice(0, max);
    console.debug(`${label} (${formatted.length})`, out);
    if (formatted.length > max) console.debug(`${label}: output truncated to ${max} entries`);
  } catch (e) {
    // swallow logging errors to avoid affecting production behavior
    // but surface minimal info
    console.debug('logCashFlows error', (e as any)?.message || e);
  }
}

/**
 * Net cash flows by day (UTC). Collapses multiple flows on the same calendar
 * day into a single net flow. Returns arrays sorted by date ascending.
 * Zero-net days are removed.
 */
export function netCashFlowsByDate(cashFlows: number[], dates: Date[]): { netFlows: number[]; netDates: Date[] } {
  const map = new Map<string, number>();
  for (let i = 0; i < cashFlows.length; i++) {
    const d = new Date(dates[i]);
    // Normalize to UTC date (midnight) so all flows on same day collapse
    const key = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate())).toISOString();
    map.set(key, (map.get(key) || 0) + Number(cashFlows[i] || 0));
  }
  const entries = Array.from(map.entries())
    .map(([k, v]) => ({ k, v }))
    .filter(e => Math.abs(e.v) > 1e-12) // remove near-zero nets
    .sort((a, b) => new Date(a.k).getTime() - new Date(b.k).getTime());

  const netDates = entries.map(e => new Date(e.k));
  const netFlows = entries.map(e => e.v);
  return { netFlows, netDates };
}

/**
 * Produce the cash flow value to use for IRR for a given transaction.
 * - Uses `normalizeTransactionToFlow` then applies IRR sign conventions:
 *   - Deposits are investor contributions and should be negative for IRR
 *   - Withdrawals are distributions and should be positive for IRR
 */
export function transactionFlowForIRR(tx: { type?: string; amount?: any; fees?: any }): number {
  const base = normalizeTransactionToFlow(tx);
  const t = (tx?.type || '').toString();
  if (t === 'Deposit' || t === 'Withdrawal') return -base;
  return base;
}

/**
 * Normalize a transaction record into a signed cash flow value following
 * the project's canonical convention:
 *
 * - Outflows (negative):
 *    - Buys: stored as negative in DB; fees included in amount automatically -> flow = amount
 *    - Withdrawals: stored as negative in DB; fees NOT included automatically -> flow = amount - fees
 * - Inflows (positive):
 *    - Sells: stored as positive in DB; fees included in amount automatically -> flow = amount
 *    - Dividends / Interest / Deposits: stored as positive in DB; fees NOT included automatically -> flow = amount - fees
 *
 * The function is defensive: it coerces to numbers and returns 0 when both amount and fees are absent.
 */
export function normalizeTransactionToFlow(tx: { type?: string; amount?: any; fees?: any }): number {
  const amt = Number(tx?.amount ?? 0);
  const fees = Number(tx?.fees ?? 0);
  const type = (tx?.type || '').toString();

  switch (type) {
    case 'Buy':
      // Stored negative, fees included
      return amt;
    case 'Sell':
      // Stored positive, fees included
      return amt;
    case 'Withdrawal':
      // Stored negative, fees NOT included
      return amt - fees;
    case 'Deposit':
    case 'Dividend':
    case 'Interest':
      // Stored positive, fees NOT included
      return amt - fees;
    default:
      // Fallback: treat as amount minus fees
      return amt - fees;
  }
}

/**
 * Compute per-account cash balances and total cash from a transaction list.
 * Returns an object with `balances` (Map<accountId, balance>) and `totalCash`.
 *
 * This encapsulates the same canonical rules used elsewhere and centralizes
 * cash management logic so callers across the app remain consistent.
 */
export function calculateCashBalances(transactions: any[]): { balances: Map<string, number>; totalCash: number } {
  const cashBalances = new Map<string, number>();
  (transactions || []).forEach((tx: any) => {
    const acc = tx?.account_id || tx?.account?.id;
    if (!acc) return;
    const current = cashBalances.get(acc) || 0;
    let delta = 0;
    const amt = Number(tx.amount || 0);
    const fee = Math.abs(Number(tx.fees || 0));
    // Match portfolio page canonical logic:
    // - Buys/Sells: `amount` is already the net cash delta (may include fees), so use as-is
    // - Dividends/Interest/Deposits/Withdrawals: stored as gross, subtract fees
    switch ((tx.type || '').toString()) {
      case 'Buy':
      case 'Sell':
        delta = amt;
        break;
      case 'Dividend':
      case 'Interest':
      case 'Deposit':
      case 'Withdrawal':
        delta = amt - fee;
        break;
      default:
        delta = amt - fee;
    }
    cashBalances.set(acc, current + delta);
  });
  const totalCash = Array.from(cashBalances.values()).reduce((s, v) => s + v, 0);
  return { balances: cashBalances, totalCash };
}

/**
 * Centralized function to fetch all transactions for a user using pagination.
 * This ensures consistent handling of large transaction datasets across the application.
 * @param siteUrl - The base URL of the application (for API calls)
 * @returns Promise resolving to array of transaction objects
 */
export async function fetchAllUserTransactions(siteUrl?: string): Promise<any[]> {
  // Use relative URL for client-side requests to avoid CSP issues
  const url = typeof window !== 'undefined' ? '/api/transactions?start=&end=' : `${siteUrl || 'http://localhost:3000'}/api/transactions?start=&end=`;
  const txRes = await fetch(url);
  const txJson = await txRes.json();
  if (!txRes.ok) {
    throw new Error(`Failed to fetch transactions: ${txJson?.error || 'Unknown error'}`);
  }
  return txJson?.transactions || [];
}

/**
 * Server-side function to fetch all transactions for a user using Supabase client directly.
 * This avoids HTTP calls and should be used in server-side API routes.
 * @param supabase - The Supabase client instance
 * @param userId - The user ID to fetch transactions for
 * @returns Promise resolving to array of transaction objects
 */
export async function fetchAllUserTransactionsServer(supabase: any, userId: string): Promise<any[]> {
  const pageSize = 1000;
  const allTransactions: any[] = [];

  let cursorDate: string | null = null;
  let cursorId: string | null = null;
  while (true) {
    let q = supabase
      .from('transactions')
      .select(`
        id,
        date,
        type,
        amount,
        quantity,
        price_per_unit,
        fees,
        funding_source,
        notes,
        asset_id,
        account_id,
        realized_gain,
        asset:assets (id, ticker, sub_portfolio_id, asset_type, asset_subtype, geography, size_tag, factor_tag)
      `)
      .eq('user_id', userId)
      .order('date', { ascending: false })
      .order('id', { ascending: false })
      .limit(pageSize);

    if (cursorDate && cursorId) {
      const filter = `or(date.lt.${cursorDate},and(date.eq.${cursorDate},id.lt.${cursorId}))`;
      q = q.or(filter);
    }

    const { data: page, error } = await q;
    if (error) {
      console.error('Server-side transaction fetch error', error);
      throw new Error('Failed to fetch transactions');
    }

    if (!page || page.length === 0) break;
    allTransactions.push(...page);
    if (page.length < pageSize) break;
    // Set cursor to last item
    const last = page[page.length - 1];
    cursorDate = last.date;
    cursorId = last.id;
  }

  return allTransactions;
}

