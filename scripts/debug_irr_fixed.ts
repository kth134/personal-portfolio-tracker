import { createClient as createServerClient } from '../src/lib/supabase/server';
import { transactionFlowForIRR, netCashFlowsByDate, calculateIRR } from '../src/lib/finance';

async function main() {
  const supabase = await createServerClient();
  const targetAssetId = '338f3981-3b57-476c-ac6a-07f4c9613dd7';
  const userId = '0624d455-2ff1-4977-bf30-f20317e066a3'; // Need to verify this ID or grab it from auth

  console.log('--- IRR CALCULATION DEBUG ---');

  // 1. Fetch Transactions
  const { data: txs, error: txError } = await supabase
    .from('transactions')
    .select(`id, date, type, amount, fees, funding_source, asset_id, account_id`)
    .eq('asset_id', targetAssetId)
    .order('date', { ascending: true });

  if (txError) throw txError;
  if (!txs || txs.length === 0) {
    console.log('No transactions for asset', targetAssetId);
    return;
  }

  // 2. Fetch Current Value (Remaining Quantity * Last Price)
  const { data: lots, error: lotError } = await supabase
    .from('tax_lots')
    .select('remaining_quantity, asset:assets(ticker)')
    .eq('asset_id', targetAssetId)
    .gt('remaining_quantity', 0);

  if (lotError) throw lotError;
  
  const ticker = lots?.[0]?.asset?.ticker;
  const totalQuantity = lots?.reduce((sum, l) => sum + Number(l.remaining_quantity || 0), 0) || 0;

  // Fetch latest price
  let currentPrice = 0;
  if (ticker) {
    const { data: priceData } = await supabase
      .from('asset_prices')
      .select('price')
      .eq('ticker', ticker)
      .order('timestamp', { ascending: false })
      .limit(1);
    currentPrice = priceData?.[0]?.price || 0;
  }

  const currentValue = totalQuantity * currentPrice;
  console.log(`Asset: ${ticker} | Qty: ${totalQuantity} | Price: ${currentPrice} | Market Value: ${currentValue}`);

  // 3. Build Cash Flows
  const flows: number[] = [];
  const dates: Date[] = [];
  
  txs.forEach((t: any) => {
    const f = transactionFlowForIRR(t);
    flows.push(f);
    dates.push(new Date(t.date));
  });

  // ADD THE TERMINAL FLOW (Current Market Value)
  if (currentValue > 0) {
    flows.push(currentValue);
    dates.push(new Date()); // Today
    console.log(`Added Terminal Flow: +${currentValue} (Current Value)`);
  }

  // 4. Calculate
  const { netFlows, netDates } = netCashFlowsByDate(flows, dates);
  const irr = calculateIRR(netFlows, netDates);
  
  console.log('Computed IRR (decimal):', irr);
  console.log('Annualized %:', isNaN(irr) ? 'NaN' : (irr * 100).toFixed(2) + '%');
}

main().catch(console.error);
