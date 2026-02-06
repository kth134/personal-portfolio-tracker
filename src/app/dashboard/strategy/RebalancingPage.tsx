'use client'

import { useState, useEffect, useMemo, useCallback } from 'react'
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
import { Check, ChevronsUpDown, AlertTriangle, Info, RefreshCw, ArrowUpDown } from 'lucide-react'
import { formatUSD } from '@/lib/formatters'
import { cn } from '@/lib/utils'
import { calculateRebalanceActions } from '@/lib/rebalancing-logic'
import { refreshAssetPrices } from '../portfolio/actions'

const COLORS = ['#3b82f6', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6', '#ec4899', '#06b6d4', '#14b8a6', '#f97316', '#a855f7']

const LENSES = [
  { value: 'total', label: 'Assets' },
  { value: 'sub_portfolio', label: 'Sub-Portfolio' },
  { value: 'account', label: 'Account' },
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
  
  // Sorting
  const [sortCol, setSortCol] = useState('drift_percentage')
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc')

  // Local overrides for instant updates (Rule #8)
  const [overrideSubTargets, setOverrideSubTargets] = useState<Record<string, number>>({})
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

  // Fetch drill-down filters (Rule #6)
  useEffect(() => {
    if (lens === 'total') { setAvailableValues([]); setSelectedValues([]); return; }
    const fetchVals = async () => {
      const res = await fetch('/api/dashboard/values', { method: 'POST', body: JSON.stringify({ lens }) })
      const payload = await res.json()
      setAvailableValues(payload.values || [])
      setSelectedValues((payload.values || []).map((v: any) => v.value))
    }
    fetchVals()
  }, [lens])

  // REBALANCING ENGINE (Client-side for instant updates - Rule #8)
  const calculatedData = useMemo(() => {
    if (!data) return null;
    
    // 1. Process Groups / Sub-Portfolios
    const subPortfolios = data.subPortfolios.map((sp: any) => ({
      ...sp,
      target_allocation: overrideSubTargets[sp.id] ?? sp.target_allocation
    }));

    // 2. Process Assets with dynamic math
    const allocations = data.currentAllocations.map((a: any) => {
      const sp = subPortfolios.find((p: any) => p.id === a.sub_portfolio_id);
      const targetInGroup = overrideAssetTargets[a.asset_id] ?? a.sub_portfolio_target_percentage;
      
      const { impliedOverallTarget, currentInGroupPct, driftPercentage, action, amount } = calculateRebalanceActions({
        currentValue: a.current_value,
        totalPortfolioValue: data.totalValue,
        targetInGroup,
        groupTargetRatio: sp?.target_allocation || 0,
        upsideThreshold: sp?.upside_threshold,
        downsideThreshold: sp?.downside_threshold,
        bandMode: sp?.band_mode
      });

      return {
        ...a,
        sub_portfolio_target_percentage: targetInGroup,
        implied_overall_target: impliedOverallTarget,
        current_in_sp: currentInGroupPct,
        drift_percentage: driftPercentage,
        action,
        amount
      };
    });

    // 3. Global Stats
    const totalWeightedAssetDrift = allocations.reduce((sum: number, item: any) => {
      const weight = item.current_value / data.totalValue;
      return sum + (Math.abs(item.drift_percentage) * weight);
    }, 0);

    const subIdValues = allocations.reduce((acc: any, item: any) => {
      acc[item.sub_portfolio_id] = (acc[item.sub_portfolio_id] || 0) + item.current_value;
      return acc;
    }, {});

    const totalWeightedSubDrift = subPortfolios.reduce((sum: number, sp: any) => {
      const val = subIdValues[sp.id] || 0;
      const weight = val / data.totalValue;
      const currentPct = (val / data.totalValue) * 100;
      const relDrift = sp.target_allocation > 0 ? ((currentPct - sp.target_allocation) / sp.target_allocation) * 100 : 0;
      return sum + (Math.abs(relDrift) * weight);
    }, 0);

    const netImpact = allocations.reduce((sum: number, item: any) => {
        if (item.action === 'sell') return sum + item.amount;
        if (item.action === 'buy') return sum - item.amount;
        return sum;
    }, 0);

    return { allocations, subPortfolios, totalWeightedAssetDrift, totalWeightedSubDrift, netImpact };
  }, [data, overrideSubTargets, overrideAssetTargets]);

  // DRIVE VISUALIZATIONS (Rule #6)
  const chartSlices = useMemo(() => {
    if (!calculatedData) return [];
    if (lens === 'total') return [{ key: 'Portfolio Assets', data: calculatedData.allocations }];
    
    const groups = new Map();
    calculatedData.allocations.forEach((a: any) => {
      const key = a.sub_portfolio_name || 'Unassigned';
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(a);
    });

    let results = Array.from(groups.entries())
      .filter(([key]) => selectedValues.includes(key) || lens !== 'sub_portfolio')
      .map(([key, items]) => ({ key, data: items }));

    if (aggregate && results.length > 1) {
      const combined = results.flatMap(r => r.data);
      return [{ key: 'Aggregated Selection', data: combined }];
    }
    return results;
  }, [calculatedData, lens, selectedValues, aggregate]);

  // HELPER FOR BAR COLORING (Rule #5 - Gradient)
  const getGradientColor = (drift: number, maxDrift: number) => {
    const abs = Math.abs(drift);
    const intensity = Math.min(1, abs / (maxDrift || 10)); // Scale intensity based on global max drift
    if (drift > 0) return `rgba(16, 185, 129, ${0.4 + (intensity * 0.6)})`; // Darker green for higher drift
    return `rgba(239, 68, 68, ${0.4 + (intensity * 0.6)})`; // Darker red for higher negative drift
  };

  const maxGlobalDrift = useMemo(() => {
    if (!calculatedData) return 10;
    return Math.max(...calculatedData.allocations.map((a:any) => Math.abs(a.drift_percentage)), 10);
  }, [calculatedData]);

  const handleSort = (col: string) => {
    if (sortCol === col) setSortDir(sortDir === 'asc' ? 'desc' : 'asc')
    else { setSortCol(col); setSortDir('desc'); }
  }

  const SortIcon = ({ col }: { col: string }) => (
    <ArrowUpDown className={cn("ml-1 h-3 w-3 inline cursor-pointer", sortCol === col ? "text-blue-600" : "text-zinc-400")} />
  )

  if (loading || !calculatedData) return <div className="p-8 text-center text-lg">Calculating rebalancing paths...</div>

  // SUMMARY CALCULATIONS (Same logic as bar charts)
  const rebalanceNeeded = calculatedData.allocations.some((a: any) => a.action !== 'hold');
    <div className="space-y-6 p-4 max-w-[1600px] mx-auto">
      {/* Rule #9 Summary Cards */}
      <div className="grid grid-cols-1 md:grid-cols-5 gap-4">
        <div className="bg-card p-4 rounded-lg border text-center">
            <Label className="text-[10px] uppercase font-bold text-muted-foreground">Portfolio Value</Label>
            <div className="text-2xl font-bold">{formatUSD(data.totalValue)}</div>
        </div>
        <div className="bg-card p-4 rounded-lg border text-center">
            <Label className="text-[10px] uppercase font-bold text-muted-foreground">Sub-Portfolio Drift (Wtd)</Label>
            <div className="text-2xl font-bold">{calculatedData.totalWeightedSubDrift.toFixed(1)}%</div>
        </div>
        <div className="bg-card p-4 rounded-lg border text-center">
            <Label className="text-[10px] uppercase font-bold text-muted-foreground">Asset Drift (Wtd)</Label>
            <div className="text-2xl font-bold">{calculatedData.totalWeightedAssetDrift.toFixed(1)}%</div>
        </div>
        <div className="bg-card p-4 rounded-lg border text-center">
            <Label className="text-[10px] uppercase font-bold text-muted-foreground">Rebalance Needed</Label>
            <div className={cn("text-2xl font-bold flex items-center justify-center", rebalanceNeeded ? "text-yellow-600" : "text-green-600")}>
                {rebalanceNeeded ? "Yes" : "No"}
            </div>
        </div>
        <div className="bg-card p-4 rounded-lg border text-center">
            <Label className="text-[10px] uppercase font-bold text-muted-foreground text-blue-600">Net Cash Impact of Trades</Label>
            <div className={cn("text-2xl font-bold", calculatedData.netImpact > 0 ? "text-green-600" : (calculatedData.netImpact < 0 ? "text-red-500" : "text-zinc-400"))}>
                {calculatedData.netImpact > 0 ? "+" : ""}{formatUSD(calculatedData.netImpact)}
            </div>
        </div>
      </div>

      {/* Rule #1 & #6 Buttons & Slicers */}
      <div className="flex flex-wrap gap-4 items-end border-b pb-4 bg-muted/10 p-4 rounded-xl">
        <div className="w-56">
          <Label className="text-[10px] font-bold uppercase mb-1 block">View Lens</Label>
          <Select value={lens} onValueChange={setLens}>
            <SelectTrigger className="bg-background"><SelectValue/></SelectTrigger>
            <SelectContent>{LENSES.map(l => <SelectItem key={l.value} value={l.value}>{l.label}</SelectItem>)}</SelectContent>
          </Select>
        </div>

        {lens !== 'total' && (
          <div className="w-64">
            <Label className="text-[10px] font-bold uppercase mb-1 block">Filter</Label>
            <Popover>
              <PopoverTrigger asChild>
                <Button variant="outline" className="w-full justify-between bg-background">
                  {selectedValues.length} selected <ChevronsUpDown className="w-4 h-4 ml-2 opacity-50" />
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-full p-0">
                <Command>
                    <CommandInput placeholder="Search..." />
                    <CommandList>
                        <CommandGroup>{availableValues.map(v => (<CommandItem key={v.value} onSelect={() => toggleValue(v.value)}><Check className={cn("w-4 h-4 mr-2", selectedValues.includes(v.value) ? "opacity-100" : "opacity-0")} />{v.label}</CommandItem>))}</CommandGroup>
                    </CommandList>
                </Command>
              </PopoverContent>
            </Popover>
          </div>
        )}

        {lens !== 'total' && selectedValues.length > 1 && (
          <div className="flex items-center gap-2 mb-2 p-2 border rounded-md bg-background">
            <Switch checked={aggregate} onCheckedChange={setAggregate} id="agg-switch" />
            <Label htmlFor="agg-switch" className="text-xs cursor-pointer">Aggregate charts</Label>
          </div>
        )}

        <Button onClick={async () => { setRefreshing(true); await refreshAssetPrices(); setRefreshTrigger(t => t + 1); fetchData(); setRefreshing(false); }} disabled={refreshing} variant="default" className="bg-black text-white hover:bg-zinc-800 ml-auto">
          <RefreshCw className={cn("w-4 h-4 mr-2", refreshing && "animate-spin")} /> {refreshing ? 'Refreshing...' : 'Refresh Prices'}
        </Button>
      </div>

      {/* Rule #4 & #5 Visualization Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {chartSlices.map((slice: any, idx: number) => (
          <div key={idx} className="bg-card p-6 rounded-xl border shadow-sm space-y-4">
            <h3 className="font-bold text-center border-b pb-2 uppercase tracking-wide text-xs">{slice.key} Drift Analysis</h3>
            <div className="h-[350px]">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={[...slice.data].sort((a,b)=>b.drift_percentage - a.drift_percentage)} layout="vertical" margin={{ left: 40, right: 40 }}>
                  <CartesianGrid strokeDasharray="3 3" horizontal={false} />
                  <XAxis type="number" unit="%" fontSize={10} axisLine={false} tickLine={false} />
                  <YAxis dataKey="ticker" type="category" interval={0} fontSize={10} width={40} axisLine={false} tickLine={false} />
                  <RechartsTooltip formatter={(v:any) => [`${Number(v).toFixed(1)}%`, 'Drift']} labelStyle={{ fontWeight: 'bold' }} />
                  <Bar dataKey="drift_percentage">
                    {slice.data.map((entry: any, i: number) => (
                      <Cell key={i} fill={getGradientColor(entry.drift_percentage, maxGlobalDrift)} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>
        ))}
      </div>

      {/* Rule #3, #7, #8 Tactical Tables */}
      <div className="pt-8 border-t">
        <h2 className="text-xl font-bold mb-6 flex items-center gap-2">Tactical Execution Dashboard</h2>
        <Accordion type="multiple" value={openItems} onValueChange={setOpenItems}>
          {calculatedData.subPortfolios.map((sp: any) => {
            const items = calculatedData.allocations.filter((a: any) => a.sub_portfolio_id === sp.id)
            if (items.length === 0) return null
            
            // Rule #7: Total Row Calculation
            const totalVal = items.reduce((s:number, i:any) => s+i.current_value, 0);
            const totalWeight = items.reduce((s:number, i:any) => s+(Number(i.current_in_sp)||0), 0);
            const totalTarget = items.reduce((s:number, i:any) => s+(Number(i.sub_portfolio_target_percentage)||0), 0);
            const totalImplied = items.reduce((s:number, i:any) => s+(Number(i.implied_overall_target)||0), 0);
            const wtdDrift = totalVal > 0 ? items.reduce((s:number, i:any) => s + (i.drift_percentage * i.current_value), 0) / totalVal : 0;

            const sortedItems = [...items].sort((a,b) => {
                const aV = a[sortCol]; const bV = b[sortCol];
                const r = aV < bV ? -1 : aV > bV ? 1 : 0;
                return sortDir === 'asc' ? r : -r;
            });

            return (
              <AccordionItem key={sp.id} value={sp.id} className="border rounded-xl mb-6 overflow-hidden shadow-sm bg-background">
                <AccordionTrigger className="bg-black text-white px-6 hover:bg-zinc-900 transition-all">
                  <div className="flex justify-between w-full mr-6 items-center">
                    <span className="font-bold text-lg">{sp.name}</span>
                    <div className="flex gap-8 text-sm font-mono text-zinc-300">
                      <span>Value: {formatUSD(totalVal)}</span>
                      <span>Weight: {sp.target_allocation.toFixed(1)}%</span>
                    </div>
                  </div>
                </AccordionTrigger>
                <AccordionContent className="p-0">
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-6 p-4 bg-muted/10 border-b">
                        <div className="space-y-2">
                            <Label className="text-[10px] font-bold uppercase text-zinc-500">Sub-Portfolio Target %</Label>
                            <Input defaultValue={sp.target_allocation} type="number" onBlur={(e) => setOverrideSubTargets(p => ({...p, [sp.id]: parseFloat(e.target.value)}))} className="h-9 w-32 border-zinc-300 shadow-sm" />
                        </div>
                        <div className="space-y-2">
                            <Label className="text-[10px] font-bold uppercase text-zinc-500">Upside Threshold %</Label>
                            <Input defaultValue={sp.upside_threshold} type="number" onBlur={(e) => updateSubPortfolio(sp.id, 'upside_threshold', parseFloat(e.target.value))} className="h-9 w-32 border-zinc-300 shadow-sm" />
                        </div>
                        <div className="space-y-2">
                            <Label className="text-[10px] font-bold uppercase text-zinc-500">Downside Threshold %</Label>
                            <Input defaultValue={sp.downside_threshold} type="number" onBlur={(e) => updateSubPortfolio(sp.id, 'downside_threshold', parseFloat(e.target.value))} className="h-9 w-32 border-zinc-300 shadow-sm" />
                        </div>
                    </div>
                    <div className="overflow-x-auto">
                        <Table className="min-w-[1200px] table-fixed w-full border-collapse">
                            <TableHeader className="bg-muted/30">
                                <TableRow>
                                    <TableHead className="w-[15%] cursor-pointer" onClick={()=>handleSort('ticker')}>Asset <SortIcon col="ticker"/></TableHead>
                                    <TableHead className="w-[12%] text-right cursor-pointer" onClick={()=>handleSort('current_value')}>Current Value ($) <SortIcon col="current_value"/></TableHead>
                                    <TableHead className="w-[10%] text-right cursor-pointer" onClick={()=>handleSort('current_in_sp')}>Current Weight <SortIcon col="current_in_sp"/></TableHead>
                                    <TableHead className="w-[10%] text-right text-blue-600 font-bold">Target Weight (Edit)</TableHead>
                                    <TableHead className="w-[10%] text-right cursor-pointer" onClick={()=>handleSort('implied_overall_target')}>Implied Overall % <SortIcon col="implied_overall_target"/></TableHead>
                                    <TableHead className="w-[10%] text-right cursor-pointer" onClick={()=>handleSort('drift_percentage')}>Drift % <SortIcon col="drift_percentage"/></TableHead>
                                    <TableHead className="w-[10%] text-center">Action</TableHead>
                                    <TableHead className="w-[23%] text-right pr-6">Tactical Suggestion</TableHead>
                                </TableRow>
                            </TableHeader>
                            <TableBody>
                                {sortedItems.map((i: any) => (
                                    <TableRow key={i.asset_id} className="hover:bg-muted/5 h-16 group">
                                        <TableCell className="font-bold border-l-2 border-transparent group-hover:border-zinc-300 pl-4">{i.ticker}</TableCell>
                                        <TableCell className="text-right tabular-nums">{formatUSD(i.current_value)}</TableCell>
                                        <TableCell className="text-right tabular-nums">{i.current_in_sp.toFixed(1)}%</TableCell>
                                        <TableCell className="text-right">
                                            <Input defaultValue={i.sub_portfolio_target_percentage} type="number" step="0.1" onBlur={(e) => setOverrideAssetTargets(p => ({...p, [i.asset_id]: parseFloat(e.target.value)}))} className="h-8 text-right w-20 ml-auto border-zinc-200 focus:border-blue-400 focus:ring-1 focus:ring-blue-400 bg-zinc-50/50"/>
                                        </TableCell>
                                        <TableCell className="text-right tabular-nums">{i.implied_overall_target.toFixed(1)}%</TableCell>
                                        <TableCell className={cn("text-right tabular-nums font-bold", i.drift_percentage > 0.1 ? "text-green-600" : (i.drift_percentage < -0.1 ? "text-red-500" : "text-zinc-900"))}>
                                            {i.drift_percentage > 0 ? "+" : ""}{i.drift_percentage.toFixed(1)}%
                                        </TableCell>
                                        <TableCell className="text-center font-bold">
                                            {i.action === 'hold' ? <span className="text-zinc-300">-</span> : 
                                                <div className="flex flex-col"><span className={cn(i.action === 'buy' ? "text-green-600" : "text-red-600")}>{i.action.toUpperCase()}</span><span className="text-[10px] font-normal text-zinc-500">{formatUSD(i.amount)}</span></div>
                                            }
                                        </TableCell>
                                        <TableCell className="text-right text-[10px] pr-6 leading-normal text-zinc-600 italic">
                                            {i.reinvestment_suggestions?.map((s:any, idx:number) => <div key={idx} className="text-blue-700 font-medium">Reallocate from {s.from_ticker}: {formatUSD(s.amount)}</div>) || <span className="opacity-40">-</span>}
                                        </TableCell>
                                    </TableRow>
                                ))}
                                {/* Rule #7: Total Row */}
                                <TableRow className="bg-zinc-900 text-white font-bold h-12 shadow-inner">
                                    <TableCell className="pl-4 uppercase tracking-tighter">Total</TableCell>
                                    <TableCell className="text-right tabular-nums pr-4">{formatUSD(totalVal)}</TableCell>
                                    <TableCell className="text-right tabular-nums pr-4">{totalWeight.toFixed(1)}%</TableCell>
                                    <TableCell className="text-right tabular-nums pr-4">{totalTarget.toFixed(1)}%</TableCell>
                                    <TableCell className="text-right tabular-nums pr-4">{totalImplied.toFixed(1)}%</TableCell>
                                    <TableCell className={cn("text-right tabular-nums pr-4", wtdDrift > 0 ? "text-green-300" : "text-red-400")}>{wtdDrift.toFixed(1)}%</TableCell>
                                    <TableCell className="text-center">N/A</TableCell>
                                    <TableCell className="text-right pr-6 opacity-60">N/A</TableCell>
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
