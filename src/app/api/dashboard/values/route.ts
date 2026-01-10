import { supabaseServer } from '@/lib/supabase/server';
import { NextResponse } from 'next/server';

export async function POST(req: Request) {
  try {
    const { lens } = await req.json();
    const supabase = await supabaseServer();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    if (lens === 'total') {
      return NextResponse.json({ values: [] });
    }

    let query = supabase
      .from('tax_lots')
      .select('asset:assets(*)')
      .gt('remaining_quantity', 0)
      .eq('user_id', user.id);

    // Map lens to column (adjust if your asset tags are different)
    let column: string;
    switch (lens) {
      case 'sub_portfolio':
        column = 'sub_portfolio->sub_portfolios->name';
        query = query.select('asset:assets(sub_portfolio:sub_portfolios(name))');
        break;
      case 'account':
        column = 'account->accounts->name';
        query = query.select('account:accounts(name)');
        break;
      case 'asset_type':
      case 'asset_subtype':
      case 'geography':
      case 'size_tag':
      case 'factor_tag':
        column = lens;
        query = query.select(`asset:assets(${lens})`);
        break;
      default:
        return NextResponse.json({ error: 'Invalid lens' }, { status: 400 });
    }

    const { data, error } = await query;
    if (error) throw error;

    // Extract values (handle nested joins)
    const valuesSet = new Set<string>();
    data?.forEach((row: any) => {
      let value: string | null = null;
      if (lens === 'sub_portfolio') {
        value = row.asset?.sub_portfolio?.name;
      } else if (lens === 'account') {
        value = row.account?.name;
      } else {
        value = row.asset?.[lens];
      }
      if (value) valuesSet.add(value);
      else valuesSet.add('Untagged');
    });

    const values = Array.from(valuesSet).sort();
    return NextResponse.json({ values });
  } catch (err) {
    console.error('Values API error:', err);
    return NextResponse.json({ error: 'Server error' }, { status: 500 });
  }
}