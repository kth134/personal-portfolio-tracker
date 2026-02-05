import { createClient } from '@/lib/supabase/server';
import { NextResponse } from 'next/server';

export async function POST(req: Request) {
  try {
    const { lens, selectedValues, aggregate } = await req.json();
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const [
      { data: lots },
      { data: assetTargets },
      { data: subPortfolios },
      { data: pricesList }
    ] = await Promise.all([
      supabase.from('tax_lots').select(`
        remaining_quantity,
        cost_basis_per_unit,
        asset_id,
        asset:assets(id, ticker, name, asset_type, asset_subtype, geography, size_tag, factor_tag, sub_portfolio_id),
        account:accounts(id, name)
      `).gt('remaining_quantity', 0).eq('user_id', user.id),
      supabase.from('asset_targets').select('*').eq('user_id', user.id),
      supabase.from('sub_portfolios').select('*').eq('user_id', user.id),
      supabase.from('asset_prices').select('ticker, price, timestamp').order('timestamp', { ascending: false })
    ]);

    if (!lots || lots.length === 0) return NextResponse.json({ allocations: [] });

    const priceMap = new Map<string, number>();
    pricesList?.forEach((p: any) => { if (!priceMap.has(p.ticker)) priceMap.set(p.ticker, p.price) });

    const normalize = (val: any) => Array.isArray(val) ? val[0] : val;
    const groups = new Map<string, any>();
    let totalPortfolioValue = 0;

    const processedLots = lots.map((l: any) => {
      const asset = normalize(l.asset);
      const account = normalize(l.account);
      const price = priceMap.get(asset?.ticker) || 0;
      const value = (l.remaining_quantity || 0) * price;
      totalPortfolioValue += value;
      return { ...l, asset, account, value };
    });

    processedLots.forEach((lot: any) => {
      let key = 'Other';
      if (lens === 'total') {
        key = 'Total Portfolio';
      } else {
        switch (lens) {
          case 'sub_portfolio':
            const sp = subPortfolios?.find(p => p.id === lot.asset?.sub_portfolio_id);
            key = sp?.name || 'Unassigned';
            break;
          case 'account': key = lot.account?.name || 'Unknown'; break;
          case 'asset_type': key = lot.asset?.asset_type || 'Unknown'; break;
          default: key = lot.asset?.ticker || 'Unknown';
        }
      }

      if (lens !== 'total' && selectedValues?.length > 0 && !selectedValues.includes(key)) return;

      if (!groups.has(key)) {
        groups.set(key, { value: 0, target_pct: 0, cost_basis: 0, items: [] });
      }
      const g = groups.get(key)!;
      g.value += lot.value;

      const sp = subPortfolios?.find(p => p.id === lot.asset?.sub_portfolio_id);
      const assetTargetInSP = assetTargets?.find(at => at.asset_id === lot.asset?.id && at.sub_portfolio_id === lot.asset?.sub_portfolio_id)?.target_percentage || 0;
      const impliedTarget = ((sp?.target_allocation || 0) * assetTargetInSP) / 100;

      const lotBasis = (lot.remaining_quantity || 0) * (lot.cost_basis_per_unit || 0);
      g.cost_basis += lotBasis;

      // Group by ticker within the group to aggregate lots into positions
      const existing = g.items.find((i: any) => i.ticker === lot.asset?.ticker);
      if (existing) {
        existing.value += lot.value;
        existing.quantity += (lot.remaining_quantity || 0);
        existing.cost_basis += lotBasis;
      } else {
        g.items.push({
          ticker: lot.asset?.ticker,
          name: lot.asset?.name,
          value: lot.value,
          target_pct: impliedTarget,
          quantity: (lot.remaining_quantity || 0),
          cost_basis: lotBasis
        });
        g.target_pct += impliedTarget;
      }
    });

    let allocations = Array.from(groups.entries()).map(([key, g]) => ({
      key,
      value: g.value,
      cost_basis: g.cost_basis,
      percentage: totalPortfolioValue > 0 ? (g.value / totalPortfolioValue) * 100 : 0,
      target_pct: g.target_pct,
      data: g.items.map((i: any) => ({
        subkey: i.ticker,
        value: i.value,
        percentage: g.value > 0 ? (i.value / g.value) * 100 : 0,
        target_pct: i.target_pct,
        implied_overall_target: i.target_pct
      })),
      items: g.items
    }));

    if (aggregate && allocations.length > 1) {
       const combinedValue = allocations.reduce((s, a) => s + a.value, 0);
       const combinedTarget = allocations.reduce((s, a) => s + a.target_pct, 0);
       const combinedBasis = allocations.reduce((s, a) => s + (a.cost_basis || 0), 0);
       allocations = [{
         key: 'Aggregated Selection',
         value: combinedValue,
         cost_basis: combinedBasis,
         percentage: 100,
         target_pct: combinedTarget,
         data: allocations.map(a => ({
           subkey: a.key,
           value: a.value,
           percentage: combinedValue > 0 ? (a.value / combinedValue) * 100 : 0,
           target_pct: a.target_pct,
           implied_overall_target: a.target_pct
         })),
         items: []
       }];
    }

    return NextResponse.json({ allocations });
  } catch (err: any) {
    console.error(err);
    return NextResponse.json({ error: 'Internal Error' }, { status: 500 });
  }
}
