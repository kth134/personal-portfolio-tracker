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

    let query = supabase
      .from('tax_lots')
      .select('asset:assets(*), account:accounts(name)')
      .eq('user_id', user.id);

    // Map lens to column (adjust if your asset tags are different)
    let column: string;
    switch (lens) {
      case 'asset':
        // For asset, return {value: id, label: display}
        query = query.select('asset:assets(id, ticker, name)');
        break;
      case 'sub_portfolio':
        column = 'asset.sub_portfolios.name';
        query = query.select('asset:assets(sub_portfolios!sub_portfolio_id(id, name))');
        break;
      case 'account':
        column = 'account.name';
        query = query.select('account:accounts(id, name)');
        break;
      case 'asset_type':
        column = 'asset.asset_type';
        query = query.select('asset:assets(asset_type)');
        break;
      case 'asset_subtype':
        column = 'asset.asset_subtype';
        query = query.select('asset:assets(asset_subtype)');
        break;
      case 'geography':
        column = 'asset.geography';
        query = query.select('asset:assets(geography)');
        break;
      case 'size_tag':
        column = 'asset.size_tag';
        query = query.select('asset:assets(size_tag)');
        break;
      case 'factor_tag':
        column = 'asset.factor_tag';
        query = query.select('asset:assets(factor_tag)');
        break;
      default:
        return NextResponse.json({ error: 'Invalid lens' }, { status: 400 });
    }

    const { data, error } = await query;
    if (error) throw error;

    // Extract values (handle nested joins)
    const valuesSet = new Set<string>();
    const valuesArray: {value: string, label: string}[] = [];
    if (lens === 'asset') {
      const assetSet = new Set<string>();
      data?.forEach((row: any) => {
        const asset = row.asset;
        if (asset && !assetSet.has(asset.id)) {
          assetSet.add(asset.id);
          const label = `${asset.ticker}${asset.name ? ` - ${asset.name}` : ''}`;
          valuesArray.push({ value: asset.id, label });
        }
      });
    } else {
      data?.forEach((row: any) => {
        let value: string | null = null;
        if (lens === 'sub_portfolio') {
          const sp = row.asset?.sub_portfolios;
          const id = sp?.id || '';
          value = id;
          const label = (sp?.name || '').trim();
          if (value && label && !valuesSet.has(value)) {
            valuesSet.add(value);
            valuesArray.push({ value, label });
          }
          return;
        } else if (lens === 'account') {
          const acc = row.account;
          const id = acc?.id || '';
          value = id;
          const label = (acc?.name || '').trim();
          if (value && label && !valuesSet.has(value)) {
            valuesSet.add(value);
            valuesArray.push({ value, label });
          }
          return;
        } else {
          value = (row.asset?.[lens] || '').trim();
        }
        if (value && !valuesSet.has(value)) {
          valuesSet.add(value);
          valuesArray.push({ value, label: value });
        }
      });
    }

    valuesArray.sort((a, b) => a.label.localeCompare(b.label));
    return NextResponse.json({ values: valuesArray });
  } catch (err) {
    console.error('Values API error:', err);
    return NextResponse.json({ error: 'Server error' }, { status: 500 });
  }
}