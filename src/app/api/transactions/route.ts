import { createClient } from '@/lib/supabase/server';
import { NextResponse } from 'next/server';

export async function GET(req: Request) {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const { searchParams } = new URL(req.url);
    const start = searchParams.get('start');
    const end = searchParams.get('end');

    const pageSize = 1000;
    const allTransactions: any[] = [];

    // If start/end provided, do a single ranged query covering that window.
    if (start || end) {
      let q = supabase
        .from('transactions')
        .select(`
          id,
          date,
          type,
          amount,
          fees,
          funding_source,
          notes,
          asset_id,
          account_id,
          asset:assets (id, ticker, sub_portfolio_id, asset_type, asset_subtype, geography, size_tag, factor_tag),
          account:accounts (id, name, type)
        `)
        .eq('user_id', user.id)
        .order('date', { ascending: false });
      if (start) q = q.gte('date', start);
      if (end) q = q.lte('date', end);
      const { data: transactions, error } = await q.range(0, pageSize - 1);
      if (error) {
        console.error('transactions API error', error);
        return NextResponse.json({ error: 'Query failed' }, { status: 500 });
      }
      const txs = transactions || [];
      return NextResponse.json({ transactions: txs });
    }

    // No start/end: fetch all transactions in batches
    let offset = 0;
    while (true) {
      const from = offset * pageSize;
      const to = from + pageSize - 1;
      const { data: page, error } = await supabase
        .from('transactions')
        .select(`
          id,
          date,
          type,
          amount,
          fees,
          funding_source,
          notes,
          asset_id,
          account_id,
          asset:assets (id, ticker, sub_portfolio_id, asset_type, asset_subtype, geography, size_tag, factor_tag),
          account:accounts (id, name, type)
        `)
        .eq('user_id', user.id)
        .order('date', { ascending: false })
        .range(from, to);
      if (error) {
        console.error('transactions API error', error);
        return NextResponse.json({ error: 'Query failed' }, { status: 500 });
      }
      if (!page || page.length === 0) break;
      allTransactions.push(...page);
      if (page.length < pageSize) break; // last page
      offset += 1;
    }

    return NextResponse.json({ transactions: allTransactions });
  } catch (err) {
    console.error('transactions route error', err);
    return NextResponse.json({ error: 'Server error' }, { status: 500 });
  }
}
