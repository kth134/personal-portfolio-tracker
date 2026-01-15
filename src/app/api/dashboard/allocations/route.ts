import { createClient } from '@/lib/supabase/server';
import { NextResponse } from 'next/server';

export async function POST(req: Request) {
  try {
    const { lens, selectedValues } = await req.json();
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    // Fetch open lots with joins (keep !inner — safe and enables filtering)
let lotsQuery = supabase
  .from('tax_lots')
  .select(`
    remaining_quantity,
    cost_basis_per_unit,
    asset_id,
    asset:assets(id, ticker, name, asset_type, asset_subtype, geography, size_tag, factor_tag, sub_portfolios!sub_portfolio_id(name)),
    account:accounts(name)
  `)
  .gt('remaining_quantity', 0)
  .eq('user_id', user.id);

if (lens !== 'total' && selectedValues?.length > 0) {
  switch (lens) {
    case 'asset':
      lotsQuery = lotsQuery.in('asset_id', selectedValues);
      break;
    case 'sub_portfolio':
      lotsQuery = lotsQuery.in('asset.sub_portfolios.name', selectedValues);      
      break;
    case 'account':
      lotsQuery = lotsQuery.in('account.name', selectedValues);
      break;
    case 'asset_type':
      lotsQuery = lotsQuery.in('asset.asset_type', selectedValues);
      break;
    case 'asset_subtype':
      lotsQuery = lotsQuery.in('asset.asset_subtype', selectedValues);
      break;
    case 'geography':
      lotsQuery = lotsQuery.in('asset.geography', selectedValues);
      break;
    case 'size_tag':
      lotsQuery = lotsQuery.in('asset.size_tag', selectedValues);
      break;
    case 'factor_tag':
      lotsQuery = lotsQuery.in('asset.factor_tag', selectedValues);
      break;
    default:
      // No filter for unknown lens
      break;
  }
}

const { data: lots, error: lotsError } = await lotsQuery;
if (lotsError) throw lotsError;
if (!lots || lots.length === 0) {
  return NextResponse.json({ allocations: [] });
}

const typedLots = lots as any;

// Filter lots based on selectedValues
let filteredLots = typedLots;
if (lens !== 'total' && selectedValues?.length > 0) {
  filteredLots = typedLots.filter((lot: any) => {
    const asset = lot.asset;
    if (!asset) return false;
    switch (lens) {
      case 'asset':
        return selectedValues.includes(asset.id);
      case 'account':
        return selectedValues.includes((lot.account?.name || 'Unknown').trim());
      case 'sub_portfolio':
        return selectedValues.includes((asset.sub_portfolios?.name || 'No Sub-Portfolio').trim());
      case 'asset_type':
        return selectedValues.includes((asset.asset_type || 'Unknown').trim());
      case 'asset_subtype':
        return selectedValues.includes((asset.asset_subtype || 'Unknown').trim());
      case 'geography':
        return selectedValues.includes((asset.geography || 'Unknown').trim());
      case 'size_tag':
        return selectedValues.includes((asset.size_tag || 'Unknown').trim());
      case 'factor_tag':
        return selectedValues.includes((asset.factor_tag || 'Unknown').trim());
      default:
        return true;
    }
  });
}

    // Fetch latest prices (reuse your existing logic)
    const tickers = [...new Set(filteredLots?.map((l: any) => l.asset.ticker) || [])];
    const { data: prices } = await supabase
      .from('asset_prices')
      .select('ticker, price')
      .in('ticker', tickers)
      .order('timestamp', { ascending: false });

    const priceMap = new Map(prices?.map((p: any) => [p.ticker, p.price]) || []);

    // Fetch transactions for realized/dividends/fees (all time, filtered if needed)
    const { data: transactions } = await supabase
      .from('transactions')
      .select('asset_id, realized_gain, amount, fees, type')
      .eq('user_id', user.id);

    // Aggregate net gains by asset_id
    const netGainByAsset = new Map<string, number>();
    transactions?.forEach((tx: any) => {
      if (!tx.asset_id) return;
      let gain = (tx.realized_gain || 0);
      if (tx.type === 'Dividend' || tx.type === 'Interest') gain += (tx.amount || 0);
      gain -= Math.abs(tx.fees || 0);
      netGainByAsset.set(tx.asset_id, (netGainByAsset.get(tx.asset_id) || 0) + gain);
    });

   // Compute holdings per group, aggregated by ticker
const groups = new Map<string, {
  value: number;
  net_gain: number;
  tickers: Map<string, { quantity: number; value: number; net_gain: number; name: string | null }>;
}>();

let totalValue = 0;

filteredLots?.forEach((lot: any) => {
  const ticker = lot.asset.ticker;
  const assetName = lot.asset.name;
  const qty = Number(lot.remaining_quantity);
  const basis = qty * Number(lot.cost_basis_per_unit);
  const price = priceMap.get(ticker) || 0;
  const value = qty * price;
  const unreal = value - basis;

  // Net gain for this lot (unreal + historical from transactions)
  const lotNetGain = unreal + (netGainByAsset.get(lot.asset.id) || 0); // asset_id unique per ticker

  let key = 'Total';
  if (lens !== 'total') {
    switch (lens) {
      case 'sub_portfolio': key = (lot.asset.sub_portfolios?.name || 'No Sub-Portfolio').trim(); break;
      case 'account': key = (lot.account?.name || 'Unknown').trim(); break;
      case 'asset_type': key = (lot.asset.asset_type || 'Unknown').trim(); break;
      case 'asset_subtype': key = (lot.asset.asset_subtype || 'Unknown').trim(); break;
      case 'geography': key = (lot.asset.geography || 'Unknown').trim(); break;
      case 'size_tag': key = (lot.asset.size_tag || 'Unknown').trim(); break;
      case 'factor_tag': key = (lot.asset.factor_tag || 'Unknown').trim(); break;
      default: key = 'Unknown';
    }
  }

  if (!groups.has(key)) {
    groups.set(key, { value: 0, net_gain: 0, tickers: new Map() });
  }
  const group = groups.get(key)!;

  if (!group.tickers.has(ticker)) {
    group.tickers.set(ticker, { quantity: 0, value: 0, net_gain: 0, name: assetName });
  }
  const tickerEntry = group.tickers.get(ticker)!;
  tickerEntry.quantity += qty;
  tickerEntry.value += value;
  tickerEntry.net_gain += lotNetGain;

  group.value += value;
  group.net_gain += lotNetGain;
  totalValue += value;
});

 // Build response
let allocations: any[] = [];

groups.forEach((group, key) => {
  const tickerData = Array.from(group.tickers.entries()).map(([ticker, t]) => ({
    subkey: ticker,
    value: t.value,
    percentage: group.value > 0 ? (t.value / group.value) * 100 : 0,
  }));

  const items = Array.from(group.tickers.entries()).map(([ticker, t]) => ({
    ticker,
    name: t.name,
    quantity: t.quantity,
    value: t.value,
    net_gain: t.net_gain,
  }));

  allocations.push({
    key,
    value: group.value,
    percentage: totalValue > 0 ? group.value / totalValue : 0,
    net_gain: group.net_gain,
    data: tickerData,
    items, // For drill-down
  });
});

    return NextResponse.json({ allocations });
  } catch (err) {
    console.error('Allocations API error:', err);
    return NextResponse.json({ error: 'Server error' }, { status: 500 });
  }
}