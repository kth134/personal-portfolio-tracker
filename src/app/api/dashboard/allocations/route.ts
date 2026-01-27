import { createClient } from '@/lib/supabase/server';
import { NextResponse } from 'next/server';
import { fetchAllUserTransactions } from '@/lib/finance';

interface Asset {
  id: string;
  ticker: string;
  name: string;
  asset_type: string | null;
  asset_subtype: string | null;
  geography: string | null;
  size_tag: string | null;
  factor_tag: string | null;
  sub_portfolios: { name: string } | null;
}

interface Account {
  name: string;
}

interface Lot {
  remaining_quantity: number;
  cost_basis_per_unit: number;
  asset_id: string;
  asset: Asset;
  account: Account;
}

interface Price {
  ticker: string;
  price: number;
  timestamp: string;
}

interface Transaction {
  asset_id: string;
  realized_gain: number | null;
  amount: number | null;
  fees: number | null;
  type: string;
}

interface TickerEntry {
  quantity: number;
  value: number;
  net_gain: number;
  name: string | null;
  cost_basis: number;
}

interface AllocationItem {
  key: string;
  value: number;
  percentage: number;
  net_gain: number;
  data: { subkey: string; value: number; percentage: number }[];
  items: unknown[];
}

export async function POST(req: Request) {
  try {
    const { lens, selectedValues, aggregate } = await req.json();
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

const lotsTyped: Lot[] = lots as unknown as Lot[];

// Filter lots based on selectedValues
let filteredLots = lotsTyped;
if (lens !== 'total' && selectedValues?.length > 0) {
  filteredLots = lotsTyped.filter((lot: Lot) => {
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
    const tickers = [...new Set(filteredLots?.map((l: Lot) => l.asset.ticker) || [])];
    const { data: pricesList } = await supabase
      .from('asset_prices')
      .select('ticker, price, timestamp')
      .in('ticker', tickers)
      .order('timestamp', { ascending: false });

    const priceMap = new Map<string, number>();
    pricesList?.forEach((p: any) => {
      if (!priceMap.has(p.ticker)) {
        priceMap.set(p.ticker, p.price);
      }
    });

    // Fetch all transactions for realized/dividends/fees using centralized pagination
    const allTransactions = await fetchAllUserTransactions(process.env.NEXT_PUBLIC_SITE_URL);

    // Filter transactions for the required fields
    const transactions = allTransactions.map(tx => ({
      asset_id: tx.asset_id,
      realized_gain: tx.realized_gain,
      amount: tx.amount,
      fees: tx.fees,
      type: tx.type
    }));

    // Aggregate net gains by asset_id
    // Note: `realized_gain` for Sell transactions is calculated server-side and already nets fees.
    // For Dividend/Interest, use (amount - fees). For Buys and other transaction types, do not
    // treat fees as realized gains (fees are capitalized into basis for Buys).
    const netGainByAsset = new Map<string, number>();
    transactions?.forEach((tx: Transaction) => {
      if (!tx.asset_id) return;
      let gain = 0;
      if (tx.type === 'Sell' && tx.realized_gain != null) {
        // realized_gain already accounts for fees
        gain = tx.realized_gain;
      } else if (tx.type === 'Dividend' || tx.type === 'Interest') {
        // dividends/interest contribute their amount net of any fees
        gain = (tx.amount || 0) - Math.abs(tx.fees || 0);
      } else {
        // Buys and other types do not contribute to realized/net gain here
        gain = 0;
      }
      netGainByAsset.set(tx.asset_id, (netGainByAsset.get(tx.asset_id) || 0) + gain);
    });

   // Compute holdings per group, aggregated by ticker
const groups = new Map<string, {
  value: number;
  net_gain: number;
  tickers: Map<string, TickerEntry>;
}>();

let totalValue = 0;

filteredLots?.forEach((lot: Lot) => {
  const ticker = lot.asset.ticker;
  const assetName = lot.asset.name;
  const qty = Number(lot.remaining_quantity);
  const basis = qty * Number(lot.cost_basis_per_unit);
  const price = priceMap.get(ticker) || 1;
  const value = qty * price;
  const unreal = value - basis;

  const lotNetGain = unreal + (netGainByAsset.get(lot.asset.id) || 0);

  const key = lens === 'total' ? 'Total' : (() => {
    switch (lens) {
      case 'sub_portfolio': return (lot.asset.sub_portfolios?.name || 'No Sub-Portfolio').trim();
      case 'account': return (lot.account?.name || 'Unknown').trim();
      case 'asset_type': return (lot.asset.asset_type || 'Unknown').trim();
      case 'asset_subtype': return (lot.asset.asset_subtype || 'Unknown').trim();
      case 'geography': return (lot.asset.geography || 'Unknown').trim();
      case 'size_tag': return (lot.asset.size_tag || 'Unknown').trim();
      case 'factor_tag': return (lot.asset.factor_tag || 'Unknown').trim();
      default: return 'Unknown';
    }
  })();

  if (!groups.has(key)) {
    groups.set(key, { value: 0, net_gain: 0, tickers: new Map() });
  }
  const group = groups.get(key)!;

  if (!group.tickers.has(ticker)) {
    group.tickers.set(ticker, { quantity: 0, value: 0, net_gain: 0, name: assetName, cost_basis: 0 });
  }
  const tickerEntry = group.tickers.get(ticker)!;
  tickerEntry.quantity += qty;
  tickerEntry.value += value;
  tickerEntry.net_gain += lotNetGain;
  tickerEntry.cost_basis += basis;

  group.value += value;
  group.net_gain += lotNetGain;
  totalValue += value;
});

 // Build response
let allocations: AllocationItem[] = [];

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
    cost_basis: t.cost_basis,
    unrealized: t.value - t.cost_basis,
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

// Aggregate mode: show one pie at the *group/key* level (sub-portfolios, accounts, types, etc.)
if (aggregate && allocations.length > 1) {
  const combinedValue = allocations.reduce((sum, a) => sum + a.value, 0);
  const combinedNetGain = allocations.reduce((sum, a) => sum + a.net_gain, 0);

  const aggregatedData = allocations.map(a => ({
    subkey: a.key,                      // ← use the group name (e.g. "Globally Diversified", "KH Traditional IRA", "US Large Blend", etc.)
    value: a.value,
    percentage: combinedValue > 0 ? (a.value / combinedValue) * 100 : 0,
  }));

  allocations = [{
    key: 'Aggregated Selection',
    value: combinedValue,
    percentage: 1,
    net_gain: combinedNetGain,
    data: aggregatedData,               // ← now at slice level, not ticker level
    items: allocations.map(a => ({      // optional: keep items for future drill-down if you want
      key: a.key,
      value: a.value,
      net_gain: a.net_gain,
      // could add child items later if needed
    })),
  }];
}
return NextResponse.json({ allocations });
} catch (err: unknown) {
  const message = err instanceof Error ? err.message : 'Internal Server Error';
  return NextResponse.json({ error: message }, { status: 500 });
}
}