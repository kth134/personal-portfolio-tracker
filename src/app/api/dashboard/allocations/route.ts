import { supabaseServer } from '@/lib/supabase/server';
import { NextResponse } from 'next/server';

export async function POST(req: Request) {
  try {
    const { lens, selectedValues, aggregate } = await req.json();
    const supabase = await supabaseServer();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    // Fetch open lots with joins
    let lotsQuery = supabase
      .from('tax_lots')
      .select(`
        remaining_quantity,
        cost_basis_per_unit,
        asset:assets(id, ticker, name, asset_type, asset_subtype, geography, size_tag, factor_tag, sub_portfolio:sub_portfolios!inner(name)),
        account:accounts!inner(name)
      `)
      .gt('remaining_quantity', 0)
      .eq('user_id', user.id);

    if (lens !== 'total' && selectedValues?.length > 0) {
      // Apply filter based on lens
      switch (lens) {
        case 'sub_portfolio':
          // TODO: Implement filtering by sub_portfolio names
          break;
        // Add similar for other lenses
      }
    }

    const lots = (await lotsQuery).data as any[];

    // Fetch latest prices (reuse your existing logic)
    const tickers = [...new Set(lots?.map(l => l.asset.ticker) || [])];
    const { data: prices } = await supabase
      .from('asset_prices')
      .select('ticker, price')
      .in('ticker', tickers)
      .order('timestamp', { ascending: false });

    const priceMap = new Map(prices?.map(p => [p.ticker, p.price]) || []);

    // Fetch transactions for realized/dividends/fees (all time, filtered if needed)
    const { data: transactions } = await supabase
      .from('transactions')
      .select('asset_id, realized_gain, amount, fees, type')
      .eq('user_id', user.id);

    // Aggregate net gains by asset_id
    const netGainByAsset = new Map<string, number>();
    transactions?.forEach(tx => {
      if (!tx.asset_id) return;
      let gain = (tx.realized_gain || 0);
      if (tx.type === 'Dividend' || tx.type === 'Interest') gain += (tx.amount || 0);
      gain -= Math.abs(tx.fees || 0);
      netGainByAsset.set(tx.asset_id, (netGainByAsset.get(tx.asset_id) || 0) + gain);
    });

    // Compute holdings per group (key = lens value)
    const groups = new Map<string, any>();
    let totalValue = 0;

    lots?.forEach(lot => {
      const ticker = lot.asset.ticker;
      const qty = lot.remaining_quantity;
      const basis = qty * lot.cost_basis_per_unit;
      const price = priceMap.get(ticker) || 0;
      const value = qty * price;
      const unreal = value - basis;
      const netGain = unreal + (netGainByAsset.get(lot.asset.id) || 0);

      let key = 'Total';
      if (lens !== 'total') {
        switch (lens) {
          case 'sub_portfolio': key = lot.asset.sub_portfolio?.name || 'Untagged'; break;
          case 'account': key = lot.account?.name || 'Untagged'; break;
          // Add others
          default: key = lot.asset[lens] || 'Untagged';
        }
      }

      if (!groups.has(key)) {
        groups.set(key, { value: 0, net_gain: 0, items: [] });
      }
      const group = groups.get(key);
      group.value += value;
      group.net_gain += netGain;
      group.items.push({
        ticker,
        name: lot.asset.name,
        quantity: qty,
        value,
        net_gain: netGain,
      });
      totalValue += value;
    });

    // Build response
    let allocations: any[] = [];
    groups.forEach((g, key) => {
      allocations.push({
        key,
        value: g.value,
        percentage: totalValue > 0 ? g.value / totalValue : 0,
        net_gain: g.net_gain,
        data: g.items.map((i: any) => ({ subkey: i.ticker, value: i.value })),
        items: g.items,
      });
    });

    if (aggregate && allocations.length > 1) {
      // Combine into single
      const combined = allocations.reduce((acc, cur) => ({
        key: 'Aggregated',
        value: acc.value + cur.value,
        net_gain: acc.net_gain + cur.net_gain,
        data: [...acc.data, ...cur.data],
        items: [...acc.items, ...cur.items],
      }));
      allocations = [combined];
    }

    return NextResponse.json({ allocations });
  } catch (err) {
    console.error('Allocations API error:', err);
    return NextResponse.json({ error: 'Server error' }, { status: 500 });
  }
}