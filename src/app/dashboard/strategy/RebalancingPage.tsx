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
import { Check, ChevronsUpDown, ArrowUpDown, RefreshCw, ChevronDown } from 'lucide-react'
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

const getLensDriftTitle = (lens: string) => {
  if (lens === 'total') return 'Asset'
  const lensLabel = LENSES.find((item) => item.value === lens)?.label || 'Selection'
  return lensLabel.replace(/\s+/g, '-')
}

const formatUSDWhole = (value: number | null | undefined) => {
  const num = Math.round(Number(value) || 0)
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(num)
}

const formatPctTenth = (value: number | null | undefined) => `${(Number(value) || 0).toFixed(1)}%`

const parsePercentWithTwoDecimals = (rawValue: string): number | null => {
  const trimmed = rawValue.trim()
  if (trimmed === '') return null
  const parsed = Number(trimmed)
  if (!Number.isFinite(parsed) || parsed < 0 || parsed > 100) return null
  const scaled = parsed * 100
  if (Math.abs(scaled - Math.round(scaled)) > 1e-9) return null
  return Math.round(scaled) / 100
}

const normalizeBandMode = (value: unknown, fallback = false): boolean => {
  if (typeof value === 'boolean') return value
  if (value === 1 || value === '1' || value === 'true') return true
  if (value === 0 || value === '0' || value === 'false') return false
  return fallback
}

const getAssetModeKey = (assetId: string, subPortfolioId: string) => `${subPortfolioId}:${assetId}`

