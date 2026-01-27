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

    const { data: transactions, error } = await q;
    if (error) {
      console.error('transactions API error', error);
      return NextResponse.json({ error: 'Query failed' }, { status: 500 });
    }

    return NextResponse.json({ transactions });
  } catch (err) {
    console.error('transactions route error', err);
    return NextResponse.json({ error: 'Server error' }, { status: 500 });
  }
}
