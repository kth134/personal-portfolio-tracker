import { createClient as createServerClient } from '../src/lib/supabase/server';
import { transactionFlowForIRR, netCashFlowsByDate, calculateIRR } from '../src/lib/finance';

async function main() {
  const supabase = await createServerClient();
  const targetAssetId = '338f3981-3b57-476c-ac6a-07f4c9613dd7';

  const { data: txs, error } = await supabase
    .from('transactions')
    .select(`id, date, type, amount, fees, funding_source, asset_id, account_id`)
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
  txs.forEach((t: any) => console.log(t.id, t.date, t.type, t.amount));

  const flows: number[] = [];
  const dates: Date[] = [];
  txs.forEach((t: any) => {
    const f = transactionFlowForIRR(t);
    flows.push(f);
    dates.push(new Date(t.date));
  });

  const { netFlows, netDates } = netCashFlowsByDate(flows, dates);
  console.log('Net flows:', netFlows.map((v) => Number(v.toFixed ? v.toFixed(2) : v)));
  const irr = calculateIRR(netFlows, netDates);
  console.log('Computed IRR (decimal):', irr);
  console.log('Annualized %:', isNaN(irr) ? 'NaN' : (irr * 100).toFixed(6) + '%');
}

main().catch((e) => { console.error(e); process.exit(1); });
