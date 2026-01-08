// app/api/allocations/route.ts
import { supabaseServer } from '@/lib/supabase/server';
import { NextResponse } from 'next/server';

export async function POST(request: Request) {
  try {
    const { lens = 'sub_portfolio' } = await request.json(); // default to sub_portfolio if not sent
    const supabase = await supabaseServer();

    const { data: { user } } = await supabase.auth.getUser();
    if (!user) throw new Error('Unauthorized');

    // Fetch open tax lots with asset tags and account name
    const { data: lots } = await supabase
      .from('tax_lots')
      .select(`
        remaining_quantity,
        cost_basis_per_unit,
        asset:assets (
          ticker,
          name,
          asset_type,
          asset_subtype,
          geography,
          factor_tag,
          size_tag,
          sub_portfolio
        ),
        account:accounts (name)
      `)
      .gt('remaining_quantity', 0)
      .eq('user_id', user.id);

    if (!lots || lots.length === 0) {
      return NextResponse.json({ allocations: [] });
    }

    // Get latest prices for all tickers
    const tickers = [...new Set(lots.map(l => l.asset[0]?.ticker).filter(Boolean))];
    const { data: prices } = await supabase
      .from('asset_prices')
      .select('ticker, price')
      .in('ticker', tickers)
      .order('timestamp', { ascending: false });

    const priceMap = new Map(prices?.map(p => [p.ticker, p.price]) ?? []);

    // Aggregate by lens
    const map = new Map<string, {
      value: number;
      basis: number;
      items: { ticker: string; name: string | null; quantity: number; value: number; basis: number }[];
    }>();

    let totalValue = 0;

    lots.forEach(lot => {
      const asset = lot.asset[0];
      if (!asset) return;
      const key = lens === 'account'
        ? lot.account?.[0]?.name || 'Uncategorized'
        : (asset as any)[lens] || 'Untagged';

      const quantity = lot.remaining_quantity;
      const basisThis = quantity * lot.cost_basis_per_unit;
      const price = priceMap.get(asset.ticker) || 0;
      const valueThis = quantity * price;

      if (!map.has(key)) {
        map.set(key, { value: 0, basis: 0, items: [] });
      }
      const group = map.get(key)!;
      group.value += valueThis;
      group.basis += basisThis;
      group.items.push({
        ticker: asset.ticker,
        name: asset.name,
        quantity,
        value: valueThis,
        basis: basisThis
      });
      totalValue += valueThis;
    });

    // Add cash (simple sum of cash-type transactions – adjust if you have a cash balance column)
    const { data: cashTxs } = await supabase
      .from('transactions')
      .select('amount')
      .eq('type', 'Cash')
      .eq('user_id', user.id);

    const cash = cashTxs?.reduce((sum, tx) => sum + (tx.amount || 0), 0) || 0;
    totalValue += cash;

    if (cash > 0) {
      map.set('Cash', { value: cash, basis: cash, items: [] });
    }

    // Format for Recharts + table
    const allocations = Array.from(map.entries()).map(([key, g]) => ({
      key,
      percentage: totalValue > 0 ? (g.value / totalValue) * 100 : 0,
      value: g.value,
      basis: g.basis,
      unrealized: g.value - g.basis,
      items: g.items
    }));

    // Sort by value descending
    allocations.sort((a, b) => b.value - a.value);

    return NextResponse.json({ allocations });
  } catch (error) {
    console.error('Allocations error:', error);
    return NextResponse.json({ error: (error as Error).message }, { status: 500 });
  }
}