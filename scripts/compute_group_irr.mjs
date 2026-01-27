import { createClient } from '@supabase/supabase-js';

// Minimal IRR solver (Newton + bisection fallback) ported to JS
function npv(rate, cashFlows, times) {
  let v = 0;
  for (let i = 0; i < cashFlows.length; i++) {
    v += cashFlows[i] / Math.pow(1 + rate, times[i]);
  }
  return v;
}

function derivative(rate, cashFlows, times) {
  let d = 0;
  for (let i = 0; i < cashFlows.length; i++) {
    d += -times[i] * cashFlows[i] / Math.pow(1 + rate, times[i] + 1);
  }
  return d;
}

function calculateIRRJs(cashFlows, dates) {
  if (!cashFlows || cashFlows.length < 2) return NaN;
  const times = dates.map(d => (new Date(d).getTime() - new Date(dates[0]).getTime()) / (1000 * 60 * 60 * 24) / 365.25);
  // initial guess: (sum positive / sum negative)^(1/years) - 1
  const positives = cashFlows.filter(v => v > 0).reduce((s, v) => s + v, 0);
  const negatives = -cashFlows.filter(v => v < 0).reduce((s, v) => s + v, 0);
  let guess = 0.1;
  if (negatives > 0) {
    const ratio = positives / negatives;
    if (ratio > 0) guess = Math.pow(ratio, 1 / Math.max(0.0001, times[times.length - 1])) - 1;
  }

  // Newton-Raphson
  let rate = guess;
  for (let i = 0; i < 100; i++) {
    const f = npv(rate, cashFlows, times);
    const d = derivative(rate, cashFlows, times);
    if (Math.abs(d) < 1e-12) break;
    const next = rate - f / d;
    if (Math.abs(next - rate) < 1e-12) return next;
    rate = next;
  }
  // Bisection fallback
  let lo = -0.9999, hi = 10;
  for (let i = 0; i < 200; i++) {
    const mid = (lo + hi) / 2;
    const fmid = npv(mid, cashFlows, times);
    const flo = npv(lo, cashFlows, times);
    if (Math.sign(fmid) === Math.sign(flo)) lo = mid; else hi = mid;
    if (Math.abs(hi - lo) < 1e-12) return (lo + hi) / 2;
  }
  return (lo + hi) / 2;
}

function transactionFlowForIRR_js(tx) {
  if (!tx || typeof tx.type !== 'string') return 0;
  const amt = Number(tx.amount) || 0;
  const fees = Number(tx.fees) || 0;
  switch (tx.type) {
    case 'Deposit': return -Math.abs(amt);
    case 'Withdrawal': return Math.abs(amt);
    case 'Dividend': return Math.abs(amt);
    case 'Interest': return Math.abs(amt);
    case 'Buy': return -Math.abs(amt) - Math.abs(fees);
    case 'Sell': return Math.abs(amt) - Math.abs(fees);
    default: return 0;
  }
}

function netCashFlowsByDate_js(flows, dates) {
  const map = new Map();
  for (let i = 0; i < flows.length; i++) {
    const d = new Date(dates[i]).toISOString().slice(0, 10);
    map.set(d, (map.get(d) || 0) + flows[i]);
  }
  const netDates = Array.from(map.keys()).sort();
  const netFlows = netDates.map(d => map.get(d));
  const netDatesObj = netDates.map(d => new Date(d));
  return { netFlows, netDates: netDatesObj };
}

async function main() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!supabaseUrl || !supabaseKey) {
    console.error('Missing SUPABASE env vars: NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY');
    process.exit(2);
  }
  const supabase = createClient(supabaseUrl, supabaseKey);
  const targetAssetId = '338f3981-3b57-476c-ac6a-07f4c9613dd7';

  const { data: txs, error } = await supabase
    .from('transactions')
    .select('id, date, type, amount, fees, funding_source, asset_id, account_id')
    .eq('asset_id', targetAssetId)
    .order('date', { ascending: true });

  if (error) {
    console.error('DB query error', error);
    process.exit(2);
  }
  if (!txs || txs.length === 0) {
    console.log('No transactions for asset', targetAssetId);
    process.exit(0);
  }

  console.log('Found', txs.length, 'transactions');
  txs.forEach((t) => console.log(t.id, t.date, t.type, t.amount));

  const flows = [];
  const dates = [];
  for (const t of txs) {
    flows.push(transactionFlowForIRR_js(t));
    dates.push(t.date);
  }
  const { netFlows, netDates } = netCashFlowsByDate_js(flows, dates);
  console.log('Net flows:', netFlows.map(v => Number(v.toFixed(2))));
  const irr = calculateIRRJs(netFlows, netDates);
  console.log('Computed IRR (decimal):', irr);
  console.log('Annualized %:', isNaN(irr) ? 'NaN' : (irr * 100).toFixed(6) + '%');
}

main().catch(e => { console.error(e); process.exit(1); });
