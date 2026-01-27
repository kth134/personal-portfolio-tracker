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
          asset:assets (id, ticker, sub_portfolio_id, asset_type, asset_subtype, geography, size_tag, factor_tag)
        `)
        .eq('user_id', user.id)
        .order('date', { ascending: true });
      if (start) q = q.gte('date', start);
      if (end) q = q.lte('date', end);
      const { data: transactions, error } = await q.range(0, pageSize - 1);
      if (error) {
        console.error('transactions API error', error);
        return NextResponse.json({ error: 'Query failed' }, { status: 500 });
      }
      const txs = transactions || [];
      const countsByType: Record<string, number> = {};
      txs.forEach((t: any) => { countsByType[t.type] = (countsByType[t.type] || 0) + 1; });
      console.debug('transactions counts by type (range):', countsByType);
      return NextResponse.json({ transactions: txs, debug: { countsByType } });
    }

    // No start/end: page through all transactions in batches to avoid server-side caps
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
          asset:assets (id, ticker, sub_portfolio_id, asset_type, asset_subtype, geography, size_tag, factor_tag)
        `)
        .eq('user_id', user.id)
        .order('date', { ascending: true })
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

    const transactions = allTransactions;
    const countsByType: Record<string, number> = {};
    transactions.forEach((t: any) => { countsByType[t.type] = (countsByType[t.type] || 0) + 1; });
    console.debug('transactions counts by type (paged):', countsByType);
    return NextResponse.json({ transactions, debug: { countsByType } });
  } catch (err) {
    console.error('transactions route error', err);
    return NextResponse.json({ error: 'Server error' }, { status: 500 });
  }
}
