// app/api/allocations/route.ts
import { createClient } from '@/lib/supabase/server';
import { NextResponse } from 'next/server';

export async function POST(request: Request) {
  try {
    const { lens = 'sub_portfolio' } = await request.json(); // default to sub_portfolio if not sent
    const supabase = await createClient();

    const { data: { user } } = await supabase.auth.getUser();
    if (!user) throw new Error('Unauthorized');

    // Updated query: Join sub_portfolios to get name for grouping/display
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
          sub_portfolio_id,
          sub_portfolio:sub_portfolios (name)
        ),
        account:accounts (name)
      `)
      .gt('remaining_quantity', 0)
      .eq('user_id', user.id);

    if (!lots || lots.length === 0) {
      return NextResponse.json({ allocations: [] });
    }
    console.log(`Fetched ${lots?.length || 0} lots for lens ${lens}`);
    // Get unique tickers and fetch prices (unchanged)
    const tickers = [...new Set(lots.map((l: any) => l.asset[0]?.ticker).filter(Boolean))];
    const { data: prices } = await supabase
      .from('asset_prices')
      .select('ticker, price')
      .in('ticker', tickers)
      .order('timestamp', { ascending: false });
    console.log(`Fetched ${prices?.length || 0} prices`);
    const priceMap = new Map(prices?.map((p: any) => [p.ticker, p.price]) ?? []);

    // Aggregate by lens (updated for sub_portfolio to use name)
    const map = new Map<string, {
      value: number;
      basis: number;
      items: { ticker: string; name: string | null; quantity: number; value: number; basis: number }[];
    }>();

    let totalValue = 0;

    lots.forEach((lot: any) => {
      const asset = lot.asset[0];
      if (!asset) return;
      let key: string;
      if (lens === 'account') {
        key = lot.account?.[0]?.name || 'Uncategorized';
      } else if (lens === 'sub_portfolio') {
        key = asset.sub_portfolio?.[0]?.name || 'Untagged';
      } else {
        key = (asset as any)[lens] || 'Untagged';
      }

      const quantity = lot.remaining_quantity;
      const basisThis = quantity * lot.cost_basis_per_unit;
      const price = Number(priceMap.get(asset.ticker)) || 1;
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

    // Add cash (unchanged – simple sum; adjust if cash per sub-portfolio needed)
    const { data: cashTxs } = await supabase
      .from('transactions')
      .select('amount')
      .eq('type', 'Cash')
      .eq('user_id', user.id);

    const cash = cashTxs?.reduce((sum: number, tx: any) => sum + (tx.amount || 0), 0) || 0;
    totalValue += cash;

    if (cash > 0) {
      map.set('Cash', { value: cash, basis: cash, items: [] });
    }

    // Format for Recharts + table (unchanged)
    const allocations = Array.from(map.entries()).map(([key, g]) => ({
      key,
      percentage: totalValue > 0 ? (g.value / totalValue) * 100 : 0,
      value: g.value,
      basis: g.basis,
      unrealized: g.value - g.basis,
      items: g.items
    }));

    // Sort by value descending (unchanged)
    allocations.sort((a, b) => b.value - a.value);

    return NextResponse.json({ allocations, totalValue });
  } catch (error) {
    console.error('Allocations error:', error);
    return NextResponse.json({ error: (error as Error).message }, { status: 500 });
  }
}