const MetricChip = ({ label, value, valueClassName }: { label: string; value: string; valueClassName?: string }) => (
  <div className="rounded border border-zinc-300 bg-white px-2 py-1 text-center">
    <div className="text-zinc-500">{label}</div>
    <div className={cn('font-semibold tabular-nums', valueClassName)}>{value}</div>
  </div>
)

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
  const [overrideAssetModes, setOverrideAssetModes] = useState<Record<string, boolean>>({})

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
    } catch (err) {
      console.error('Save failed:', err)
    }
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
    } catch (err) {
      console.error(err)
    }
  }

  const updateAssetMode = async (assetId: string, spId: string, checked: boolean, targetPct?: number) => {
    const modeKey = getAssetModeKey(assetId, spId)
    const previousMode = overrideAssetModes[modeKey]
    const previousModeFromData = (data?.currentAllocations || []).find(
      (allocation: any) => allocation.asset_id === assetId && allocation.sub_portfolio_id === spId
    )?.asset_band_mode

    setOverrideAssetModes(prev => ({ ...prev, [modeKey]: checked }))
    setData((prev: any) => {
      if (!prev?.currentAllocations) return prev

      return {
        ...prev,
        currentAllocations: prev.currentAllocations.map((allocation: any) => (
          allocation.asset_id === assetId && allocation.sub_portfolio_id === spId
            ? { ...allocation, asset_band_mode: checked, band_mode_override: checked }
            : allocation
        )),
      }
    })

    try {
      const res = await fetch('/api/rebalancing/asset-mode', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          asset_id: assetId,
          sub_portfolio_id: spId,
          band_mode: checked,
          target_percentage: targetPct,
        }),
      })

      if (!res.ok) throw new Error(await res.text())
    } catch (err) {
      console.error('Save failed:', err)
      setData((prev: any) => {
        if (!prev?.currentAllocations) return prev

        return {
          ...prev,
          currentAllocations: prev.currentAllocations.map((allocation: any) => (
            allocation.asset_id === assetId && allocation.sub_portfolio_id === spId
              ? { ...allocation, asset_band_mode: previousModeFromData, band_mode_override: previousModeFromData }
              : allocation
          )),
        }
      })
      setOverrideAssetModes(prev => {
        if (previousMode === undefined) {
          const next = { ...prev }
          delete next[modeKey]
          return next
        }

        return { ...prev, [modeKey]: previousMode }
      })
      return
    }
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
      const rawAssetBandMode = a.asset_band_mode ?? a.band_mode_override;
      const assetModeKey = getAssetModeKey(a.asset_id, a.sub_portfolio_id)
      const assetBandMode = overrideAssetModes[assetModeKey]
        ?? normalizeBandMode(rawAssetBandMode, !!sp?.band_mode);
      const groupVal = subIdValues[a.sub_portfolio_id] || 0;
      const impliedOverallTarget = ((sp?.target_allocation || 0) * targetInGroup) / 100;
      const currentInSPPct = groupVal > 0 ? (a.current_value / groupVal) * 100 : 0;
      const driftInSP = targetInGroup > 0 ? ((currentInSPPct - targetInGroup) / targetInGroup) * 100 : 0;

      return {
        ...a,
        sub_portfolio_target_percentage: targetInGroup,
        asset_band_mode: assetBandMode,
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
      const effectiveBandMode = !!row.asset_band_mode;
      const res = calculatePortfolioAssetAction({
        currentValue: row.current_value,
        totalPortfolioValue: data.totalValue,
        targetOverallPct: row.implied_overall_target || 0,
        upsideThreshold: Math.abs(sp?.upside_threshold ?? 5),
        downsideThreshold: Math.abs(sp?.downside_threshold ?? 5),
        bandMode: effectiveBandMode,
      });

      portfolioAssetActions.set(row.asset_id, {
        asset_id: row.asset_id,
        sub_portfolio_id: row.sub_portfolio_id,
        ticker: row.ticker,
        name: row.name,
        current_value: row.current_value,
        sub_portfolio_target_percentage: row.sub_portfolio_target_percentage,
        target_overall_pct: row.implied_overall_target || 0,
        amount_mode: effectiveBandMode ? 'Conservative' : 'Absolute',
        band_mode: effectiveBandMode,
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
    const reinvestmentByAsset: Record<string, any[]> = {};

    const assetActionList = Array.from(portfolioAssetActions.values());
    assetActionList.forEach((asset: any) => {
      const targetValue = (data.totalValue * (asset.target_overall_pct || 0)) / 100;
      const excessToTarget = Math.max(0, asset.current_value - targetValue);
      const deficitToTarget = Math.max(0, targetValue - asset.current_value);

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
          // Prioritize assets furthest above target by relative drift percentage.
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
          // Prioritize assets furthest below target by relative drift percentage.
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
  }, [data, overrideSubSettings, overrideAssetTargets, overrideAssetModes]);

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

  useEffect(() => {
    const handleBannerRefresh = (event: Event) => {
      const detail = (event as CustomEvent<{ register?: (promise: Promise<unknown>) => void }>).detail
      detail?.register?.((async () => {
        setRefreshing(true)
        await refreshAssetPrices()
        await fetchData()
        setRefreshing(false)
      })())
    }

    window.addEventListener('dashboard:portfolio-refresh', handleBannerRefresh)
    return () => window.removeEventListener('dashboard:portfolio-refresh', handleBannerRefresh)
  }, [])

  if (loading || !calculatedData) return <div className="rounded-[26px] border border-zinc-200/80 bg-white px-6 py-12 text-center text-lg shadow-sm animate-pulse">Calculating rebalancing paths...</div>

  const rebalanceNeeded = calculatedData.allocations.some((a: any) => a.action !== 'hold')
  const subPortfolioCurrentValues = calculatedData.allocations.reduce((acc: Record<string, number>, item: any) => {
    const subPortfolioId = item.sub_portfolio_id
    acc[subPortfolioId] = (acc[subPortfolioId] || 0) + Number(item.current_value || 0)
    return acc
  }, {})
  const actionableAssets = [...(calculatedData.assetLevel || [])]
    .filter((a: any) => a.action !== 'hold')
    .sort((a: any, b: any) => (b.amount || 0) - (a.amount || 0));

  const assetByTicker = new Map<string, any>()
  ;(calculatedData.assetLevel || []).forEach((asset: any) => {
    assetByTicker.set(asset.ticker, asset)
  })

  const allAccountCandidates = (() => {
    const accountTotals = new Map<string, { name: string; tax_status: string; total: number }>()
    const accountHoldings = data?.accountHoldings || {}

    Object.values(accountHoldings).forEach((positions: any) => {
      (positions || []).forEach((h: any) => {
        if (!h?.account_id) return
        const existing = accountTotals.get(h.account_id)
        if (!existing) {
          accountTotals.set(h.account_id, {
            name: h.name || 'Unknown',
            tax_status: h.tax_status || 'Unknown',
            total: Number(h.value || 0),
          })
          return
        }
        existing.total += Number(h.value || 0)
      })
    })

    return Array.from(accountTotals.values()).sort((a, b) => {
      const aTax = a.tax_status === 'Taxable' ? 1 : 0
      const bTax = b.tax_status === 'Taxable' ? 1 : 0
      if (aTax !== bTax) return aTax - bTax
      return b.total - a.total
    })
  })()

  const buildTaxRecommendation = (asset: any, action: 'buy' | 'sell', amount: number) => {
    const accountHoldings = data?.accountHoldings || {}
    const holdings = [...(accountHoldings[asset.asset_id] || [])].sort((a: any, b: any) => {
      const aTax = a.tax_status === 'Taxable' ? 1 : 0
      const bTax = b.tax_status === 'Taxable' ? 1 : 0
      if (aTax !== bTax) return aTax - bTax
      return Number(b.value || 0) - Number(a.value || 0)
    })

    const guidance = action === 'sell'
      ? 'Trim tax-advantaged lots first to defer taxable gains.'
      : 'Prefer tax-advantaged accounts for new buys; use taxable last.'

    if (!holdings.length) {
      const fallback = allAccountCandidates.slice(0, 2)
      if (!fallback.length) {
        return {
          guidance,
          lines: ['Use tax-advantaged accounts before taxable brokerage when possible.'],
        }
      }
      return {
        guidance,
        lines: fallback.map((acc) => `${acc.name} (${acc.tax_status})`),
      }
    }

    let remaining = amount
    const lines: string[] = []
    holdings.forEach((h: any) => {
      if (remaining <= 0) return
      const cap = Number(h.value || 0)
      const take = cap > 0 ? Math.min(cap, remaining) : remaining
      if (take <= 0) return
      lines.push(`${h.name} (${h.tax_status || 'Unknown'}): ${formatUSDWhole(take)}`)
      remaining -= take
    })

    if (!lines.length) lines.push('Use tax-advantaged accounts before taxable brokerage when possible.')

    return { guidance, lines }
  }

  const rebalancingPlanRows = (() => {
    const planByTicker = new Map<string, { ticker: string; buyAmount: number; sellAmount: number; types: Set<string> }>()
    const actionableTickerSet = new Set((actionableAssets || []).map((asset: any) => asset.ticker))

    calculatedData.allocations.forEach((asset: any) => {
      const sourceTicker = asset.ticker || 'Unknown'
      ;(asset.reinvestment_suggestions || []).forEach((s: any) => {
        if (!s.to_ticker || !s.amount) return
        const amount = Number(s.amount || 0)
        if (amount <= 0) return

        const source = planByTicker.get(sourceTicker) || { ticker: sourceTicker, buyAmount: 0, sellAmount: 0, types: new Set<string>() }
        source.sellAmount += amount
        source.types.add(s.pair_type === 'explicit' ? 'Explicit' : 'Implied')
        planByTicker.set(sourceTicker, source)

        const destination = planByTicker.get(s.to_ticker) || { ticker: s.to_ticker, buyAmount: 0, sellAmount: 0, types: new Set<string>() }
        destination.buyAmount += amount
        destination.types.add(s.pair_type === 'explicit' ? 'Explicit' : 'Implied')
        planByTicker.set(s.to_ticker, destination)
      })
    })

    actionableAssets.forEach((asset: any) => {
      const row = planByTicker.get(asset.ticker) || { ticker: asset.ticker, buyAmount: 0, sellAmount: 0, types: new Set<string>() }
      if (asset.action === 'buy') row.buyAmount = Math.max(row.buyAmount, Number(asset.amount || 0))
      if (asset.action === 'sell') row.sellAmount = Math.max(row.sellAmount, Number(asset.amount || 0))
      row.types.add('Explicit')
      planByTicker.set(asset.ticker, row)
    })

    const rows = Array.from(planByTicker.values()).map((row) => {
      const net = row.buyAmount - row.sellAmount
      const action: 'buy' | 'sell' = net >= 0 ? 'buy' : 'sell'
      const amount = Math.abs(net)
      const metrics = assetByTicker.get(row.ticker) || {
        asset_id: null,
        current_overall_pct: 0,
        target_overall_pct: 0,
        drift_percentage: 0,
        name: row.ticker,
        amount_mode: 'Absolute',
        band_mode: false,
      }
      const recommendation = buildTaxRecommendation(metrics, action, amount)

      return {
        assetId: metrics.asset_id,
        subPortfolioId: metrics.sub_portfolio_id,
        subPortfolioTargetPct: Number(metrics.sub_portfolio_target_percentage || 0),
        ticker: row.ticker,
        name: metrics.name || row.ticker,
        action,
        amount,
        type: actionableTickerSet.has(row.ticker) ? 'Out-of-Band Asset' : 'Supporting Transaction',
        rebalanceMode: metrics.amount_mode || 'Absolute',
        bandMode: !!metrics.band_mode,
        currentPct: Number(metrics.current_overall_pct || 0),
        targetPct: Number(metrics.target_overall_pct || 0),
        driftPct: Number(metrics.drift_percentage || 0),
        accountGuidance: recommendation.guidance,
        accountLines: recommendation.lines,
      }
    })

    return rows.filter((r) => r.amount > 0).sort((a, b) => b.amount - a.amount)
  })()

  const outOfBandPlanRows = rebalancingPlanRows.filter((row: any) => row.type === 'Out-of-Band Asset')
  const supportingPlanRows = rebalancingPlanRows.filter((row: any) => row.type === 'Supporting Transaction')
  const summarizePlanRows = (rows: any[]) => rows.reduce((acc, row) => {
    if (row.action === 'buy') acc.grossBuy += Number(row.amount || 0)
    if (row.action === 'sell') acc.grossSell += Number(row.amount || 0)
    acc.netFlow += row.action === 'buy' ? Number(row.amount || 0) : -Number(row.amount || 0)
    return acc
  }, { grossBuy: 0, grossSell: 0, netFlow: 0 })

  const outOfBandSummary = summarizePlanRows(outOfBandPlanRows)
  const supportingSummary = summarizePlanRows(supportingPlanRows)

  return (
    <div className="flex flex-col gap-6 overflow-x-hidden">
      <div className={cn('order-1 grid gap-6 md:grid-cols-3', chartSlices.length === 1 ? 'md:items-stretch' : 'md:items-start')}>
        <details
          open
          className={cn(
            'group overflow-hidden rounded-[26px] border border-zinc-200/80 bg-white shadow-[0_20px_70px_-36px_rgba(15,23,42,0.35)] md:col-span-1',
            chartSlices.length === 1 && 'md:flex md:h-full md:flex-col'
          )}
        >
          <summary className="dashboard-section-header">
            <span className="dashboard-section-header-title">Key KPIs</span>
            <span className="dashboard-section-header-meta">
              <span className="hidden sm:inline">Expand / Collapse</span>
              <ChevronDown className="h-4 w-4 transition-transform group-open:rotate-180" />
            </span>
          </summary>
          <div className={cn('flex flex-col px-4 pb-4 pt-4 sm:px-6 sm:pb-6', chartSlices.length === 1 && 'md:flex-1 md:min-h-0')}>
            <div className="flex flex-col gap-4 md:grid md:h-full md:min-h-0 md:flex-1 md:grid-cols-1 md:grid-rows-4 md:gap-4">
              <div className="dashboard-metric-tile md:h-full">
                <Label className="dashboard-metric-label">Value</Label>
                <div className="dashboard-metric-value">{formatUSDWhole(data.totalValue)}</div>
              </div>
              <div className="dashboard-metric-tile md:h-full">
                <Label className="dashboard-metric-label">Sub-Portfolio Drift</Label>
                <div className="dashboard-metric-value">{calculatedData.totalWeightedSubDrift.toFixed(1)}%</div>
              </div>
              <div className="dashboard-metric-tile md:h-full">
                <Label className="dashboard-metric-label">Asset Drift</Label>
                <div className="dashboard-metric-value">{calculatedData.totalWeightedAssetDrift.toFixed(1)}%</div>
              </div>
              <div className="dashboard-metric-tile md:h-full">
                <Label className="dashboard-metric-label">Rebalance Needed</Label>
                <div className={cn('dashboard-metric-value', rebalanceNeeded ? 'text-red-600' : 'text-green-600')}>{rebalanceNeeded ? 'Yes' : 'No'}</div>
              </div>
            </div>
          </div>
        </details>

        <details open className="group overflow-hidden rounded-[26px] border border-zinc-200/80 bg-white shadow-[0_20px_70px_-36px_rgba(15,23,42,0.35)] md:col-span-2">
          <summary className="dashboard-section-header">
              <span className="dashboard-section-header-title">Portfolio Drift Chart</span>
              <span className="dashboard-section-header-meta">
              <span className="hidden sm:inline">Expand / Collapse</span>
              <ChevronDown className="h-4 w-4 transition-transform group-open:rotate-180" />
            </span>
          </summary>
          <div className="px-4 pb-4 pt-4 sm:px-6 sm:pb-6">
      <div className="mb-6 flex flex-col items-start gap-3 md:flex-row md:items-end md:gap-4">
        <div className="w-full max-w-xs md:w-56 md:max-w-none">
          <Label className="text-[10px] font-bold uppercase mb-1 block text-left">View Lens</Label>
          <Select value={lens} onValueChange={setLens}>
            <SelectTrigger className="bg-background focus:ring-0"><SelectValue/></SelectTrigger>
            <SelectContent>{LENSES.map(l => <SelectItem key={l.value} value={l.value}>{l.label}</SelectItem>)}</SelectContent>
          </Select>
        </div>
        {lens !== 'total' && (
          <div className="w-full max-w-sm md:w-64 md:max-w-none">
            <Label className="text-[10px] font-bold uppercase mb-1 block text-left">Filter Selection</Label>
            <Popover>
              <PopoverTrigger asChild>
                <Button variant="outline" className="w-full justify-between bg-background">{selectedValues.length} selected <ChevronsUpDown className="w-4 h-4 ml-2 opacity-50" /></Button>
              </PopoverTrigger>
              <PopoverContent className="w-64 p-0">
                <Command>
                  <CommandInput placeholder="Search..." />
                  <CommandList>
                    <CommandGroup className="max-h-64 overflow-y-auto">
                      {availableValues.map(v => {
                        const filterValue = lens === 'sub_portfolio' ? (v.label ?? v.value) : v.value
                        return (
                          <CommandItem key={v.value} onSelect={() => toggleValue(filterValue)}>
                            <Check className={cn("w-4 h-4 mr-2", selectedValues.includes(filterValue) ? "opacity-100" : "opacity-0")} />
                            {v.label}
                          </CommandItem>
                        )
                      })}
                    </CommandGroup>
                  </CommandList>
                </Command>
              </PopoverContent>
            </Popover>
          </div>
        )}
        {lens !== 'total' && selectedValues.length > 1 && (
          <div className="flex items-center gap-2 rounded-md border bg-background p-2">
            <Switch checked={aggregate} onCheckedChange={setAggregate} id="agg-switch" />
            <Label htmlFor="agg-switch" className="text-xs cursor-pointer">Aggregate</Label>
          </div>
        )}
      </div>
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {chartSlices.map((slice, idx) => (
          <div key={idx} className={cn("dashboard-chart-panel space-y-4 p-6", chartSlices.length === 1 && "lg:col-span-2")}> 
            <h3 className="dashboard-contrast-pill bg-zinc-950 text-center">{lens === 'total' ? getLensDriftTitle(lens) : aggregate && slice.key === 'Aggregated Selection' ? getLensDriftTitle(lens) : slice.key} Drift Analysis</h3>
            <div className="h-[380px]"><ResponsiveContainer width="100%" height="100%"><BarChart data={slice.data} layout="vertical" margin={{ left: 10, right: 30 }}><CartesianGrid strokeDasharray="3 3" horizontal={false} /><XAxis type="number" unit="%" fontSize={10} axisLine={false} tickLine={false} /><YAxis dataKey="ticker" type="category" interval={0} fontSize={9} width={40} /><RechartsTooltip formatter={(v:any) => [`${Number(v).toFixed(1)}%`, 'Drift']} /><Bar dataKey="drift_percentage">{slice.data.map((entry: any, i: number) => (<Cell key={i} fill={getDriftColor(entry.drift_percentage, slice.data)} />))}</Bar></BarChart></ResponsiveContainer></div>
          </div>
        ))}
      </div>
      </div>
        </details>
      </div>

      <details className="order-2 group overflow-hidden rounded-[26px] border border-zinc-200/80 bg-white shadow-[0_20px_70px_-36px_rgba(15,23,42,0.35)]">
        <summary className="dashboard-section-header">
          <span className="dashboard-section-header-title">Allocation Strategy</span>
          <span className="dashboard-section-header-meta">
            <span className="hidden sm:inline">Expand / Collapse</span>
            <ChevronDown className="h-4 w-4 transition-transform group-open:rotate-180" />
          </span>
        </summary>
        <div className="px-4 pb-4 pt-4 sm:px-6 sm:pb-6">
        <Accordion type="multiple" value={openItems} onValueChange={setOpenItems}>
          {[...calculatedData.subPortfolios]
            .sort((a: any, b: any) => (subPortfolioCurrentValues[b.id] || 0) - (subPortfolioCurrentValues[a.id] || 0))
            .map((sp: any) => {
            const items = calculatedData.allocations.filter((a: any) => a.sub_portfolio_id === sp.id)
            if (items.length === 0) return null
            const totalVal = items.reduce((s:number, i:any) => s+i.current_value, 0); const totalWeight = items.reduce((s:number, i:any) => s+(Number(i.current_in_sp)||0), 0); const totalTarget = items.reduce((s:number, i:any) => s+(Number(i.sub_portfolio_target_percentage)||0), 0); const totalImplied = items.reduce((s:number, i:any) => s+(Number(i.implied_overall_target)||0), 0); 
            const absDriftWtd = totalVal > 0 ? items.reduce((s:number, i:any) => s + (Math.abs(i.drift_percentage) * i.current_value), 0) / totalVal : 0;
            const totalActionAmount = items.reduce((s:number, i:any) => s + (i.action !== 'hold' ? Number(i.amount || 0) : 0), 0);
            const sortedItems = [...items].sort((a,b) => { const aV = sortCol === 'ticker' ? a.ticker : a[sortCol]; const bV = sortCol === 'ticker' ? b.ticker : b[sortCol]; const res = (aV || 0) < (bV || 0) ? -1 : (aV || 0) > (bV || 0) ? 1 : 0; return sortDir === 'asc' ? res : -res; });
            const portfolioTotal = data?.totalValue || 0;
            const allocPct = portfolioTotal > 0 ? (totalVal / portfolioTotal) * 100 : 0;
            const targetAllocPct = totalImplied;
            const subDrift = targetAllocPct > 0 ? ((allocPct - targetAllocPct) / targetAllocPct) * 100 : 0;

            return (
              <AccordionItem key={sp.id} value={sp.id} className="border rounded-xl mb-6 overflow-hidden shadow-sm bg-background">
                <AccordionTrigger className="dashboard-contrast-header px-4 sm:px-6 font-bold hover:no-underline">
                  <div className="w-full pr-2 sm:pr-6">
                    <div className="flex items-center justify-between gap-3 sm:hidden">
                      <div className="w-1/2 min-w-0">
                        <span className="block text-sm font-semibold uppercase tracking-wide leading-tight break-words">{sp.name}</span>
                      </div>
                      <div className="w-1/2 text-right">
                        <span className="block text-sm font-semibold font-mono leading-tight">{formatUSDWhole(totalVal)}</span>
                      </div>
                    </div>
                    <div className="hidden sm:flex items-center justify-between gap-4 text-sm font-mono whitespace-nowrap">
                      <span className="truncate text-sm font-semibold uppercase tracking-wide">{sp.name}</span>
                      <div className="flex items-center gap-3">
                        <span className="text-white">Value: {formatUSDWhole(totalVal)}</span>
                        <span className="text-blue-200">Target: {formatPctTenth(targetAllocPct)}</span>
                        <span className="text-zinc-200">Actual: {formatPctTenth(allocPct)}</span>
                        <span className={cn(subDrift > 0 ? "text-green-400" : (subDrift < 0 ? "text-red-400" : "text-zinc-300"))}>
                          Drift: {subDrift > 0 ? '+' : ''}{formatPctTenth(subDrift)}
                        </span>
                      </div>
                    </div>
                  </div>
                </AccordionTrigger>
                <AccordionContent className="p-0 bg-background">
                    <div className="md:hidden border-b bg-zinc-50/70 p-3">
                      <div className="grid grid-cols-2 gap-3 items-stretch">
                        <div className="dashboard-mobile-subpanel dashboard-mobile-subpanel-input grid grid-rows-[auto_repeat(3,minmax(0,1fr))] gap-2">
                          <div className="flex justify-center">
                            <div className="dashboard-mobile-subpanel-title dashboard-mobile-subpanel-title-input">Inputs</div>
                          </div>
                          <div className="dashboard-mobile-subpanel-cell-input text-center">
                            <div className="text-zinc-600 text-center leading-tight">Sub-Portfolio Target %</div>
                            <Input aria-label={`Sub-portfolio target for ${sp.name}`} defaultValue={sp.target_allocation} type="number" min="0" max="100" step="0.01" onBlur={(e) => {
                              const parsed = parsePercentWithTwoDecimals(e.target.value)
                              if (parsed === null) {
                                alert('Target percentage must be between 0 and 100 with up to 2 decimal places.')
                                return
                              }
                              updateSubPortfolio(sp.id, 'target_allocation', parsed)
                            }} className="mt-1 h-8 w-full border-amber-300 bg-amber-50 text-center focus-visible:ring-amber-300"/>
                          </div>
                          <div className="dashboard-mobile-subpanel-cell-input text-center">
                            <div className="text-zinc-600 text-center leading-tight">Upside Threshold</div>
                            <Input aria-label={`Upside threshold for ${sp.name}`} defaultValue={sp.upside_threshold || 5} type="number" step="1" onBlur={(e) => updateSubPortfolio(sp.id, 'upside_threshold', parseFloat(e.target.value))} className="mt-1 h-8 w-full border-amber-300 bg-amber-50 text-center focus-visible:ring-amber-300"/>
                          </div>
                          <div className="dashboard-mobile-subpanel-cell-input text-center">
                            <div className="text-zinc-600 text-center leading-tight">Downside Threshold</div>
                            <Input aria-label={`Downside threshold for ${sp.name}`} defaultValue={sp.downside_threshold || 5} type="number" step="1" onBlur={(e) => updateSubPortfolio(sp.id, 'downside_threshold', parseFloat(e.target.value))} className="mt-1 h-8 w-full border-amber-300 bg-amber-50 text-center focus-visible:ring-amber-300"/>
                          </div>
                        </div>
                        <div className="dashboard-mobile-subpanel dashboard-mobile-subpanel-summary grid grid-rows-[auto_repeat(3,minmax(0,1fr))] gap-2">
                          <div className="flex justify-center">
                            <div className="dashboard-mobile-subpanel-title dashboard-mobile-subpanel-title-summary">Summary</div>
                          </div>
                          <div className="dashboard-mobile-subpanel-cell row-start-2 flex h-full flex-col items-center justify-center text-center">
                            <div className="text-zinc-500">Actual Weight</div>
                            <div className="mt-1 font-semibold tabular-nums text-zinc-900">{formatPctTenth(allocPct)}</div>
                          </div>
                          <div className="dashboard-mobile-subpanel-cell row-start-3 row-span-2 flex h-full flex-col items-center justify-center text-center">
                            <div className="text-zinc-500">Drift</div>
                            <div className={cn('mt-2 font-semibold tabular-nums', subDrift > 0 ? 'text-green-600' : (subDrift < 0 ? 'text-red-600' : 'text-zinc-700'))}>{subDrift > 0 ? '+' : ''}{formatPctTenth(subDrift)}</div>
                          </div>
                        </div>
                      </div>
                    </div>
                    <div className="hidden md:block border-b bg-zinc-50/80 p-4">
                        <div className="dashboard-mobile-subpanel dashboard-mobile-subpanel-input">
                        <div className="grid grid-cols-1 gap-3 sm:grid-cols-[auto_repeat(3,minmax(0,1fr))] sm:items-end sm:gap-4">
                        <div className="flex justify-center sm:justify-start sm:pb-1">
                          <div className="dashboard-mobile-subpanel-title dashboard-mobile-subpanel-title-input">Inputs</div>
                        </div>
                        <div className="space-y-1 text-center"><Label className="block text-center text-[10px] font-bold uppercase text-zinc-500">Sub-Portfolio Target %</Label><Input aria-label={`Sub-portfolio target for ${sp.name}`} defaultValue={sp.target_allocation} type="number" min="0" max="100" step="0.01" onBlur={(e) => {
                          const parsed = parsePercentWithTwoDecimals(e.target.value)
                          if (parsed === null) {
                            alert('Target percentage must be between 0 and 100 with up to 2 decimal places.')
                            return
                          }
                          updateSubPortfolio(sp.id, 'target_allocation', parsed)
                        }} className="h-8 w-full border-amber-300 bg-amber-50 text-center focus-visible:ring-amber-300"/></div>
                        <div className="space-y-1 text-center"><Label className="block text-center text-[10px] font-bold uppercase text-zinc-500">Upside Threshold</Label><Input aria-label={`Upside threshold for ${sp.name}`} defaultValue={sp.upside_threshold || 5} type="number" step="1" onBlur={(e) => updateSubPortfolio(sp.id, 'upside_threshold', parseFloat(e.target.value))} className="h-8 w-full border-amber-300 bg-amber-50 text-center focus-visible:ring-amber-300"/></div>
                        <div className="space-y-1 text-center"><Label className="block text-center text-[10px] font-bold uppercase text-zinc-500">Downside Threshold</Label><Input aria-label={`Downside threshold for ${sp.name}`} defaultValue={sp.downside_threshold || 5} type="number" step="1" onBlur={(e) => updateSubPortfolio(sp.id, 'downside_threshold', parseFloat(e.target.value))} className="h-8 w-full border-amber-300 bg-amber-50 text-center focus-visible:ring-amber-300"/></div>
                        </div>
                        </div>
                    </div>
                    <div className="md:hidden p-3 space-y-3 bg-zinc-50 border-b">
                      {sortedItems.map((i: any) => (
                        <div key={`mobile-${i.asset_id}`} className="dashboard-mobile-card space-y-4">
                          <div className="grid grid-cols-2 gap-x-3 gap-y-1 min-w-0">
                            <div className="min-w-0 break-words text-base font-semibold leading-tight text-zinc-950 [overflow-wrap:anywhere]">{i.ticker}</div>
                            <div className="min-w-0 break-words text-right text-base font-semibold leading-tight tabular-nums text-zinc-950 [overflow-wrap:anywhere]">{formatUSDWhole(i.current_value)}</div>
                            <div className="min-w-0 break-words text-xs italic leading-tight text-zinc-500 [overflow-wrap:anywhere]">{i.name}</div>
                            <div className="min-w-0 break-words text-right text-xs italic leading-tight [overflow-wrap:anywhere]">
                              <span className={cn("font-semibold uppercase tracking-wide", i.action === 'buy' ? 'text-green-600' : i.action === 'sell' ? 'text-red-600' : 'text-zinc-500')}>
                                {i.action === 'hold' ? 'Hold' : i.action.toUpperCase()}
                              </span>
                              <span className="mx-1 text-zinc-400">/</span>
                              <span className="font-semibold tabular-nums text-zinc-900">{i.action === 'hold' ? '-' : formatUSDWhole(i.amount)}</span>
                            </div>
                          </div>

                          <div className="mt-2 grid grid-cols-2 gap-3">
                            <div className="rounded-xl border border-amber-200 bg-amber-50/85 p-3 text-center">
                              <p className="dashboard-metric-label">Sub-Portfolio Target</p>
                              <Input
                                aria-label={`Sub-portfolio target for ${i.ticker}`}
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
                                className="mt-2 h-9 w-full border-amber-300 bg-amber-50 text-center font-semibold tabular-nums text-sm focus-visible:ring-amber-300"
                              />
                            </div>
                            <div className="p-1 text-center">
                              <p className="dashboard-metric-label">Sub-Portfolio Weight</p>
                              <p className="mt-2 text-sm font-semibold text-zinc-900 tabular-nums">{formatPctTenth(Number(i.current_in_sp || 0))}</p>
                            </div>
                            <div className="p-1 text-center">
                              <p className="dashboard-metric-label">Target</p>
                              <p className="mt-2 text-sm font-semibold text-blue-700 tabular-nums">{formatPctTenth(Number(i.implied_overall_target || 0))}</p>
                            </div>
                            <div className="p-1 text-center">
                              <p className="dashboard-metric-label">Current</p>
                              <p className="mt-2 text-sm font-semibold text-zinc-900 tabular-nums">{formatPctTenth(Number(i.current_percentage || 0))}</p>
                            </div>
                            <div className="p-1 text-center">
                              <p className="dashboard-metric-label">Drift</p>
                              <p className={cn("mt-2 text-sm font-semibold tabular-nums", i.drift_percentage > 0 ? "text-green-600" : (i.drift_percentage < 0 ? "text-red-600" : "text-zinc-700"))}>{i.drift_percentage > 0 ? '+' : ''}{formatPctTenth(i.drift_percentage)}</p>
                            </div>
                            <div className="p-1 text-center">
                              <p className="dashboard-metric-label">Rebalance Mode</p>
                              <div className="mt-2 flex items-center justify-center gap-2">
                                <span className={cn('text-[9px] uppercase tracking-wide', !i.asset_band_mode ? 'text-zinc-900 font-semibold' : 'text-zinc-400')}>Abs</span>
                                <Switch
                                  id={`mobile-asset-mode-${i.asset_id}`}
                                  checked={!!i.asset_band_mode}
                                  aria-label={`Set rebalance mode for ${i.ticker}`}
                                  onCheckedChange={(checked) => updateAssetMode(i.asset_id, sp.id, checked, Number(i.sub_portfolio_target_percentage || 0))}
                                />
                                <span className={cn('text-[9px] uppercase tracking-wide', i.asset_band_mode ? 'text-zinc-900 font-semibold' : 'text-zinc-400')}>Cons</span>
                              </div>
                            </div>
                          </div>
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
                          <col className="w-[10%]" />
                          <col className="w-[8%]" />
                          <col className="w-[8%]" />
                        </colgroup>
                        <TableHeader
                          className="sticky z-10 bg-muted/90 backdrop-blur shadow-sm"
                          style={{ top: 'calc(var(--app-header-height, 0px) + env(safe-area-inset-top))' }}
                        >
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
                            <TableHead className="px-3 sm:px-4 text-center whitespace-nowrap">Rebalance Mode</TableHead>
                            <TableHead className="px-3 sm:px-4 text-center whitespace-nowrap">Action</TableHead>
                            <TableHead className="px-3 sm:px-4 text-right whitespace-nowrap">Amount</TableHead>
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
                                  aria-label={`Sub-portfolio target for ${i.ticker}`}
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
                                  className="h-8 text-right w-20 ml-auto border-amber-300 bg-amber-50/70 focus:ring-0"
                                />
                              </TableCell>
                              <TableCell className="px-3 sm:px-4 text-right tabular-nums whitespace-nowrap">{i.current_in_sp.toFixed(1)}%</TableCell>
                              <TableCell className="px-3 sm:px-4 text-right tabular-nums whitespace-nowrap">{i.implied_overall_target.toFixed(1)}%</TableCell>
                              <TableCell className="px-3 sm:px-4 text-right tabular-nums whitespace-nowrap">{Number(i.current_percentage || 0).toFixed(1)}%</TableCell>
                              <TableCell className={cn("px-3 sm:px-4 text-right tabular-nums font-bold whitespace-nowrap", i.drift_percentage > 0.1 ? "text-green-600" : (i.drift_percentage < -0.1 ? "text-red-500" : "text-black"))}>{i.drift_percentage > 0 ? "+" : ""}{i.drift_percentage.toFixed(1)}%</TableCell>
                              <TableCell className="px-3 sm:px-4 text-center whitespace-nowrap overflow-hidden">
                                <div className="inline-flex max-w-full items-center justify-center gap-1 rounded border border-zinc-200 bg-zinc-50 px-2 py-1 overflow-hidden">
                                  <span className={cn('text-[9px] uppercase tracking-wide', !i.asset_band_mode ? 'text-zinc-900 font-semibold' : 'text-zinc-400')}>Abs</span>
                                  <Switch
                                    id={`desktop-asset-mode-${i.asset_id}`}
                                    checked={!!i.asset_band_mode}
                                    aria-label={`Set rebalance mode for ${i.ticker}`}
                                    onCheckedChange={(checked) => updateAssetMode(i.asset_id, sp.id, checked, Number(i.sub_portfolio_target_percentage || 0))}
                                  />
                                  <span className={cn('text-[9px] uppercase tracking-wide', i.asset_band_mode ? 'text-zinc-900 font-semibold' : 'text-zinc-400')}>Cons</span>
                                </div>
                              </TableCell>
                              <TableCell className="px-3 sm:px-4 text-center font-bold whitespace-nowrap">
                                {i.action === 'hold' ? (
                                  <span className="text-zinc-300">-</span>
                                ) : (
                                  <span className={cn(i.action === 'buy' ? "text-green-600" : "text-red-600")}>{i.action.toUpperCase()}</span>
                                )}
                              </TableCell>
                              <TableCell className="px-3 sm:px-4 text-right tabular-nums whitespace-nowrap">
                                {i.action === 'hold' ? '-' : formatUSDWhole(i.amount)}
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
                            <TableCell className="px-3 sm:px-4 text-center text-white text-xs">Mixed</TableCell>
                            <TableCell className="px-3 sm:px-4 text-center text-white">N/A</TableCell>
                            <TableCell className="px-3 sm:px-4 text-right tabular-nums text-white">{formatUSDWhole(totalActionAmount)}</TableCell>
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
      </details>

      <details className="order-3 group overflow-hidden rounded-[26px] border border-zinc-200/80 bg-white shadow-[0_20px_70px_-36px_rgba(15,23,42,0.35)]">
      <summary className="dashboard-section-header">
        <span className="dashboard-section-header-title">Rebalancing Recommendations</span>
        <span className="dashboard-section-header-meta">
          <span className="hidden sm:inline">Expand / Collapse</span>
          <ChevronDown className="h-4 w-4 transition-transform group-open:rotate-180" />
        </span>
      </summary>
      <div className="px-4 pb-4 pt-4 sm:px-6 sm:pb-6">
      {rebalanceNeeded && rebalancingPlanRows.length > 0 ? (
      <div className="dashboard-chart-panel p-4">
          <div className="space-y-4">
            {rebalancingPlanRows.length > 0 && (
              <div className="md:hidden space-y-3">
                {outOfBandPlanRows.length > 0 && (
                  <div className="space-y-2">
                    <div className="rounded-lg border-2 border-zinc-300 bg-zinc-100/80 p-2">
                      <div className="dashboard-contrast-pill bg-zinc-950 px-2 py-1 text-[11px]">Out-of-Band Assets</div>
                      <div className="mt-2 grid grid-cols-3 gap-2 text-[10px]">
                        <MetricChip label="Gross Buy" value={formatUSDWhole(outOfBandSummary.grossBuy)} valueClassName="text-green-700" />
                        <MetricChip label="Gross Sell" value={formatUSDWhole(outOfBandSummary.grossSell)} valueClassName="text-red-700" />
                        <MetricChip label="Net Flow" value={formatUSDWhole(outOfBandSummary.netFlow)} valueClassName={outOfBandSummary.netFlow >= 0 ? 'text-green-700' : 'text-red-700'} />
                      </div>
                    </div>
                    {outOfBandPlanRows.map((row, idx) => (
                  <div key={`mobile-plan-out-${idx}`} className="dashboard-mobile-card space-y-4">
                    <div className="flex items-start justify-between gap-2">
                      <div>
                        <div className="font-semibold leading-tight">{row.ticker}</div>
                        <div className="text-xs text-muted-foreground leading-tight">{row.name}</div>
                      </div>
                      <div className="text-right">
                        <span className={cn("block text-xs font-bold", row.action === 'buy' ? "text-green-600" : "text-red-600")}>{row.action.toUpperCase()}</span>
                        <div className="mt-0.5 text-sm font-semibold tabular-nums">{formatUSDWhole(row.amount)}</div>
                      </div>
                    </div>

                    <div className="mt-2 flex items-center justify-between gap-2 text-sm">
                      <div className="flex max-w-full items-center gap-1 rounded border border-zinc-200 bg-zinc-50 px-2 py-1 overflow-hidden">
                        <span className={cn('text-[9px] uppercase tracking-wide', !row.bandMode ? 'text-zinc-900 font-semibold' : 'text-zinc-400')}>Abs</span>
                        <Switch
                          id={`mobile-plan-mode-out-${idx}`}
                          checked={row.bandMode}
                          aria-label={`Set rebalance mode for ${row.ticker}`}
                          onCheckedChange={(checked) => row.assetId && row.subPortfolioId && updateAssetMode(row.assetId, row.subPortfolioId, checked, row.subPortfolioTargetPct)}
                          disabled={!row.assetId || !row.subPortfolioId}
                        />
                        <span className={cn('text-[9px] uppercase tracking-wide', row.bandMode ? 'text-zinc-900 font-semibold' : 'text-zinc-400')}>Cons</span>
                      </div>
                    </div>

                    <div className="mt-2 grid grid-cols-3 gap-2 text-[11px]">
                      <MetricChip label="Target" value={formatPctTenth(row.targetPct)} valueClassName="text-blue-700" />
                      <MetricChip label="Current" value={formatPctTenth(row.currentPct)} />
                      <MetricChip label="Drift" value={`${row.driftPct > 0 ? '+' : ''}${formatPctTenth(row.driftPct)}`} valueClassName={row.driftPct > 0 ? 'text-green-600' : 'text-red-600'} />
                    </div>

                  </div>
                    ))}
                  </div>
                )}
                {supportingPlanRows.length > 0 && (
                  <div className="space-y-2">
                    <div className="rounded-lg border-2 border-zinc-300 bg-zinc-100/80 p-2">
                      <div className="dashboard-contrast-pill bg-zinc-950 px-2 py-1 text-[11px]">Supporting Transactions</div>
                      <div className="mt-2 grid grid-cols-3 gap-2 text-[10px]">
                        <MetricChip label="Gross Buy" value={formatUSDWhole(supportingSummary.grossBuy)} valueClassName="text-green-700" />
                        <MetricChip label="Gross Sell" value={formatUSDWhole(supportingSummary.grossSell)} valueClassName="text-red-700" />
                        <MetricChip label="Net Flow" value={formatUSDWhole(supportingSummary.netFlow)} valueClassName={supportingSummary.netFlow >= 0 ? 'text-green-700' : 'text-red-700'} />
                      </div>
                    </div>
                    {supportingPlanRows.map((row, idx) => (
                  <div key={`mobile-plan-${idx}`} className="dashboard-mobile-card space-y-4">
                    <div className="flex items-start justify-between gap-2">
                      <div>
                        <div className="font-semibold leading-tight">{row.ticker}</div>
                        <div className="text-xs text-muted-foreground leading-tight">{row.name}</div>
                      </div>
                      <div className="text-right">
                        <span className={cn("block text-xs font-bold", row.action === 'buy' ? "text-green-600" : "text-red-600")}>{row.action.toUpperCase()}</span>
                        <div className="mt-0.5 text-sm font-semibold tabular-nums">{formatUSDWhole(row.amount)}</div>
                      </div>
                    </div>

                    <div className="mt-2 flex items-center justify-between gap-2 text-sm">
                      <span className="text-[10px] uppercase tracking-wide text-zinc-400">Mode: N/A</span>
                    </div>

                    <div className="mt-2 grid grid-cols-3 gap-2 text-[11px]">
                      <MetricChip label="Target" value={formatPctTenth(row.targetPct)} valueClassName="text-blue-700" />
                      <MetricChip label="Current" value={formatPctTenth(row.currentPct)} />
                      <MetricChip label="Drift" value={`${row.driftPct > 0 ? '+' : ''}${formatPctTenth(row.driftPct)}`} valueClassName={row.driftPct > 0 ? 'text-green-600' : 'text-red-600'} />
                    </div>

                  </div>
                    ))}
                  </div>
                )}
              </div>
            )}

            <div className="hidden md:block overflow-x-auto space-y-4">
            {rebalancingPlanRows.length > 0 && (
              <Table className="w-full min-w-[980px] table-fixed">
                <colgroup>
                  <col className="w-[14%]" />
                  <col className="w-[9%]" />
                  <col className="w-[11%]" />
                  <col className="w-[8%]" />
                  <col className="w-[8%]" />
                  <col className="w-[8%]" />
                  <col className="w-[10%]" />
                  <col className="w-[10%]" />
                  <col className="w-[22%]" />
                </colgroup>
                <TableHeader
                  className="sticky z-10 bg-background shadow-sm"
                  style={{ top: 'calc(var(--app-header-height, 0px) + env(safe-area-inset-top))' }}
                >
                  <TableRow>
                    <TableHead>Asset</TableHead>
                    <TableHead className="text-center">Transaction</TableHead>
                    <TableHead>Type</TableHead>
                    <TableHead className="text-right text-blue-600">Target %</TableHead>
                    <TableHead className="text-right">Current %</TableHead>
                    <TableHead className="text-right">Drift %</TableHead>
                    <TableHead className="text-center">Rebalance Mode</TableHead>
                    <TableHead className="text-right">Amount</TableHead>
                    <TableHead className="whitespace-normal leading-tight">Account / Tax Consideration</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {outOfBandPlanRows.length > 0 && (
                    <TableRow>
                      <TableCell colSpan={9} className="bg-zinc-950 px-3 py-2">
                        <div className="flex items-center justify-between gap-3">
                          <span className="text-xs font-semibold uppercase tracking-wide text-white">Out-of-Band Assets</span>
                          <div className="flex items-center gap-4 text-xs font-semibold uppercase tracking-wide">
                            <span className="text-zinc-300">Gross Buy <span className="font-semibold tabular-nums text-green-300">{formatUSDWhole(outOfBandSummary.grossBuy)}</span></span>
                            <span className="text-zinc-300">Gross Sell <span className="font-semibold tabular-nums text-red-300">{formatUSDWhole(outOfBandSummary.grossSell)}</span></span>
                            <span className="text-zinc-300">Net Flow <span className={cn("font-semibold tabular-nums", outOfBandSummary.netFlow >= 0 ? "text-green-300" : "text-red-300")}>{formatUSDWhole(outOfBandSummary.netFlow)}</span></span>
                          </div>
                        </div>
                      </TableCell>
                    </TableRow>
                  )}
                  {outOfBandPlanRows.map((row, idx) => (
                    <TableRow key={`plan-out-row-${idx}`}>
                      <TableCell>
                        <div className="font-semibold">{row.ticker}</div>
                        <div className="text-xs text-muted-foreground">{row.name}</div>
                      </TableCell>
                      <TableCell className={cn("text-center font-bold", row.action === 'buy' ? "text-green-600" : "text-red-600")}>{row.action.toUpperCase()}</TableCell>
                      <TableCell className="text-xs tracking-wide text-zinc-500">{row.type}</TableCell>
                      <TableCell className="text-right tabular-nums text-blue-700">{row.targetPct.toFixed(1)}%</TableCell>
                      <TableCell className="text-right tabular-nums">{row.currentPct.toFixed(1)}%</TableCell>
                      <TableCell className={cn("text-right tabular-nums font-semibold", row.driftPct > 0 ? "text-green-600" : "text-red-600")}>{row.driftPct > 0 ? '+' : ''}{row.driftPct.toFixed(1)}%</TableCell>
                      <TableCell className="text-center text-xs whitespace-nowrap overflow-hidden">
                        <div className="mx-auto inline-flex max-w-full items-center justify-center gap-1 rounded border border-zinc-200 bg-zinc-50 px-2 py-1 overflow-hidden">
                          <span className={cn('text-[9px] uppercase tracking-wide', !row.bandMode ? 'text-zinc-900 font-semibold' : 'text-zinc-400')}>Abs</span>
                          <Switch
                            id={`desktop-plan-mode-out-${idx}`}
                            checked={row.bandMode}
                            aria-label={`Set rebalance mode for ${row.ticker}`}
                            onCheckedChange={(checked) => row.assetId && row.subPortfolioId && updateAssetMode(row.assetId, row.subPortfolioId, checked, row.subPortfolioTargetPct)}
                            disabled={!row.assetId || !row.subPortfolioId}
                          />
                          <span className={cn('text-[9px] uppercase tracking-wide', row.bandMode ? 'text-zinc-900 font-semibold' : 'text-zinc-400')}>Cons</span>
                        </div>
                      </TableCell>
                      <TableCell className="text-right tabular-nums">{formatUSDWhole(row.amount)}</TableCell>
                      <TableCell className="text-xs text-zinc-700 whitespace-normal break-words leading-snug align-top">
                        <div className="font-medium text-zinc-800">{row.accountGuidance}</div>
                        {row.accountLines.map((line: string, lineIdx: number) => (
                          <div key={`plan-out-line-${idx}-${lineIdx}`}>{line}</div>
                        ))}
                      </TableCell>
                    </TableRow>
                  ))}
                  {supportingPlanRows.length > 0 && (
                    <TableRow>
                      <TableCell colSpan={9} className="bg-zinc-950 px-3 py-2">
                        <div className="flex items-center justify-between gap-3">
                          <span className="text-xs font-semibold uppercase tracking-wide text-white">Supporting Transactions</span>
                          <div className="flex items-center gap-4 text-xs font-semibold uppercase tracking-wide">
                            <span className="text-zinc-300">Gross Buy <span className="font-semibold tabular-nums text-green-300">{formatUSDWhole(supportingSummary.grossBuy)}</span></span>
                            <span className="text-zinc-300">Gross Sell <span className="font-semibold tabular-nums text-red-300">{formatUSDWhole(supportingSummary.grossSell)}</span></span>
                            <span className="text-zinc-300">Net Flow <span className={cn("font-semibold tabular-nums", supportingSummary.netFlow >= 0 ? "text-green-300" : "text-red-300")}>{formatUSDWhole(supportingSummary.netFlow)}</span></span>
                          </div>
                        </div>
                      </TableCell>
                    </TableRow>
                  )}
                  {supportingPlanRows.map((row, idx) => (
                    <TableRow key={`plan-sup-row-${idx}`}>
                      <TableCell>
                        <div className="font-semibold">{row.ticker}</div>
                        <div className="text-xs text-muted-foreground">{row.name}</div>
                      </TableCell>
                      <TableCell className={cn("text-center font-bold", row.action === 'buy' ? "text-green-600" : "text-red-600")}>{row.action.toUpperCase()}</TableCell>
                      <TableCell className="text-xs tracking-wide text-zinc-500">{row.type}</TableCell>
                      <TableCell className="text-right tabular-nums text-blue-700">{row.targetPct.toFixed(1)}%</TableCell>
                      <TableCell className="text-right tabular-nums">{row.currentPct.toFixed(1)}%</TableCell>
                      <TableCell className={cn("text-right tabular-nums font-semibold", row.driftPct > 0 ? "text-green-600" : "text-red-600")}>{row.driftPct > 0 ? '+' : ''}{row.driftPct.toFixed(1)}%</TableCell>
                      <TableCell className="text-center text-xs text-zinc-400">N/A</TableCell>
                      <TableCell className="text-right tabular-nums">{formatUSDWhole(row.amount)}</TableCell>
                      <TableCell className="text-xs text-zinc-700 whitespace-normal break-words leading-snug align-top">
                        <div className="font-medium text-zinc-800">{row.accountGuidance}</div>
                        {row.accountLines.map((line: string, lineIdx: number) => (
                          <div key={`plan-sup-line-${idx}-${lineIdx}`}>{line}</div>
                        ))}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
            </div>
          </div>
      </div>
      ) : (
        <div className="dashboard-mobile-card text-sm text-muted-foreground">No rebalancing recommendations right now. Current allocations are within your configured thresholds.</div>
      )}
      </div>
      </details>
    </div>
  )
}
