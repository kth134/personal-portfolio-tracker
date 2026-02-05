import { createClient } from '@/lib/supabase/server';
import { NextResponse } from 'next/server';
import { fetchAllUserTransactionsServer } from '@/lib/finance';

export async function POST(req: Request) {
  try {
    const { lens, selectedValues, aggregate } = await req.json();
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    // 1. Fetch data in parallel
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

    // 2. Setup lookup maps
    const priceMap = new Map<string, number>();
    pricesList?.forEach((p: any) => { if (!priceMap.has(p.ticker)) priceMap.set(p.ticker, p.price) });

    // 3. Normalize and Group
    const normalize = (val: any) => Array.isArray(val) ? val[0] : val;
    
    const groups = new Map<string, {
      value: number;
      targetPct: number;
      items: any[];
    }>();

    let totalValueAcrossAll = 0;

    // First pass: Calculate current values and total portfolio value
    const processedLots = lots.map((l: any) => {
      const asset = normalize(l.asset);
      const account = normalize(l.account);
      const price = priceMap.get(asset?.ticker) || 0;
      const value = (l.remaining_quantity || 0) * price;
      totalValueAcrossAll += value;
      
      return { ...l, asset, account, value };
    });

    // Second pass: Group by lens
    processedLots.forEach((lot: any) => {
      let key = 'Other';
      switch (lens) {
        case 'sub_portfolio':
          const sp = subPortfolios?.find(p => p.id === lot.asset?.sub_portfolio_id);
          key = sp?.name || 'Unassigned';
          break;
        case 'account': key = lot.account?.name || 'Unknown'; break;
        case 'asset_type': key = lot.asset?.asset_type || 'Unknown'; break;
        case 'asset_subtype': key = lot.asset?.asset_subtype || 'Unknown'; break;
        case 'geography': key = lot.asset?.geography || 'Unknown'; break;
        case 'size_tag': key = lot.asset?.size_tag || 'Unknown'; break;
        case 'factor_tag': key = lot.asset?.factor_tag || 'Unknown'; break;
        default: key = lot.asset?.ticker || 'Unknown';
      }

      if (lens !== 'total' && selectedValues?.length > 0 && !selectedValues.includes(key)) return;

      if (!groups.has(key)) {
        groups.set(key, { value: 0, targetPct: 0, items: [] });
      }
      const g = groups.get(key)!;
      g.value += lot.value;

      // Calculate Target for this item (Implied Overall Target %)
      const sp = subPortfolios?.find(p => p.id === lot.asset?.sub_portfolio_id);
      const assetTargetInSP = assetTargets?.find(at => at.asset_id === lot.asset?.id && at.sub_portfolio_id === lot.asset?.sub_portfolio_id)?.target_percentage || 0;
      const spTargetPct = sp?.target_allocation || 0;
      const impliedOverallTarget = (spTargetPct * assetTargetInSP) / 100;

      // Avoid duplicate targets for same asset in a group
      const existing = g.items.find(i => i.ticker === lot.asset?.ticker);
      if (existing) {
        existing.value += lot.value;
      } else {
        g.items.push({
          ticker: lot.asset?.ticker,
          name: lot.asset?.name,
          value: lot.value,
          targetPct: impliedOverallTarget
        });
        g.targetPct += impliedOverallTarget;
      }
    });

    // 4. Format for response
    let allocations = Array.from(groups.entries()).map(([key, g]) => ({
      key,
      value: g.value,
      percentage: totalValueAcrossAll > 0 ? (g.value / totalValueAcrossAll) * 100 : 0,
      targetPct: g.targetPct,
      data: g.items.map(i => ({
        subkey: i.ticker,
        value: i.value,
        percentage: g.value > 0 ? (i.value / g.value) * 100 : 0,
        targetPct: i.targetPct // Overall target
      }))
    }));

    if (aggregate && allocations.length > 1) {
       const combinedValue = allocations.reduce((s, a) => s + a.value, 0);
       const combinedTarget = allocations.reduce((s, a) => s + a.targetPct, 0);
       allocations = [{
         key: 'Aggregated Selection',
         value: combinedValue,
         percentage: 100,
         targetPct: combinedTarget,
         data: allocations.map(a => ({
           subkey: a.key,
           value: a.value,
           percentage: combinedValue > 0 ? (a.value / combinedValue) * 100 : 0,
           targetPct: a.targetPct
         }))
       }];
    }

    return NextResponse.json({ allocations });
  } catch (err: any) {
    console.error('Allocations API error:', err);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}
