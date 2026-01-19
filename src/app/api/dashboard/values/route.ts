import { createClient } from '@/lib/supabase/server';
import { NextResponse } from 'next/server';

export async function POST(req: Request) {
  try {
    const { lens } = await req.json();
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    if (lens === 'total') {
      return NextResponse.json({ values: [] });
    }

    if (lens === 'account') {
      const { data: txs, error } = await supabase
        .from('transactions')
        .select('account_id')
        .eq('user_id', user.id);
      if (error) throw error;
      const accountIds = [...new Set(txs?.map((t: any) => t.account_id) || [])];
      if (accountIds.length === 0) return NextResponse.json({ values: [] });
      const { data: accounts, error: accError } = await supabase
        .from('accounts')
        .select('id, name')
        .in('id', accountIds);
      if (accError) throw accError;
      const valuesArray = accounts?.map((acc: any) => ({ value: acc.id, label: acc.name })) || [];
      valuesArray.sort((a, b) => a.label.localeCompare(b.label));
      return NextResponse.json({ values: valuesArray });
    }

    if (lens === 'sub_portfolio') {
      const { data: txs, error } = await supabase
        .from('transactions')
        .select('asset_id')
        .eq('user_id', user.id);
      if (error) throw error;
      const assetIds = [...new Set(txs?.map((t: any) => t.asset_id) || [])];
      if (assetIds.length === 0) return NextResponse.json({ values: [] });
      const { data: assets, error: assetError } = await supabase
        .from('assets')
        .select('sub_portfolio_id')
        .in('id', assetIds);
      if (assetError) throw assetError;
      const subIds = [...new Set(assets?.map((a: any) => a.sub_portfolio_id).filter((id: any) => id) || [])];
      if (subIds.length === 0) return NextResponse.json({ values: [] });
      const { data: subs, error: subError } = await supabase
        .from('sub_portfolios')
        .select('id, name')
        .in('id', subIds);
      if (subError) throw subError;
      const valuesArray = subs?.map((sub: any) => ({ value: sub.id, label: sub.name })) || [];
      valuesArray.sort((a, b) => a.label.localeCompare(b.label));
      return NextResponse.json({ values: valuesArray });
    }

    // For other lenses, use tax_lots as before, but change to transactions for consistency
    const { data: txAssets, error: txError } = await supabase
      .from('transactions')
      .select('asset_id')
      .eq('user_id', user.id);
    if (txError) throw txError;
    const assetIds = [...new Set(txAssets?.map((t: any) => t.asset_id) || [])];
    if (assetIds.length === 0) return NextResponse.json({ values: [] });

    let query = supabase
      .from('assets')
      .select(`${lens}`)
      .in('id', assetIds);

    const { data, error } = await query;
    if (error) throw error;

    const valuesSet = new Set<string>();
    const valuesArray: {value: string, label: string}[] = [];
    data?.forEach((row: any) => {
      const value = (row[lens] || '').trim();
      if (value && !valuesSet.has(value)) {
        valuesSet.add(value);
        valuesArray.push({ value, label: value });
      }
    });

    valuesArray.sort((a, b) => a.label.localeCompare(b.label));
    return NextResponse.json({ values: valuesArray });
  } catch (err) {
    console.error('Values API error:', err);
    return NextResponse.json({ error: 'Server error' }, { status: 500 });
  }
}