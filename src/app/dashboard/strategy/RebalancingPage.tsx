'use client'

import { useState, useEffect, useMemo } from 'react'
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, ResponsiveContainer, Tooltip as RechartsTooltip, Cell,
  PieChart, Pie, Legend
} from 'recharts'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'
import { Label } from '@/components/ui/label'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from '@/components/ui/accordion'
import { Popover, PopoverTrigger, PopoverContent } from '@/components/ui/popover'
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from '@/components/ui/command'
import { Check, ChevronsUpDown, ArrowUpDown, RefreshCw, AlertTriangle } from 'lucide-react'
import { cn } from '@/lib/utils'
import { calculatePortfolioAssetAction } from '@/lib/rebalancing-logic'
import { refreshAssetPrices } from '../portfolio/actions'

const COLORS = ['#3b82f6', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6', '#ec4899', '#06b6d4', '#14b8a6', '#f97316', '#a855f7']

const LENSES = [
  { value: 'total', label: 'Assets' },
  { value: 'sub_portfolio', label: 'Sub-Portfolio' },
  { value: 'asset_type', label: 'Asset Type' },
  { value: 'asset_subtype', label: 'Asset Sub-Type' },
  { value: 'size_tag', label: 'Size' },
  { value: 'geography', label: 'Geography' },
  { value: 'factor_tag', label: 'Factor' },
]

const formatUSDWhole = (value: number | null | undefined) => {
  const num = Math.round(Number(value) || 0)
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(num)
}

const parsePercentWithTwoDecimals = (rawValue: string): number | null => {
  const trimmed = rawValue.trim()
  if (trimmed === '') return null
  const parsed = Number(trimmed)
  if (!Number.isFinite(parsed) || parsed < 0 || parsed > 100) return null
  const scaled = parsed * 100
  if (Math.abs(scaled - Math.round(scaled)) > 1e-9) return null
  return Math.round(scaled) / 100
}

export default function RebalancingPage() {
  const [lens, setLens] = useState('total')
  const [availableValues, setAvailableValues] = useState<{value: string, label: string}[]>([])
  const [selectedValues, setSelectedValues] = useState<string[]>([])
  const [aggregate, setAggregate] = useState(false)
  const [data, setData] = useState<any>(null)
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [openItems, setOpenItems] = useState<string[]>([])
  
  const [sortCol, setSortCol] = useState('current_value')
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc')

  // Local overrides for instant updates (Rule #8)
  const [overrideSubSettings, setOverrideSubSettings] = useState<Record<string, { target?: number, upside?: number, downside?: number, bandMode?: boolean }>>({})
  const [overrideAssetTargets, setOverrideAssetTargets] = useState<Record<string, number>>({})

  const fetchData = async () => {
    setLoading(true)
    try {
      const res = await fetch('/api/rebalancing', { cache: 'no-store' })
      const payload = await res.json()
      setData(payload)
      // Default to collapsed (do NOT auto-populate openItems)
    } catch (err) { console.error('Fetch error:', err) } finally { setLoading(false) }
  }

  useEffect(() => { fetchData() }, [])

  const updateSubPortfolio = async (id: string, field: string, value: any) => {
    // Rule #8: Update local state immediately for instant math refresh
    const key = field === 'target_allocation' ? 'target' : 
                field === 'upside_threshold' ? 'upside' :
                field === 'downside_threshold' ? 'downside' : 'bandMode';
    
    setOverrideSubSettings(prev => ({
      ...prev,
      [id]: { ...(prev[id] || {}), [key]: value }
    }));

    try {
      const endpoint = field === 'target_allocation' ? '/api/rebalancing/sub-portfolio-target' : '/api/rebalancing/thresholds';
      const currentSp = (data?.subPortfolios || []).find((sp: any) => sp.id === id) || {};
      const currentOverride = overrideSubSettings[id] || {};
      const effectiveUpside = currentOverride.upside ?? currentSp.upside_threshold ?? 5;
      const effectiveDownside = currentOverride.downside ?? currentSp.downside_threshold ?? 5;
      const effectiveBandMode = currentOverride.bandMode ?? currentSp.band_mode ?? false;

      const payload = field === 'target_allocation'
        ? { id, target_percentage: value }
        : {
            id,
            upside_threshold: field === 'upside_threshold' ? value : effectiveUpside,
            downside_threshold: field === 'downside_threshold' ? value : effectiveDownside,
            band_mode: field === 'band_mode' ? !!value : !!effectiveBandMode,
          };
      const res = await fetch(endpoint, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
      if (res.ok) {
        // Soft refresh of data to sync with DB without resetting local overrides manually
        const softRes = await fetch('/api/rebalancing', { cache: 'no-store' });
        const softPayload = await softRes.json();
        setData(softPayload);
      } else {
        console.error('Save failed for sub-portfolio update:', await res.text());
      }
    } catch (err) { console.error('Save failed:', err) }
  }

  const updateAssetTarget = async (assetId: string, spId: string, value: number) => {
    setOverrideAssetTargets(p => ({...p, [assetId]: value}));
    try {
      const res = await fetch('/api/rebalancing/asset-target', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ asset_id: assetId, sub_portfolio_id: spId, target_percentage: value }) });
      if (res.ok) {
        const softRes = await fetch('/api/rebalancing', { cache: 'no-store' });
        const softPayload = await softRes.json();
        setData(softPayload);
      }
    } catch (err) { console.error(err) }
  }

  useEffect(() => {
    if (lens === 'total') { setAvailableValues([]); setSelectedValues([]); return; }
    const fetchVals = async () => {
      try {
        const res = await fetch('/api/dashboard/values', { method: 'POST', body: JSON.stringify({ lens }) })
        const payload = await res.json()
        const vals = payload.values || []
        setAvailableValues(vals)
        // Rebalancing chart groups sub-portfolios by display name, while values API
        // returns ids for `sub_portfolio`. Use labels to keep filtering aligned.
        setSelectedValues(
          vals.map((v: any) => lens === 'sub_portfolio' ? (v.label ?? v.value) : v.value)
        )
      } catch (err) { console.error('Values error:', err) }
    }
    fetchVals()
  }, [lens])

  const calculatedData = useMemo(() => {
    if (!data) return null;

    // 1. Process Groups / Sub-Portfolios with local overrides for instant reactivity
    const subPortfolios = data.subPortfolios.map((sp: any) => {
      const overrides = overrideSubSettings[sp.id] || {};
      return {
        ...sp,
        target_allocation: overrides.target ?? sp.target_allocation,
        upside_threshold: overrides.upside ?? sp.upside_threshold,
        downside_threshold: overrides.downside ?? sp.downside_threshold,
        band_mode: overrides.bandMode ?? sp.band_mode
      };
    });

    // Compute current totals per sub-portfolio
    const subIdValues: Record<string, number> = data.currentAllocations.reduce((acc: any, item: any) => {
      acc[item.sub_portfolio_id] = (acc[item.sub_portfolio_id] || 0) + item.current_value;
      return acc;
    }, {});

    // 2. Process assets while preserving sub-portfolio target editing context.
    const allocations = data.currentAllocations.map((a: any) => {
      const sp = subPortfolios.find((p: any) => p.id === a.sub_portfolio_id);
      const targetInGroup = overrideAssetTargets[a.asset_id] ?? a.sub_portfolio_target_percentage;
      const groupVal = subIdValues[a.sub_portfolio_id] || 0;
      const impliedOverallTarget = ((sp?.target_allocation || 0) * targetInGroup) / 100;
      const currentInSPPct = groupVal > 0 ? (a.current_value / groupVal) * 100 : 0;
      const driftInSP = targetInGroup > 0 ? ((currentInSPPct - targetInGroup) / targetInGroup) * 100 : 0;

      return {
        ...a,
        sub_portfolio_target_percentage: targetInGroup,
        implied_overall_target: impliedOverallTarget,
        current_in_sp: currentInSPPct,
        drift_percentage_in_sp: driftInSP,
      };
    });

    // 3. Portfolio-wide drift/action by asset.
    // Assumes each asset is aligned to a single sub-portfolio.
    const portfolioAssetActions = new Map<string, any>();
    allocations.forEach((row: any) => {
      const sp = subPortfolios.find((p: any) => p.id === row.sub_portfolio_id);
      const res = calculatePortfolioAssetAction({
        currentValue: row.current_value,
        totalPortfolioValue: data.totalValue,
        targetOverallPct: row.implied_overall_target || 0,
        upsideThreshold: Math.abs(sp?.upside_threshold ?? 5),
        downsideThreshold: Math.abs(sp?.downside_threshold ?? 5),
        bandMode: !!sp?.band_mode,
      });

      portfolioAssetActions.set(row.asset_id, {
        asset_id: row.asset_id,
        ticker: row.ticker,
        name: row.name,
        current_value: row.current_value,
        target_overall_pct: row.implied_overall_target || 0,
        amount_mode: sp?.band_mode ? 'Conservative' : 'Absolute',
        current_overall_pct: res.currentOverallPct,
        drift_percentage: res.driftPercentage,
        action: res.action,
        amount: res.amount,
      });
    });

    // 4. Portfolio-wide tactical suggestions (cross sub-portfolios).
    const accountHoldings = data.accountHoldings || {};
    const remainingNeedByAsset: Record<string, number> = {};
    const remainingAvailByAsset: Record<string, number> = {};
    const excessToTargetByAsset: Record<string, number> = {};
    const deficitToTargetByAsset: Record<string, number> = {};
    const reinvestmentByAsset: Record<string, any[]> = {};

    const assetActionList = Array.from(portfolioAssetActions.values());
    assetActionList.forEach((asset: any) => {
      const targetValue = (data.totalValue * (asset.target_overall_pct || 0)) / 100;
      const excessToTarget = Math.max(0, asset.current_value - targetValue);
      const deficitToTarget = Math.max(0, targetValue - asset.current_value);

      excessToTargetByAsset[asset.asset_id] = excessToTarget;
      deficitToTargetByAsset[asset.asset_id] = deficitToTarget;

      // Sell actions are capped at explicit action amount. Non-triggered sources can only fund up to excess-to-target.
      remainingAvailByAsset[asset.asset_id] = asset.action === 'sell'
        ? Math.min(asset.amount, excessToTarget)
        : excessToTarget;

      // Buy actions are capped at explicit action amount. Non-triggered destinations can only absorb up to deficit-to-target.
      remainingNeedByAsset[asset.asset_id] = asset.action === 'buy'
        ? Math.min(asset.amount, deficitToTarget)
        : deficitToTarget;

      reinvestmentByAsset[asset.asset_id] = [];
    });

    const sellAssets = assetActionList
      .filter((a: any) => a.action === 'sell' && a.amount > 0)
      .sort((a: any, b: any) => b.drift_percentage - a.drift_percentage);
    const buyAssets = assetActionList
      .filter((a: any) => a.action === 'buy' && a.amount > 0)
      .sort((a: any, b: any) => a.drift_percentage - b.drift_percentage);

    const applyTransfer = (
      fromAsset: any,
      toAsset: any,
      amount: number,
      toReason: string,
      fromReason: string,
      pairType: 'explicit' | 'implied'
    ) => {
      if (amount <= 0) return;

      reinvestmentByAsset[fromAsset.asset_id].push({
        to_ticker: toAsset.ticker,
        amount,
        reason: toReason,
        pair_type: pairType,
      });

      reinvestmentByAsset[toAsset.asset_id].push({
        from_ticker: fromAsset.ticker,
        amount,
        reason: fromReason,
        pair_type: pairType,
      });

      remainingAvailByAsset[fromAsset.asset_id] = Math.max(0, (remainingAvailByAsset[fromAsset.asset_id] || 0) - amount);
      remainingNeedByAsset[toAsset.asset_id] = Math.max(0, (remainingNeedByAsset[toAsset.asset_id] || 0) - amount);
    };

    // Phase 1: Pair explicitly triggered sells and buys first.
    sellAssets.forEach((sellAsset: any) => {
      let remainingToDeploy = remainingAvailByAsset[sellAsset.asset_id] || 0;
      buyAssets.forEach((buyAsset: any) => {
        if (buyAsset.asset_id === sellAsset.asset_id) return;
        if (remainingToDeploy <= 0) return;
        const need = remainingNeedByAsset[buyAsset.asset_id] || 0;
        if (need <= 0) return;

        const transfer = Math.min(remainingToDeploy, need);
        applyTransfer(
          sellAsset,
          buyAsset,
          transfer,
          `Redeploy into triggered underweight ${buyAsset.ticker}`,
          `Fund triggered buy from overweight ${sellAsset.ticker}`,
          'explicit'
        );
        remainingToDeploy -= transfer;
      });
    });

    // Phase 2: If buy actions still need funding, source from assets furthest above overall target
    // even if those source assets did not breach upside thresholds.
    buyAssets.forEach((buyAsset: any) => {
      let needed = remainingNeedByAsset[buyAsset.asset_id] || 0;
      if (needed <= 0) return;

      const sourcePool = assetActionList
        .filter((source: any) => source.asset_id !== buyAsset.asset_id && (remainingAvailByAsset[source.asset_id] || 0) > 0)
        .sort((a: any, b: any) => {
          const excessDelta = (excessToTargetByAsset[b.asset_id] || 0) - (excessToTargetByAsset[a.asset_id] || 0);
          if (excessDelta !== 0) return excessDelta;
          return b.drift_percentage - a.drift_percentage;
        });

      sourcePool.forEach((sourceAsset: any) => {
        if (needed <= 0) return;
        const available = remainingAvailByAsset[sourceAsset.asset_id] || 0;
        if (available <= 0) return;

        const transfer = Math.min(available, needed);
        const sourceReason = sourceAsset.action === 'sell'
          ? `Fund triggered buy from overweight ${sourceAsset.ticker}`
          : `Implied funding from above-target ${sourceAsset.ticker}`;

        applyTransfer(
          sourceAsset,
          buyAsset,
          transfer,
          `Allocate toward triggered underweight ${buyAsset.ticker}`,
          sourceReason,
          'implied'
        );
        needed -= transfer;
      });
    });

    // Phase 3: If sell actions still have proceeds, deploy to assets furthest below overall target
    // even if those destination assets did not breach downside thresholds.
    sellAssets.forEach((sellAsset: any) => {
      let available = remainingAvailByAsset[sellAsset.asset_id] || 0;
      if (available <= 0) return;

      const destinationPool = assetActionList
        .filter((dest: any) => dest.asset_id !== sellAsset.asset_id && (remainingNeedByAsset[dest.asset_id] || 0) > 0)
        .sort((a: any, b: any) => {
          const deficitDelta = (deficitToTargetByAsset[b.asset_id] || 0) - (deficitToTargetByAsset[a.asset_id] || 0);
          if (deficitDelta !== 0) return deficitDelta;
          return a.drift_percentage - b.drift_percentage;
        });

      destinationPool.forEach((destAsset: any) => {
        if (available <= 0) return;
        const need = remainingNeedByAsset[destAsset.asset_id] || 0;
        if (need <= 0) return;

        const transfer = Math.min(available, need);
        const destReason = destAsset.action === 'buy'
          ? `Redeploy into triggered underweight ${destAsset.ticker}`
          : `Implied redeploy into below-target ${destAsset.ticker}`;

        applyTransfer(
          sellAsset,
          destAsset,
          transfer,
          destReason,
          `Fund from overweight ${sellAsset.ticker}`,
          'implied'
        );
        available -= transfer;
      });
    });

    const recommendedAccountsByAsset: Record<string, any[]> = {};
    sellAssets.forEach((sellAsset: any) => {
      const holdings = accountHoldings[sellAsset.asset_id] || [];
      const sortedHoldings = [...holdings].sort((a: any, b: any) => {
        const aTax = a.tax_status === 'Taxable' ? 1 : 0;
        const bTax = b.tax_status === 'Taxable' ? 1 : 0;
        if (aTax !== bTax) return aTax - bTax;
        return b.value - a.value;
      });

      const recommendations: any[] = [];
      let remainingToSell = sellAsset.amount;
      sortedHoldings.forEach((h: any) => {
        if (remainingToSell <= 0) return;
        const take = Math.min(h.value, remainingToSell);
        if (take > 0) {
          recommendations.push({
            id: h.account_id,
            name: h.name || 'Unknown',
            amount: take,
            reason: 'Trimming overweight position',
          });
          remainingToSell -= take;
        }
      });
      recommendedAccountsByAsset[sellAsset.asset_id] = recommendations;
    });

    const updatedAllocations = allocations.map((row: any) => {
      const portfolio = portfolioAssetActions.get(row.asset_id) || {
        current_overall_pct: 0,
        target_overall_pct: 0,
        drift_percentage: 0,
        action: 'hold',
        amount: 0,
      };

      return {
        ...row,
        current_percentage: portfolio.current_overall_pct,
        drift_percentage: portfolio.drift_percentage,
        action: portfolio.action,
        amount: portfolio.amount,
        reinvestment_suggestions: reinvestmentByAsset[row.asset_id] || [],
        recommended_accounts: recommendedAccountsByAsset[row.asset_id] || [],
      };
    });

    const totalWeightedAssetDrift = updatedAllocations.reduce((sum: number, item: any) => {
      const weight = item.current_value / data.totalValue;
      const currentOverallPct = (item.current_value / data.totalValue) * 100;
      const targetOverallPct = item.implied_overall_target;
      const relativeDriftOverall = targetOverallPct > 0 ? ((currentOverallPct - targetOverallPct) / targetOverallPct) * 100 : 0;
      return sum + (Math.abs(relativeDriftOverall) * weight);
    }, 0);

    const totalWeightedSubDrift = subPortfolios.reduce((sum: number, sp: any) => {
      const val = subIdValues[sp.id] || 0;
      const weight = val / data.totalValue;
      const currentPct = (val / data.totalValue) * 100;
      const relDrift = sp.target_allocation > 0 ? ((currentPct - sp.target_allocation) / sp.target_allocation) * 100 : 0;
      return sum + (Math.abs(relDrift) * weight);
    }, 0);

    const netImpact = assetActionList.reduce((sum: number, item: any) => {
      if (item.action === 'sell') return sum + item.amount;
      if (item.action === 'buy') return sum - item.amount;
      return sum;
    }, 0);

    return {
      allocations: updatedAllocations,
      subPortfolios,
      assetLevel: assetActionList,
      totalWeightedAssetDrift,
      totalWeightedSubDrift,
      netImpact,
    };
  }, [data, overrideSubSettings, overrideAssetTargets]);

  const chartSlices = useMemo(() => {
    if (!calculatedData) return [];

    let base: any[] = [];
    if (lens === 'total') {
      base = [{ key: 'Portfolio', data: [...calculatedData.allocations] }];
    } else {
      const groupMap = new Map();
      calculatedData.allocations.forEach((a: any) => {
        let k = 'Unknown';
        switch (lens) {
          case 'sub_portfolio': k = a.sub_portfolio_name || 'Unassigned'; break;
          case 'asset_type': k = a.asset_type || 'Unknown'; break;
          case 'asset_subtype': k = a.asset_subtype || 'Unknown'; break;
          case 'geography': k = a.geography || 'Unknown'; break;
          case 'size_tag': k = a.size_tag || 'Unknown'; break;
          case 'factor_tag': k = a.factor_tag || 'Unknown'; break;
        }
        if (!groupMap.has(k)) groupMap.set(k, []);
        groupMap.get(k).push(a);
      });
      base = Array.from(groupMap.entries()).filter(([k]) => selectedValues.length === 0 || selectedValues.includes(k)).map(([k, items]) => ({ key: k, data: items }));
    }

    if (aggregate && base.length > 1) {
        const points = base.map(g => {
          const val = g.data.reduce((s: number, i: any) => s + i.current_value, 0);
          const currentPct = data.totalValue > 0 ? (val / data.totalValue) * 100 : 0;
          const targetPct = g.data.reduce((s: number, i: any) => s + (i.implied_overall_target || 0), 0);
          const drift = targetPct > 0 ? ((currentPct - targetPct) / targetPct) * 100 : 0;
          return { ticker: g.key, drift_percentage: drift, current_pct: currentPct, target_pct: targetPct };
        });
        base = [{ key: 'Aggregated Selection', data: points }];
    } else {
        base = base.map(s => ({
          ...s,
          data: s.data.map((a: any) => ({
            ...a,
            drift_percentage: a.drift_percentage
          }))
        }));
    }

    return base.map((s: any) => ({ ...s, data: [...s.data].sort((a,b) => b.drift_percentage - a.drift_percentage) }));
  }, [calculatedData, lens, selectedValues, aggregate, data?.totalValue]);

  const getDriftColor = (drift: number, sliceData: any[]) => {
    const maxAbs = Math.max(...sliceData.map(d => Math.abs(d.drift_percentage)), 1);
    const ratio = Math.abs(drift) / maxAbs;
    if (drift >= 0) {
      if (ratio > 0.8) return '#064e3b'; if (ratio > 0.5) return '#059669'; if (ratio > 0.2) return '#34d399'; return '#bbf7d0';
    } else {
      if (ratio > 0.8) return '#7f1d1d'; if (ratio > 0.5) return '#dc2626'; if (ratio > 0.2) return '#f87171'; return '#fecaca';
    }
  };

  const handleSort = (col: string) => {
    setSortDir(p => (sortCol === col ? (p === 'asc' ? 'desc' : 'asc') : 'desc'));
    setSortCol(col);
  }

  const SortIcon = ({ col }: { col: string }) => (
    <ArrowUpDown className={cn("ml-1 h-3 w-3 inline cursor-pointer", sortCol === col ? "text-blue-600" : "text-zinc-400")} />
  )

  const toggleValue = (v: string) => setSelectedValues(p => p.includes(v) ? p.filter(it => it !== v) : [...p, v])

  if (loading || !calculatedData) return <div className="p-8 text-center text-lg animate-pulse">Calculating rebalancing paths...</div>

  const rebalanceNeeded = calculatedData.allocations.some((a: any) => a.action !== 'hold')
  const actionableAssets = [...(calculatedData.assetLevel || [])]
    .filter((a: any) => a.action !== 'hold')
    .sort((a: any, b: any) => (b.amount || 0) - (a.amount || 0));

  const impliedFlowRows = (() => {
    const metricsByTicker = new Map<string, { current: number; target: number; drift: number }>();
    (calculatedData.assetLevel || []).forEach((asset: any) => {
      metricsByTicker.set(asset.ticker, {
        current: Number(asset.current_overall_pct || 0),
        target: Number(asset.target_overall_pct || 0),
        drift: Number(asset.drift_percentage || 0),
      });
    });

    const flowMap = new Map<string, { from: string; to: string; amount: number; current_pct: number; target_pct: number; drift_pct: number }>();

    calculatedData.allocations.forEach((asset: any) => {
      const sourceTicker = asset.ticker || 'Unknown';
      (asset.reinvestment_suggestions || []).forEach((s: any) => {
        if (s.pair_type !== 'implied' || !s.to_ticker || !s.amount) return;
        const key = `${sourceTicker}->${s.to_ticker}`;
        const destinationMetrics = metricsByTicker.get(s.to_ticker) || { current: 0, target: 0, drift: 0 };
        const current = flowMap.get(key);
        if (!current) {
          flowMap.set(key, {
            from: sourceTicker,
            to: s.to_ticker,
            amount: s.amount,
            current_pct: destinationMetrics.current,
            target_pct: destinationMetrics.target,
            drift_pct: destinationMetrics.drift,
          });
          return;
        }
        current.amount += s.amount;
      });
    });

    return Array.from(flowMap.values()).sort((a, b) => b.amount - a.amount);
  })();

  const getPairingsForAsset = (assetId: string) => {
    return calculatedData.allocations.find((a: any) => a.asset_id === assetId)?.reinvestment_suggestions || [];
  };

  return (
    <div className="space-y-6 p-4 max-w-[1600px] mx-auto overflow-x-hidden">
      <div className="flex justify-end">
        <Button onClick={async () => { setRefreshing(true); await refreshAssetPrices(); fetchData(); setRefreshing(false); }} disabled={refreshing} size="sm" variant="default" className="bg-black text-white hover:bg-zinc-800 flex items-center h-9 px-4 transition-all shadow-black/20 font-bold"><RefreshCw className={cn("w-4 h-4 mr-2", refreshing && "animate-spin")} /> {refreshing ? 'Hold...' : 'Refresh Prices'}</Button>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-4">
        <div className="bg-card p-4 rounded-lg border text-center shadow-sm"><Label className="text-[10px] uppercase font-bold text-muted-foreground">Value</Label><div className="text-xl font-bold font-mono">{formatUSDWhole(data.totalValue)}</div></div>
        <div className="bg-card p-4 rounded-lg border text-center shadow-sm"><Label className="text-[10px] uppercase font-bold text-muted-foreground leading-none">Sub-Portfolio Drift</Label><div className="text-xl font-bold mt-1 font-mono">{calculatedData.totalWeightedSubDrift.toFixed(1)}%</div></div>
        <div className="bg-card p-4 rounded-lg border text-center shadow-sm"><Label className="text-[10px] uppercase font-bold text-muted-foreground leading-none">Asset Drift</Label><div className="text-xl font-bold mt-1 font-mono">{calculatedData.totalWeightedAssetDrift.toFixed(1)}%</div></div>
        <div className="bg-card p-4 rounded-lg border text-center shadow-sm"><Label className="text-[10px] uppercase font-bold text-muted-foreground leading-none">Rebalance Needed</Label><div className={cn("text-xl font-bold flex items-center justify-center mt-1", rebalanceNeeded ? "text-red-600" : "text-green-600")}>{rebalanceNeeded ? "Yes" : "No"}</div></div>
      </div>

      {rebalanceNeeded && (actionableAssets.length > 0 || impliedFlowRows.length > 0) && (
      <div className="bg-card p-4 rounded-xl border shadow-sm">
        <div className="flex items-center justify-between gap-3 mb-3">
          <h3 className="text-sm font-bold uppercase tracking-wide">Recommended Rebalancing Execution</h3>
          <span className="text-xs text-muted-foreground">Asset-level recommendations across sub-portfolios</span>
        </div>
          <div className="space-y-4">
            {actionableAssets.length > 0 && (
            <div className="md:hidden space-y-3">
              <div className="text-xs uppercase tracking-wide text-zinc-500 bg-zinc-50 rounded-md border px-3 py-2 font-semibold">Triggered Actions</div>
              {actionableAssets.map((asset: any) => {
                const pairings = getPairingsForAsset(asset.asset_id);
                return (
                  <div key={`mobile-explicit-${asset.asset_id}`} className="rounded-lg border bg-background p-3 shadow-sm">
                    <div className="flex items-start justify-between gap-2">
                      <div>
                        <div className="font-semibold leading-tight">{asset.ticker}</div>
                        <div className="text-xs text-muted-foreground leading-tight">{asset.name}</div>
                      </div>
                      <span className={cn("text-xs font-bold", asset.action === 'buy' ? "text-green-600" : "text-red-600")}>{asset.action.toUpperCase()}</span>
                    </div>

                    <div className="mt-2 flex items-center justify-between gap-2">
                      <div className="text-sm font-semibold tabular-nums">{formatUSDWhole(asset.amount)}</div>
                      <span
                        className={cn(
                          'inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide',
                          asset.amount_mode === 'Conservative'
                            ? 'bg-amber-100 text-amber-800 border-amber-200'
                            : 'bg-sky-100 text-sky-800 border-sky-200'
                        )}
                      >
                        {asset.amount_mode}
                      </span>
                    </div>

                    <div className="mt-2 grid grid-cols-3 gap-2 text-[11px]">
                      <div className="rounded bg-zinc-50 px-2 py-1 text-center">
                        <div className="text-zinc-500">Current</div>
                        <div className="font-semibold tabular-nums">{asset.current_overall_pct.toFixed(1)}%</div>
                      </div>
                      <div className="rounded bg-zinc-50 px-2 py-1 text-center">
                        <div className="text-zinc-500">Target</div>
                        <div className="font-semibold tabular-nums text-blue-700">{asset.target_overall_pct.toFixed(1)}%</div>
                      </div>
                      <div className="rounded bg-zinc-50 px-2 py-1 text-center">
                        <div className="text-zinc-500">Drift</div>
                        <div className={cn("font-semibold tabular-nums", asset.drift_percentage > 0 ? "text-green-600" : "text-red-600")}>{asset.drift_percentage > 0 ? '+' : ''}{asset.drift_percentage.toFixed(1)}%</div>
                      </div>
                    </div>

                    <details className="mt-2">
                      <summary className="cursor-pointer text-xs font-semibold text-zinc-600">Pairings</summary>
                      <div className="mt-2 space-y-1 text-xs text-blue-700">
                        {pairings.length > 0 ? pairings.slice(0, 4).map((s: any, idx: number) => (
                          <div key={`mobile-pair-${asset.asset_id}-${idx}`} className="flex items-center justify-between gap-2">
                            <span className="truncate">{s.to_ticker ? `To ${s.to_ticker}` : `From ${s.from_ticker}`}</span>
                            <span className="tabular-nums whitespace-nowrap">{formatUSDWhole(s.amount)}</span>
                          </div>
                        )) : <span className="text-muted-foreground">No pairings</span>}
                      </div>
                    </details>
                  </div>
                )
              })}
            </div>
            )}

            {impliedFlowRows.length > 0 && (
              <div className="md:hidden space-y-3">
                <div className="text-xs uppercase tracking-wide text-zinc-500 bg-zinc-50 rounded-md border px-3 py-2 font-semibold">Supporting Flows</div>
                {impliedFlowRows.map((flow, idx) => (
                  <details key={`mobile-implied-${idx}`} className="rounded-lg border bg-background p-3 shadow-sm">
                    <summary className="cursor-pointer list-none">
                      <div className="flex items-center justify-between gap-2">
                        <div className="text-xs text-zinc-500 truncate">{`${flow.from} -> ${flow.to}`}</div>
                        <div className="font-semibold tabular-nums whitespace-nowrap">{formatUSDWhole(flow.amount)}</div>
                      </div>
                    </summary>
                    <div className="mt-2 text-xs text-zinc-600">Funds are routed from above-target assets to below-target assets without pushing either side through target boundaries.</div>
                  </details>
                ))}
              </div>
            )}

            <div className="hidden md:block overflow-x-auto space-y-4">
            {actionableAssets.length > 0 && (
            <Table className="min-w-[860px]">
              <TableHeader>
                <TableRow>
                  <TableHead colSpan={8} className="text-xs uppercase tracking-wide text-zinc-500 bg-zinc-50">Triggered Actions</TableHead>
                </TableRow>
                <TableRow>
                  <TableHead>Asset</TableHead>
                  <TableHead className="text-right">Current %</TableHead>
                  <TableHead className="text-right text-blue-600">Target %</TableHead>
                  <TableHead className="text-right">Drift %</TableHead>
                  <TableHead className="text-center">Action</TableHead>
                  <TableHead className="text-center">Rebalance Mode</TableHead>
                  <TableHead className="text-right">Amount</TableHead>
                  <TableHead>Suggested Pairing</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {actionableAssets.map((asset: any) => {
                  const pairings = getPairingsForAsset(asset.asset_id);
                  return (
                    <TableRow key={asset.asset_id}>
                      <TableCell>
                        <div className="font-semibold">{asset.ticker}</div>
                        <div className="text-xs text-muted-foreground">{asset.name}</div>
                      </TableCell>
                      <TableCell className="text-right tabular-nums">{asset.current_overall_pct.toFixed(1)}%</TableCell>
                      <TableCell className="text-right tabular-nums text-blue-700">{asset.target_overall_pct.toFixed(1)}%</TableCell>
                      <TableCell className={cn("text-right tabular-nums font-semibold", asset.drift_percentage > 0 ? "text-green-600" : "text-red-600")}>{asset.drift_percentage > 0 ? '+' : ''}{asset.drift_percentage.toFixed(1)}%</TableCell>
                      <TableCell className={cn("text-center font-bold", asset.action === 'buy' ? "text-green-600" : "text-red-600")}>{asset.action.toUpperCase()}</TableCell>
                      <TableCell className="text-center">
                        <span
                          className={cn(
                            'inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide',
                            asset.amount_mode === 'Conservative'
                              ? 'bg-amber-100 text-amber-800 border-amber-200'
                              : 'bg-sky-100 text-sky-800 border-sky-200'
                          )}
                        >
                          {asset.amount_mode}
                        </span>
                      </TableCell>
                      <TableCell className="text-right tabular-nums">{formatUSDWhole(asset.amount)}</TableCell>
                      <TableCell className="text-xs text-blue-700">
                        {pairings.length > 0 ? pairings.slice(0, 2).map((s: any, idx: number) => (
                          <div key={`${asset.asset_id}-pair-${idx}`}>
                            {s.to_ticker ? `To ${s.to_ticker}` : `From ${s.from_ticker}`}: {formatUSDWhole(s.amount)}
                          </div>
                        )) : <span className="text-muted-foreground">-</span>}
                      </TableCell>
                    </TableRow>
                  )
                })}
              </TableBody>
            </Table>
            )}

            {impliedFlowRows.length > 0 && (
              <Table className="min-w-[860px]">
                <TableHeader>
                  <TableRow>
                    <TableHead colSpan={6} className="text-xs uppercase tracking-wide text-zinc-500 bg-zinc-50">Supporting Flows</TableHead>
                  </TableRow>
                  <TableRow>
                    <TableHead>From</TableHead>
                    <TableHead>To</TableHead>
                    <TableHead className="text-right">Current %</TableHead>
                    <TableHead className="text-right text-blue-600">Target %</TableHead>
                    <TableHead className="text-right">Drift %</TableHead>
                    <TableHead className="text-right">Amount</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {impliedFlowRows.map((flow, idx) => (
                    <TableRow key={`implied-flow-${idx}`}>
                      <TableCell className="font-semibold">{flow.from}</TableCell>
                      <TableCell className="font-semibold">{flow.to}</TableCell>
                      <TableCell className="text-right tabular-nums">{flow.current_pct.toFixed(1)}%</TableCell>
                      <TableCell className="text-right tabular-nums text-blue-700">{flow.target_pct.toFixed(1)}%</TableCell>
                      <TableCell className={cn("text-right tabular-nums font-semibold", flow.drift_pct > 0 ? "text-green-600" : "text-red-600")}>{flow.drift_pct > 0 ? '+' : ''}{flow.drift_pct.toFixed(1)}%</TableCell>
                      <TableCell className="text-right tabular-nums">{formatUSDWhole(flow.amount)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
            </div>
          </div>
      </div>
      )}

      <div className="flex flex-wrap gap-4 items-end border-b pb-4 bg-muted/10 p-4 rounded-xl">
        <div className="w-56"><Label className="text-[10px] font-bold uppercase mb-1 block">View Lens</Label><Select value={lens} onValueChange={setLens}><SelectTrigger className="bg-background focus:ring-0"><SelectValue/></SelectTrigger><SelectContent>{LENSES.map(l => <SelectItem key={l.value} value={l.value}>{l.label}</SelectItem>)}</SelectContent></Select></div>
        {lens !== 'total' && (<div className="w-64"><Label className="text-[10px] font-bold uppercase mb-1 block">Filter Selection</Label><Popover><PopoverTrigger asChild><Button variant="outline" className="w-full justify-between bg-background">{selectedValues.length} selected <ChevronsUpDown className="w-4 h-4 ml-2 opacity-50" /></Button></PopoverTrigger><PopoverContent className="w-64 p-0"><Command><CommandInput placeholder="Search..." /><CommandList><CommandGroup className="max-h-64 overflow-y-auto">{availableValues.map(v => { const filterValue = lens === 'sub_portfolio' ? (v.label ?? v.value) : v.value; return (<CommandItem key={v.value} onSelect={() => toggleValue(filterValue)}><Check className={cn("w-4 h-4 mr-2", selectedValues.includes(filterValue) ? "opacity-100" : "opacity-0")} />{v.label}</CommandItem>) })}</CommandGroup></CommandList></Command></PopoverContent></Popover></div>)}
        {lens !== 'total' && selectedValues.length > 1 && (<div className="flex items-center gap-2 mb-2 p-2 border rounded-md bg-background"><Switch checked={aggregate} onCheckedChange={setAggregate} id="agg-switch" /><Label htmlFor="agg-switch" className="text-xs cursor-pointer">Aggregate</Label></div>)}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {chartSlices.map((slice, idx) => (
          <div key={idx} className={cn("bg-card p-6 rounded-xl border shadow-sm space-y-4", chartSlices.length === 1 && "lg:col-span-2")}> 
            <h3 className="font-bold text-center border-b pb-2 uppercase tracking-wide text-[10px]">{slice.key} Drift Analysis</h3>
            <div className="h-[380px]"><ResponsiveContainer width="100%" height="100%"><BarChart data={slice.data} layout="vertical" margin={{ left: 10, right: 30 }}><CartesianGrid strokeDasharray="3 3" horizontal={false} /><XAxis type="number" unit="%" fontSize={10} axisLine={false} tickLine={false} /><YAxis dataKey="ticker" type="category" interval={0} fontSize={9} width={40} /><RechartsTooltip formatter={(v:any) => [`${Number(v).toFixed(1)}%`, 'Drift']} /><Bar dataKey="drift_percentage">{slice.data.map((entry: any, i: number) => (<Cell key={i} fill={getDriftColor(entry.drift_percentage, slice.data)} />))}</Bar></BarChart></ResponsiveContainer></div>
          </div>
        ))}
      </div>

      <div className="pt-8 border-t">
        <h2 className="text-xl font-bold mb-6">Asset Allocation Management</h2>
        <Accordion type="multiple" value={openItems} onValueChange={setOpenItems}>
          {calculatedData.subPortfolios.map((sp: any) => {
            const items = calculatedData.allocations.filter((a: any) => a.sub_portfolio_id === sp.id)
            if (items.length === 0) return null
            const totalVal = items.reduce((s:number, i:any) => s+i.current_value, 0); const totalWeight = items.reduce((s:number, i:any) => s+(Number(i.current_in_sp)||0), 0); const totalTarget = items.reduce((s:number, i:any) => s+(Number(i.sub_portfolio_target_percentage)||0), 0); const totalImplied = items.reduce((s:number, i:any) => s+(Number(i.implied_overall_target)||0), 0); 
            const absDriftWtd = totalVal > 0 ? items.reduce((s:number, i:any) => s + (Math.abs(i.drift_percentage) * i.current_value), 0) / totalVal : 0;
            const sortedItems = [...items].sort((a,b) => { const aV = sortCol === 'ticker' ? a.ticker : a[sortCol]; const bV = sortCol === 'ticker' ? b.ticker : b[sortCol]; const res = (aV || 0) < (bV || 0) ? -1 : (aV || 0) > (bV || 0) ? 1 : 0; return sortDir === 'asc' ? res : -res; });
            const hasBreach = items.some((item: any) => item.action !== 'hold');
            const portfolioTotal = data?.totalValue || 0;
            const allocPct = portfolioTotal > 0 ? (totalVal / portfolioTotal) * 100 : 0;
            const targetAllocPct = totalImplied;
            const subDrift = targetAllocPct > 0 ? ((allocPct - targetAllocPct) / targetAllocPct) * 100 : 0;

            return (
              <AccordionItem key={sp.id} value={sp.id} className="border rounded-xl mb-6 overflow-hidden shadow-sm bg-background">
                <AccordionTrigger className="bg-black text-white px-6 hover:bg-zinc-900 transition-all font-bold uppercase hover:no-underline">
                  <div className="flex justify-between w-full mr-6 items-center">
                    <div className="flex flex-1 min-w-0 items-center gap-1">
                        <span>{sp.name}</span>
                        {hasBreach && <AlertTriangle className="w-3 h-3 ml-0.5 flex-shrink-0 text-yellow-400" />}
                    </div>
                    <div className="flex flex-col gap-1.5 sm:flex-row sm:gap-3 text-[10px] sm:text-sm font-mono opacity-90 font-bold sm:items-center items-end">
                      <span>Value: {formatUSDWhole(totalVal)}</span>
                      <span>Alloc: {allocPct.toFixed(1)}%</span>
                      <span className="text-blue-200">Target: {targetAllocPct.toFixed(1)}%</span>
                      <span className={cn(subDrift > 0 ? "text-green-400" : (subDrift < 0 ? "text-red-400" : ""))}>
                        Drift: {subDrift.toFixed(1)}%
                      </span>
                    </div>
                  </div>
                </AccordionTrigger>
                <AccordionContent className="p-0 bg-background">
                    <div className="grid grid-cols-1 sm:grid-cols-4 gap-6 p-4 bg-zinc-50 border-b">
                        <div className="space-y-1"><Label className="text-[10px] font-bold uppercase text-zinc-500">Sub-Portfolio Target %</Label><Input defaultValue={sp.target_allocation} type="number" min="0" max="100" step="0.01" onBlur={(e) => {
                          const parsed = parsePercentWithTwoDecimals(e.target.value)
                          if (parsed === null) {
                            alert('Target percentage must be between 0 and 100 with up to 2 decimal places.')
                            return
                          }
                          updateSubPortfolio(sp.id, 'target_allocation', parsed)
                        }} className="h-8 max-w-[150px] bg-white border-zinc-300"/></div>
                        <div className="space-y-1"><Label className="text-[10px] font-bold uppercase text-zinc-500">Upside Threshold %</Label><Input defaultValue={sp.upside_threshold || 5} type="number" step="1" onBlur={(e) => updateSubPortfolio(sp.id, 'upside_threshold', parseFloat(e.target.value))} className="h-8 max-w-[150px] bg-white border-zinc-300"/></div>
                        <div className="space-y-1"><Label className="text-[10px] font-bold uppercase text-zinc-500">Downside Threshold %</Label><Input defaultValue={sp.downside_threshold || 5} type="number" step="1" onBlur={(e) => updateSubPortfolio(sp.id, 'downside_threshold', parseFloat(e.target.value))} className="h-8 max-w-[150px] bg-white border-zinc-300"/></div>
                        <div className="flex items-center gap-3 pt-4 sm:pt-0"><Switch id={`band-mode-${sp.id}`} checked={sp.band_mode} onCheckedChange={(checked) => updateSubPortfolio(sp.id, 'band_mode', checked ? 1 : 0)} /><Label htmlFor={`band-mode-${sp.id}`} className="text-xs font-medium cursor-pointer">{sp.band_mode ? 'Conservative' : 'Absolute'} Mode</Label></div>
                    </div>
                    <div className="md:hidden p-3 space-y-3 bg-zinc-50 border-b">
                      {sortedItems.map((i: any) => (
                        <div key={`mobile-${i.asset_id}`} className="rounded-lg border bg-background p-3 shadow-sm">
                          <div className="min-w-0">
                            <div className="font-semibold leading-tight truncate">{i.ticker}</div>
                            <div className="text-xs text-muted-foreground truncate">{i.name}</div>
                          </div>

                          <div className="mt-2 grid grid-cols-2 gap-2 text-[11px]">
                            <div className="rounded bg-zinc-50 px-2 py-1"><span className="text-zinc-500">Amount</span><div className="font-semibold tabular-nums">{formatUSDWhole(i.amount)}</div></div>
                            <div className="rounded bg-zinc-50 px-2 py-1"><span className="text-zinc-500">Port Drift</span><div className={cn("font-semibold tabular-nums", i.drift_percentage > 0.1 ? "text-green-600" : (i.drift_percentage < -0.1 ? "text-red-500" : "text-black"))}>{i.drift_percentage > 0 ? '+' : ''}{i.drift_percentage.toFixed(1)}%</div></div>
                            <div className="rounded bg-zinc-50 px-2 py-1"><span className="text-zinc-500">Sub-Portfolio Weight</span><div className="font-semibold tabular-nums">{Number(i.current_in_sp || 0).toFixed(1)}%</div></div>
                            <div className="rounded bg-zinc-50 px-2 py-1">
                              <span className="text-zinc-500">Target Sub-Portfolio Weight</span>
                              <Input
                                defaultValue={i.sub_portfolio_target_percentage}
                                type="number"
                                min="0"
                                max="100"
                                step="0.01"
                                onBlur={(e) => {
                                  const parsed = parsePercentWithTwoDecimals(e.target.value)
                                  if (parsed === null) {
                                    alert('Target percentage must be between 0 and 100 with up to 2 decimal places.')
                                    return
                                  }
                                  updateAssetTarget(i.asset_id, sp.id, parsed)
                                }}
                                className="mt-1 h-8 text-right w-full border-zinc-200 bg-zinc-50/50 focus:ring-0"
                              />
                            </div>
                            <div className="rounded bg-zinc-50 px-2 py-1"><span className="text-zinc-500">Overall Target</span><div className="font-semibold tabular-nums text-blue-700">{Number(i.implied_overall_target || 0).toFixed(1)}%</div></div>
                            <div className="rounded bg-zinc-50 px-2 py-1"><span className="text-zinc-500">Overall Wt.</span><div className="font-semibold tabular-nums">{Number(i.current_percentage || 0).toFixed(1)}%</div></div>
                          </div>

                          <details className="mt-2">
                            <summary className="cursor-pointer text-xs font-semibold text-zinc-600">Details</summary>
                            <div className="mt-2 space-y-1 text-xs text-blue-700">
                              {i.action === 'sell' && i.recommended_accounts?.length ? i.recommended_accounts.map((s: any, idx: number) => (
                                <div key={`mobile-sell-${i.asset_id}-${idx}`}>Sell from {s.name}: {formatUSDWhole(s.amount)}</div>
                              )) : null}
                              {i.reinvestment_suggestions?.length ? i.reinvestment_suggestions.map((s: any, idx: number) => {
                                const accountLabel = s.account_name ? ` (${s.account_name}${s.tax_status ? `, ${s.tax_status}` : ''})` : ''
                                const label = s.from_ticker ? `Fund via ${s.from_ticker} sale${accountLabel}` : s.to_ticker ? `Use Funds to Buy ${s.to_ticker}` : 'Suggested'
                                const badgeText = s.pair_type === 'explicit' ? 'Explicit' : 'Implied'
                                const badgeClass = s.pair_type === 'explicit'
                                  ? 'bg-emerald-100 text-emerald-700 border-emerald-200'
                                  : 'bg-amber-100 text-amber-700 border-amber-200'
                                return (
                                  <div key={`mobile-re-${i.asset_id}-${idx}`} className="flex items-center justify-between gap-2">
                                    <span className={cn('inline-flex items-center rounded-full border px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide', badgeClass)}>{badgeText}</span>
                                    <span className="text-right">{label}: {formatUSDWhole(s.amount)}</span>
                                  </div>
                                )
                              }) : null}
                              {!(i.action === 'sell' && i.recommended_accounts?.length) && !i.reinvestment_suggestions?.length ? <span className="text-muted-foreground">No suggestions</span> : null}
                            </div>
                          </details>
                        </div>
                      ))}
                    </div>

                    <div className="hidden md:block overflow-x-auto w-full overscroll-x-contain [-webkit-overflow-scrolling:touch]">
                      <Table className="w-full min-w-[1100px] table-fixed border-collapse">
                        <colgroup>
                          <col className="w-[14%]" />
                          <col className="w-[9%]" />
                          <col className="w-[11%]" />
                          <col className="w-[9%]" />
                          <col className="w-[11%]" />
                          <col className="w-[10%]" />
                          <col className="w-[8%]" />
                          <col className="w-[8%]" />
                          <col className="w-[8%]" />
                          <col className="w-[12%]" />
                        </colgroup>
                        <TableHeader className="bg-muted/30">
                          <TableRow>
                            <TableHead className="px-3 sm:px-4">
                              <button type="button" className="flex w-full items-center gap-2 text-left" onClick={() => handleSort('ticker')}>
                                <span className="truncate">Ticker</span>
                                <SortIcon col="ticker" />
                              </button>
                            </TableHead>
                            <TableHead className="px-3 sm:px-4 text-right">
                              <button type="button" className="ml-auto flex w-full items-center justify-end gap-2 text-right whitespace-normal leading-tight" onClick={() => handleSort('quantity')}>
                                Qty
                                <SortIcon col="quantity" />
                              </button>
                            </TableHead>
                            <TableHead className="px-3 sm:px-4 text-right">
                              <button type="button" className="ml-auto flex w-full items-center justify-end gap-2 text-right whitespace-normal leading-tight" onClick={() => handleSort('current_value')}>
                                Val ($)
                                <SortIcon col="current_value" />
                              </button>
                            </TableHead>
                            <TableHead className="px-3 sm:px-4 text-right text-blue-600 font-bold">
                              <button type="button" className="ml-auto flex w-full items-center justify-end gap-2 text-right whitespace-normal leading-tight" onClick={() => handleSort('sub_portfolio_target_percentage')}>
                                Target Sub-Portfolio Weight
                                <SortIcon col="sub_portfolio_target_percentage" />
                              </button>
                            </TableHead>
                            <TableHead className="px-3 sm:px-4 text-right">
                              <button type="button" className="ml-auto flex w-full items-center justify-end gap-2 text-right whitespace-normal leading-tight" onClick={() => handleSort('current_in_sp')}>
                                Sub-Portfolio Weight
                                <SortIcon col="current_in_sp" />
                              </button>
                            </TableHead>
                            <TableHead className="px-3 sm:px-4 text-right">
                              <button type="button" className="ml-auto flex w-full items-center justify-end gap-2 text-right whitespace-normal leading-tight" onClick={() => handleSort('implied_overall_target')}>
                                Overall Target Weight
                                <SortIcon col="implied_overall_target" />
                              </button>
                            </TableHead>
                            <TableHead className="px-3 sm:px-4 text-right">
                              <button type="button" className="ml-auto flex w-full items-center justify-end gap-2 text-right whitespace-normal leading-tight" onClick={() => handleSort('current_percentage')}>
                                Overall Weight
                                <SortIcon col="current_percentage" />
                              </button>
                            </TableHead>
                            <TableHead className="px-3 sm:px-4 text-right">
                              <button type="button" className="ml-auto flex w-full items-center justify-end gap-2 text-right whitespace-normal leading-tight" onClick={() => handleSort('drift_percentage')}>
                                Port Drift %
                                <SortIcon col="drift_percentage" />
                              </button>
                            </TableHead>
                            <TableHead className="px-3 sm:px-4 text-center whitespace-nowrap">Action</TableHead>
                            <TableHead className="px-3 sm:px-4 text-right whitespace-nowrap">Suggest.</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {sortedItems.map((i: any) => (
                            <TableRow key={i.asset_id} className="hover:bg-muted/5 h-16 group">
                              <TableCell className="px-3 sm:px-4 font-bold border-l-2 border-transparent group-hover:border-zinc-300 align-top">
                                <div className="truncate">{i.ticker}</div>
                                <div className="text-[10px] opacity-70 truncate">{i.name}</div>
                              </TableCell>
                              <TableCell className="px-3 sm:px-4 text-right tabular-nums whitespace-nowrap">{Number(i.quantity || 0).toLocaleString(undefined, { maximumFractionDigits: 2 })}</TableCell>
                              <TableCell className="px-3 sm:px-4 text-right tabular-nums whitespace-nowrap">{formatUSDWhole(i.current_value)}</TableCell>
                              <TableCell className="px-3 sm:px-4 text-right">
                                <Input
                                  defaultValue={i.sub_portfolio_target_percentage}
                                  type="number"
                                  min="0"
                                  max="100"
                                  step="0.01"
                                  onBlur={(e) => {
                                    const parsed = parsePercentWithTwoDecimals(e.target.value)
                                    if (parsed === null) {
                                      alert('Target percentage must be between 0 and 100 with up to 2 decimal places.')
                                      return
                                    }
                                    updateAssetTarget(i.asset_id, sp.id, parsed)
                                  }}
                                  className="h-8 text-right w-20 ml-auto border-zinc-200 bg-zinc-50/50 focus:ring-0"
                                />
                              </TableCell>
                              <TableCell className="px-3 sm:px-4 text-right tabular-nums whitespace-nowrap">{i.current_in_sp.toFixed(1)}%</TableCell>
                              <TableCell className="px-3 sm:px-4 text-right tabular-nums whitespace-nowrap">{i.implied_overall_target.toFixed(1)}%</TableCell>
                              <TableCell className="px-3 sm:px-4 text-right tabular-nums whitespace-nowrap">{Number(i.current_percentage || 0).toFixed(1)}%</TableCell>
                              <TableCell className={cn("px-3 sm:px-4 text-right tabular-nums font-bold whitespace-nowrap", i.drift_percentage > 0.1 ? "text-green-600" : (i.drift_percentage < -0.1 ? "text-red-500" : "text-black"))}>{i.drift_percentage > 0 ? "+" : ""}{i.drift_percentage.toFixed(1)}%</TableCell>
                              <TableCell className="px-3 sm:px-4 text-center font-bold whitespace-nowrap">
                                {i.action === 'hold' ? (
                                  <span className="text-zinc-300">-</span>
                                ) : (
                                  <div className="flex flex-col">
                                    <span className={cn(i.action === 'buy' ? "text-green-600" : "text-red-600")}>{i.action.toUpperCase()}</span>
                                    <span className="text-[12px] font-medium">{formatUSDWhole(i.amount)}</span>
                                  </div>
                                )}
                              </TableCell>
                              <TableCell className="px-3 sm:px-4 text-right text-[12px] italic text-zinc-600 whitespace-normal break-words">
                                {(() => {
                                  const lines: any[] = []
                                  if (i.action === 'sell' && i.recommended_accounts?.length) {
                                    i.recommended_accounts.forEach((s: any, idx: number) => {
                                      lines.push(<div key={`sell-${idx}`} className="text-blue-700">Sell from {s.name}: {formatUSDWhole(s.amount)}</div>)
                                    })
                                  }
                                  if (i.reinvestment_suggestions?.length) {
                                    i.reinvestment_suggestions.forEach((s: any, idx: number) => {
                                      const accountLabel = s.account_name ? ` (${s.account_name}${s.tax_status ? `, ${s.tax_status}` : ''})` : ''
                                      const label = s.from_ticker ? `Fund via ${s.from_ticker} sale${accountLabel}` : s.to_ticker ? `Use Funds to Buy ${s.to_ticker}` : 'Suggested'
                                      const badgeText = s.pair_type === 'explicit' ? 'Explicit' : 'Implied'
                                      const badgeClass = s.pair_type === 'explicit'
                                        ? 'bg-emerald-100 text-emerald-700 border-emerald-200'
                                        : 'bg-amber-100 text-amber-700 border-amber-200'
                                      lines.push(
                                        <div key={`re-${idx}`} className="text-blue-700 flex items-center justify-end gap-1.5">
                                          <span className={cn('inline-flex items-center rounded-full border px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide', badgeClass)}>{badgeText}</span>
                                          <span>{label}: {formatUSDWhole(s.amount)}</span>
                                        </div>
                                      )
                                    })
                                  }
                                  return lines.length ? lines : <span className="opacity-40">-</span>
                                })()}
                              </TableCell>
                            </TableRow>
                          ))}
                          <TableRow className="bg-zinc-900 text-white font-bold h-12 shadow-inner">
                            <TableCell className="px-3 sm:px-4 uppercase tracking-tighter text-white">Total</TableCell>
                            <TableCell className="px-3 sm:px-4 text-right tabular-nums text-white">-</TableCell>
                            <TableCell className="px-3 sm:px-4 text-right tabular-nums text-white">{formatUSDWhole(totalVal)}</TableCell>
                            <TableCell className="px-3 sm:px-4 text-right tabular-nums text-white">{totalTarget.toFixed(1)}%</TableCell>
                            <TableCell className="px-3 sm:px-4 text-right tabular-nums text-white">{totalWeight.toFixed(1)}%</TableCell>
                            <TableCell className="px-3 sm:px-4 text-right tabular-nums text-white">{totalImplied.toFixed(1)}%</TableCell>
                            <TableCell className="px-3 sm:px-4 text-right tabular-nums text-white">{allocPct.toFixed(1)}%</TableCell>
                            <TableCell className="px-3 sm:px-4 text-right tabular-nums text-white">{absDriftWtd.toFixed(1)}%</TableCell>
                            <TableCell className="px-3 sm:px-4 text-center text-white">N/A</TableCell>
                            <TableCell className="px-3 sm:px-4 text-right opacity-60 text-white">N/A</TableCell>
                          </TableRow>
                        </TableBody>
                      </Table>
                    </div>
                </AccordionContent>
              </AccordionItem>
            )
          })}
        </Accordion>
      </div>
    </div>
  )
}
