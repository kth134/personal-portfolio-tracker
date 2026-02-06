'use client'

import { useState, useEffect, useMemo } from 'react'
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, ResponsiveContainer, Tooltip as RechartsTooltip, Cell,
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
import { Check, ChevronsUpDown, ArrowUpDown, RefreshCw } from 'lucide-react'
import { formatUSD } from '@/lib/formatters'
import { cn } from '@/lib/utils'
import { calculateRebalanceActions } from '@/lib/rebalancing-logic'
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

export default function RebalancingPage() {
  const [lens, setLens] = useState('total')
  const [availableValues, setAvailableValues] = useState<{value: string, label: string}[]>([])
  const [selectedValues, setSelectedValues] = useState<string[]>([])
  const [aggregate, setAggregate] = useState(false)
  const [data, setData] = useState<any>(null)
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [openItems, setOpenItems] = useState<string[]>([])
  
  const [sortCol, setSortCol] = useState('drift_percentage')
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc')

  const [overrideAssetTargets, setOverrideAssetTargets] = useState<Record<string, number>>({})

  const fetchData = async () => {
    setLoading(true)
    try {
      const res = await fetch('/api/rebalancing', { cache: 'no-store' })
      const payload = await res.json()
      setData(payload)
      if (payload.subPortfolios) {
        setOpenItems(payload.subPortfolios.map((p: any) => p.id))
      }
    } catch (err) { console.error('Fetch error:', err) } finally { setLoading(false) }
  }

  useEffect(() => { fetchData() }, [])

  useEffect(() => {
    if (lens === 'total') { setAvailableValues([]); setSelectedValues([]); return; }
    const fetchVals = async () => {
      try {
        const res = await fetch('/api/dashboard/values', { method: 'POST', body: JSON.stringify({ lens }) })
        const payload = await res.json()
        setAvailableValues(payload.values || [])
        setSelectedValues((payload.values || []).map((v: any) => v.value))
      } catch (err) { console.error('Values fetch error:', err) }
    }
    fetchVals()
  }, [lens])

  const calculatedData = useMemo(() => {
    if (!data) return null;
    const subIdValues: Record<string, number> = allocations.reduce((acc: any, item: any) => {
      acc[item.sub_portfolio_id] = (acc[item.sub_portfolio_id] || 0) + item.current_value;
      return acc;
    }, {});

    const allocationsFinal = data.currentAllocations.map((a: any) => {
      const sp = data.subPortfolios.find((p: any) => p.id === a.sub_portfolio_id);
      const targetInGroup = overrideAssetTargets[a.asset_id] ?? a.sub_portfolio_target_percentage;
      const groupVal = subIdValues[a.sub_portfolio_id] || 0;
      
      const res = calculateRebalanceActions({
        currentValue: a.current_value,
        actualGroupValue: groupVal,
        totalPortfolioValue: data.totalValue,
        targetInGroup,
        groupTargetRatio: sp?.target_allocation || 0,
        upsideThreshold: sp?.upside_threshold,
        downsideThreshold: sp?.downside_threshold,
        bandMode: sp?.band_mode
      });
      return { ...a, sub_portfolio_target_percentage: targetInGroup, implied_overall_target: res.impliedOverallTarget, current_in_sp: res.currentInGroupPct, drift_percentage: res.driftPercentage, action: res.action, amount: res.amount };
    });

    const totalWeightedAssetDrift = allocationsFinal.reduce((sum: number, item: any) => {
      const weight = item.current_value / data.totalValue;
      return sum + (Math.abs(item.drift_percentage) * weight);
    }, 0);

    const totalWeightedSubDrift = data.subPortfolios.reduce((sum: number, sp: any) => {
      const val = subIdValues[sp.id] || 0;
      const weight = val / data.totalValue;
      const currentPct = (val / data.totalValue) * 100;
      const relDrift = sp.target_allocation > 0 ? ((currentPct - sp.target_allocation) / sp.target_allocation) * 100 : 0;
      return sum + (Math.abs(relDrift) * weight);
    }, 0);

    const netImpact = allocationsFinal.reduce((sum: number, item: any) => {
        if (item.action === 'sell') return sum + item.amount;
        if (item.action === 'buy') return sum - item.amount;
        return sum;
    }, 0);

    return { allocations: allocationsFinal, totalWeightedAssetDrift, totalWeightedSubDrift, netImpact };
  }, [data, overrideAssetTargets]);

  const chartSlices = useMemo(() => {
    if (!calculatedData) return [];

    let base: any[] = [];
    if (lens === 'total') {
      base = [{ key: 'Portfolio', data: calculatedData.allocations }];
    } else {
      const groupMap = new Map();
      calculatedData.allocations.forEach((a: any) => {
        let key = 'Unknown';
        switch (lens) {
          case 'sub_portfolio': key = a.sub_portfolio_name || 'Unassigned'; break;
          case 'asset_type': key = a.asset_type || 'Unknown'; break;
          case 'asset_subtype': key = a.asset_subtype || 'Unknown'; break;
          case 'geography': key = a.geography || 'Unknown'; break;
          case 'size_tag': key = a.size_tag || 'Unknown'; break;
          case 'factor_tag': key = a.factor_tag || 'Unknown'; break;
        }
        if (!groupMap.has(key)) groupMap.set(key, []);
        groupMap.get(key).push(a);
      });
      base = Array.from(groupMap.entries())
        .filter(([key]) => selectedValues.length === 0 || selectedValues.includes(key))
        .map(([key, items]) => ({ key, data: items }));
    }

    if (aggregate && base.length > 1) {
        const aggregatedPoints = base.map(g => {
          const groupCurrentValue = g.data.reduce((s: number, i: any) => s + i.current_value, 0);
          const groupCurrentPct = data.totalValue > 0 ? (groupCurrentValue / data.totalValue) * 100 : 0;
          const groupTargetPct = g.data.reduce((s: number, i: any) => s + (i.implied_overall_target || 0), 0);
          const drift = groupTargetPct > 0 ? ((groupCurrentPct - groupTargetPct) / groupTargetPct) * 100 : 0;
          return { ticker: g.key, drift_percentage: drift, current_pct: groupCurrentPct, target_pct: groupTargetPct };
        });
        base = [{ key: 'Aggregated Selection', data: aggregatedPoints }];
    }

    return base.map((s: any) => ({ 
      ...s, 
      data: [...s.data].sort((a,b) => b.drift_percentage - a.drift_percentage) 
    }));
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
    setSortDir(prev => (sortCol === col ? (prev === 'asc' ? 'desc' : 'asc') : 'desc'));
    setSortCol(col);
  }

  const SortIcon = ({ col }: { col: string }) => (
    <ArrowUpDown className={cn("ml-1 h-3 w-3 inline cursor-pointer", sortCol === col ? "text-blue-600" : "text-zinc-400")} />
  )

  const toggleValue = (value: string) => {
    setSelectedValues(prev => prev.includes(value) ? prev.filter(v => v !== value) : [...prev, value])
  }

  if (loading || !calculatedData) return <div className="p-8 text-center text-lg animate-pulse">Calculating rebalancing paths...</div>

  const rebalanceNeeded = calculatedData.allocations.some((a: any) => a.action !== 'hold')

  return (
    <div className="space-y-6 p-4 max-w-[1600px] mx-auto overflow-x-hidden">
      <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-5 gap-4">
        <div className="bg-card p-4 rounded-lg border text-center shadow-sm"><Label className="text-[10px] uppercase font-bold text-muted-foreground">Value</Label><div className="text-xl font-bold">{formatUSD(data.totalValue)}</div></div>
        <div className="bg-card p-4 rounded-lg border text-center shadow-sm"><Label className="text-[10px] uppercase font-bold text-muted-foreground leading-none">Sub-Portfolio Drift (Wtd)</Label><div className="text-xl font-bold mt-1">{calculatedData.totalWeightedSubDrift.toFixed(1)}%</div></div>
        <div className="bg-card p-4 rounded-lg border text-center shadow-sm"><Label className="text-[10px] uppercase font-bold text-muted-foreground leading-none">Asset Drift (Wtd)</Label><div className="text-xl font-bold mt-1">{calculatedData.totalWeightedAssetDrift.toFixed(1)}%</div></div>
        <div className="bg-card p-4 rounded-lg border text-center shadow-sm"><Label className="text-[10px] uppercase font-bold text-muted-foreground leading-none">Rebalance Needed</Label><div className={cn("text-xl font-bold flex items-center justify-center mt-1", rebalanceNeeded ? "text-yellow-600" : "text-green-600")}>{rebalanceNeeded ? "Yes" : "No"}</div></div>
        <div className="bg-card p-4 rounded-lg border text-center shadow-sm"><Label className="text-[10px] uppercase font-bold text-muted-foreground text-blue-600 leading-none">Net Impact ($)</Label><div className={cn("text-xl font-bold mt-1", calculatedData.netImpact > 0 ? "text-green-600" : (calculatedData.netImpact < 0 ? "text-red-500" : "text-black"))}>{calculatedData.netImpact > 0 ? "+" : ""}{formatUSD(calculatedData.netImpact)}</div></div>
      </div>

      <div className="flex flex-wrap gap-4 items-end border-b pb-4 bg-muted/10 p-4 rounded-xl">
        <div className="w-56"><Label className="text-[10px] font-bold uppercase mb-1 block">View Lens</Label><Select value={lens} onValueChange={setLens}><SelectTrigger className="bg-background focus:ring-0"><SelectValue/></SelectTrigger><SelectContent>{LENSES.map(l => <SelectItem key={l.value} value={l.value}>{l.label}</SelectItem>)}</SelectContent></Select></div>
        {lens !== 'total' && (<div className="w-64"><Label className="text-[10px] font-bold uppercase mb-1 block">Filter</Label><Popover><PopoverTrigger asChild><Button variant="outline" className="w-full justify-between bg-background">{selectedValues.length} selected <ChevronsUpDown className="w-4 h-4 ml-2 opacity-50" /></Button></PopoverTrigger><PopoverContent className="w-64 p-0"><Command><CommandInput placeholder="Search..." /><CommandList><CommandGroup className="max-h-64 overflow-y-auto">{availableValues.map(v => (<CommandItem key={v.value} onSelect={() => toggleValue(v.value)}><Check className={cn("w-4 h-4 mr-2", selectedValues.includes(v.value) ? "opacity-100" : "opacity-0")} />{v.label}</CommandItem>))}</CommandGroup></CommandList></Command></PopoverContent></Popover></div>)}
        {lens !== 'total' && selectedValues.length > 1 && (<div className="flex items-center gap-2 mb-2 p-2 border rounded-md bg-background"><Switch checked={aggregate} onCheckedChange={setAggregate} id="agg-switch" /><Label htmlFor="agg-switch" className="text-xs cursor-pointer">Aggregate charts</Label></div>)}
        <Button onClick={async () => { setRefreshing(true); await refreshAssetPrices(); fetchData(); setRefreshing(false); }} disabled={refreshing} size="sm" variant="default" className="bg-black text-white ml-auto flex items-center h-9 px-4 shadow-md transition-all hover:bg-zinc-800"><RefreshCw className={cn("w-4 h-4 mr-2", refreshing && "animate-spin")} /> {refreshing ? 'Hold...' : 'Refresh Prices'}</Button>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {chartSlices.map((slice: any, idx: number) => (
          <div key={idx} className="bg-card p-6 rounded-xl border shadow-sm space-y-4">
            <h3 className="font-bold text-center border-b pb-2 uppercase tracking-wide text-[10px]">{slice.key} Drift Analysis</h3>
            <div className="h-[380px]"><ResponsiveContainer width="100%" height="100%"><BarChart data={slice.data} layout="vertical" margin={{ left: 10, right: 30 }}><CartesianGrid strokeDasharray="3 3" horizontal={false} /><XAxis type="number" unit="%" fontSize={10} axisLine={false} tickLine={false} /><YAxis dataKey="ticker" type="category" interval={0} fontSize={9} width={40} /><RechartsTooltip formatter={(v:any) => [`${Number(v).toFixed(1)}%`, 'Drift']} /><Bar dataKey="drift_percentage">{slice.data.map((entry: any, i: number) => (<Cell key={i} fill={getDriftColor(entry.drift_percentage, slice.data)} />))}</Bar></BarChart></ResponsiveContainer></div>
          </div>
        ))}
      </div>

      <div className="pt-8 border-t">
        <Accordion type="multiple" value={openItems} onValueChange={setOpenItems}>
          {data.subPortfolios.map((sp: any) => {
            const items = calculatedData.allocations.filter((a: any) => a.sub_portfolio_id === sp.id)
            if (items.length === 0) return null
            const totalVal = items.reduce((s:number, i:any) => s+i.current_value, 0); const totalWeight = items.reduce((s:number, i:any) => s+(Number(i.current_in_sp)||0), 0); const totalTarget = items.reduce((s:number, i:any) => s+(Number(i.sub_portfolio_target_percentage)||0), 0); const totalImplied = items.reduce((s:number, i:any) => s+(Number(i.implied_overall_target)||0), 0); 
            const wtdDrift = totalVal > 0 ? items.reduce((s:number, i:any) => s + (Math.abs(i.drift_percentage) * i.current_value), 0) / totalVal : 0;
            const sortedItems = [...items].sort((a,b) => { 
                const aV = sortCol === 'ticker' ? a.ticker : a[sortCol]; 
                const bV = sortCol === 'ticker' ? b.ticker : b[sortCol];
                const res = (aV || 0) < (bV || 0) ? -1 : (aV || 0) > (bV || 0) ? 1 : 0;
                return sortDir === 'asc' ? res : -res;
            });

            return (
              <AccordionItem key={sp.id} value={sp.id} className="border rounded-xl mb-6 overflow-hidden shadow-sm bg-background">
                <AccordionTrigger className="bg-black text-white px-6 hover:bg-zinc-900 transition-all"><div className="flex justify-between w-full mr-6 font-bold uppercase tracking-tight"><span>{sp.name}</span><div className="flex gap-8 text-sm font-mono opacity-80"><span>{formatUSD(totalVal)}</span><span>{sp.target_allocation.toFixed(1)}%</span></div></div></AccordionTrigger>
                <AccordionContent className="p-0">
                    <div className="overflow-x-auto w-full"><Table className="min-w-[1200px] table-fixed w-full border-collapse"><TableHeader className="bg-muted/30"><TableRow><TableHead className="w-[15%] cursor-pointer" onClick={()=>handleSort('ticker')}>Asset <SortIcon col="ticker"/></TableHead><TableHead className="w-[12%] text-right cursor-pointer" onClick={()=>handleSort('current_value')}>Current Value ($) <SortIcon col="current_value"/></TableHead><TableHead className="w-[10%] text-right cursor-pointer" onClick={()=>handleSort('current_in_sp')}>Current Weight <SortIcon col="current_in_sp"/></TableHead><TableHead className="w-[10%] text-right text-blue-600 font-bold">Target Weight</TableHead><TableHead className="w-[10%] text-right cursor-pointer" onClick={()=>handleSort('implied_overall_target')}>Implied Overall % <SortIcon col="implied_overall_target"/></TableHead><TableHead className="w-[10%] text-right cursor-pointer" onClick={()=>handleSort('drift_percentage')}>Drift % <SortIcon col="drift_percentage"/></TableHead><TableHead className="w-[10%] text-center">Action</TableHead><TableHead className="w-[23%] text-right pr-6">Tactical Suggestion</TableHead></TableRow></TableHeader><TableBody>{sortedItems.map((i: any) => (<TableRow key={i.asset_id} className="hover:bg-muted/5 h-16 group"><TableCell className="font-bold border-l-2 border-transparent group-hover:border-zinc-300 pl-4">{i.ticker}</TableCell><TableCell className="text-right tabular-nums">{formatUSD(i.current_value)}</TableCell><TableCell className="text-right tabular-nums">{i.current_in_sp.toFixed(1)}%</TableCell><TableCell className="text-right"><Input defaultValue={i.sub_portfolio_target_percentage} type="number" step="0.1" onBlur={(e) => setOverrideAssetTargets(p => ({...p, [i.asset_id]: parseFloat(e.target.value)}))} className="h-8 text-right w-20 ml-auto border-zinc-200 focus:border-blue-400 focus:ring-1 focus:ring-blue-400 bg-zinc-50/50"/></TableCell><TableCell className="text-right tabular-nums">{i.implied_overall_target.toFixed(1)}%</TableCell><TableCell className={cn("text-right tabular-nums font-bold", i.drift_percentage > 0.1 ? "text-green-600" : (i.drift_percentage < -0.1 ? "text-red-500" : "text-black"))}>{i.drift_percentage > 0 ? "+" : ""}{i.drift_percentage.toFixed(1)}%</TableCell><TableCell className="text-center font-bold">{i.action === 'hold' ? <span className="text-zinc-300">-</span> : <div className="flex flex-col"><span className={cn(i.action === 'buy' ? "text-green-600" : "text-red-600")}>{i.action.toUpperCase()}</span><span className="text-[10px] font-normal opacity-50">{formatUSD(i.amount)}</span></div>}</TableCell><TableCell className="text-right text-[10px] pr-6 italic text-zinc-500">{i.reinvestment_suggestions?.map((s:any, idx:number) => <div key={idx} className="text-blue-700">Reallocate from {s.from_ticker}: {formatUSD(s.amount)}</div>) || "-"}</TableCell></TableRow>))}<TableRow className="bg-zinc-900 text-white font-bold h-12 shadow-inner"><TableCell className="pl-4 uppercase tracking-tighter">Total</TableCell><TableCell className="text-right tabular-nums pr-4">{formatUSD(totalVal)}</TableCell><TableCell className="text-right tabular-nums pr-4">{totalWeight.toFixed(1)}%</TableCell><TableCell className="text-right tabular-nums pr-4">{totalTarget.toFixed(1)}%</TableCell><TableCell className="text-right tabular-nums pr-4">{totalImplied.toFixed(1)}%</TableCell><TableCell className={cn("text-right tabular-nums pr-4", wtdDrift > 0 ? "text-green-400" : "text-red-400")}>{wtdDrift.toFixed(1)}%</TableCell><TableCell className="text-center">N/A</TableCell><TableCell className="text-right pr-6 opacity-60">N/A</TableCell></TableRow></TableBody></Table></div>
                </AccordionContent>
              </AccordionItem>
            )
          })}
        </Accordion>
      </div>
    </div>
  )
}
