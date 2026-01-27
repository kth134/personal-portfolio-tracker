import { createClient } from '@/lib/supabase/server';
import { NextResponse } from 'next/server';

export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const assetId = url.searchParams.get('asset_id');
    if (!assetId) return NextResponse.json({ error: 'missing asset_id' }, { status: 400 });

    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const { data: transactions, error } = await supabase
      .from('transactions')
      .select('*')
      .eq('user_id', user.id)
      .eq('asset_id', assetId)
      .order('date', { ascending: true });

    if (error) {
      console.error('debug transactions query error', error);
      return NextResponse.json({ error: 'query error' }, { status: 500 });
    }

    return NextResponse.json({ transactions });
  } catch (err) {
    console.error('debug transactions handler error', err);
    return NextResponse.json({ error: 'server error' }, { status: 500 });
  }
}
