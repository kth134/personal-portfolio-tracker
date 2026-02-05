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
import { Check, ChevronsUpDown, AlertTriangle, Info } from 'lucide-react'
import { formatUSD } from '@/lib/formatters'
import { cn } from '@/lib/utils'

const COLORS = ['#3b82f6', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6', '#ec4899', '#06b6d4', '#14b8a6', '#f97316', '#a855f7']

const LENSES = [
  { value: 'total', label: 'Assets' },
  { value: 'sub_portfolio', label: 'Sub-Portfolio' },
  { value: 'account', label: 'Account' },
  { value: 'asset_type', label: 'Asset Type' },
]

export default function RebalancingPage() {
  const [lens, setLens] = useState('total')
  const [availableValues, setAvailableValues] = useState<{value: string, label: string}[]>([])
  const [selectedValues, setSelectedValues] = useState<string[]>([])
  const [aggregate, setAggregate] = useState(true)
  const [data, setData] = useState<any>(null)
  const [chartData, setChartData] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [openItems, setOpenItems] = useState<string[]>([])

  // State for editable values (local drifts/inputs)
  const [draftInputs, setDraftInputs] = useState<Record<string, string>>({})

  // Fetch distinct values for multi-select
  useEffect(() => {
    if (lens === 'total') {
      setAvailableValues([])
      setSelectedValues([])
      return
    }
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

  // Load backend data (authoritative data for tables and logic)
  useEffect(() => {
    fetchData()
  }, [])

  const fetchData = async () => {
    setLoading(true)
    try {
      const res = await fetch('/api/rebalancing')
      const payload = await res.json()
      setData(payload)
      setOpenItems(payload.subPortfolios.map((p: any) => p.id))
    } catch (err) { console.error('Data fetch error:', err) } finally { setLoading(false) }
  }

  // Load Chart Data (Dynamic Sliced Data)
  useEffect(() => {
    if (!data) return; // Wait for base data first
    const loadCharts = async () => {
      try {
        const payload = { 
          lens, 
          selectedValues: lens === 'total' ? [] : selectedValues,
          aggregate 
        };
        const res = await fetch('/api/dashboard/allocations', {
          method: 'POST',
          body: JSON.stringify(payload)
        });
        const payloadJson = await res.json();
        setChartData(payloadJson.allocations || []);
      } catch (err) { console.error('Chart Data error:', err) }
    };
    loadCharts();
  }, [lens, JSON.stringify(selectedValues), aggregate]);

  // HELPERS FOR SAVING
  const updateSubPortfolio = async (id: string, field: string, value: number) => {
    try {
      const payload = { id, [field]: value };
      let endpoint = '/api/rebalancing/sub-portfolio-target';
      if (field === 'upside_threshold' || field === 'downside_threshold') endpoint = '/api/rebalancing/thresholds';
      
      const res = await fetch(endpoint, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      if (res.ok) fetchData();
    } catch (err) { console.error('Save error:', err) }
  }

  const updateAssetTarget = async (assetId: string, spId: string, value: number) => {
    try {
      const res = await fetch('/api/rebalancing/asset-target', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ asset_id: assetId, sub_portfolio_id: spId, target_percentage: value })
      });
      if (res.ok) fetchData();
    } catch (err) { console.error('Asset Target Save error:', err) }
  }

  const toggleValue = (value: string) => {
    setSelectedValues(prev => prev.includes(value) ? prev.filter(v => v !== value) : [...prev, value])
  }

  if (loading || !data) return <div className="p-8 text-center text-lg animate-pulse">Analyzing portfolio strategy...</div>

  // SUMMARY CALCULATIONS (Same logic as bar charts)
  const rebalanceNeeded = data.currentAllocations.some((a: any) => a.action !== 'hold')
  const netImpact = -data.cashNeeded 

  const totalWeightedAssetDrift = useMemo(() => {
    if (!data?.currentAllocations || data.totalValue === 0) return 0
    return data.currentAllocations.reduce((sum: number, item: any) => {
      const weight = item.current_value / data.totalValue
      const currentPct = item.current_percentage || 0
      const targetPct = item.implied_overall_target || 0
      const relChange = targetPct > 0 ? (currentPct - targetPct) / targetPct : 0
      return sum + (Math.abs(relChange) * weight)
    }, 0) * 100
  }, [data])

  const totalWeightedSubPortfolioDrift = useMemo(() => {
    if (!data?.subPortfolios || data.totalValue === 0) return 0
    const subIdValues = data.currentAllocations.reduce((acc: any, item: any) => {
      acc[item.sub_portfolio_id] = (acc[item.sub_portfolio_id] || 0) + item.current_value
      return acc
    }, {})
    return data.subPortfolios.reduce((sum: number, sp: any) => {
      const currentVal = subIdValues[sp.id] || 0
      const weight = currentVal / data.totalValue
      const currentPct = (currentVal / data.totalValue) * 100
      const targetPct = sp.target_allocation || 0
      const relChange = targetPct > 0 ? (currentPct - targetPct) / targetPct : 0
      return sum + (Math.abs(relChange) * weight)
    }, 0) * 100
  }, [data])

  const getDriftColor = (drift: number) => {
    const abs = Math.abs(drift)
    if (abs <= 5) return '#10b981'
    if (abs <= 20) return '#f59e0b'
    return '#ef4444'
  }

  return (
    <div className="space-y-4 md:space-y-8 p-2 md:p-4 max-w-[1600px] mx-auto overflow-x-hidden">
      {/* Summary Row - Responsive Grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-5 gap-4">
        <div className="bg-card p-4 rounded-lg border text-center">
          <h3 className="text-xs uppercase font-semibold text-muted-foreground mb-1">Portfolio Value</h3>
          <div className="text-xl md:text-2xl font-bold">{formatUSD(data.totalValue)}</div>
        </div>
        <div className="bg-card p-4 rounded-lg border text-center">
          <h3 className="text-xs uppercase font-semibold text-muted-foreground mb-1">Portfolio Drift</h3>
          <div className="grid grid-cols-2 gap-2 mt-1">
            <div>
              <p className="text-[10px] text-muted-foreground uppercase leading-none">Sub-Portfolio</p>
              <p className="text-base md:text-lg font-bold">{totalWeightedSubPortfolioDrift.toFixed(2)}%</p>
            </div>
            <div>
              <p className="text-[10px] text-muted-foreground uppercase leading-none">Asset-Level</p>
              <p className="text-base md:text-lg font-bold">{totalWeightedAssetDrift.toFixed(2)}%</p>
            </div>
          </div>
        </div>
        <div className="bg-card p-4 rounded-lg border text-center">
          <h3 className="text-xs uppercase font-semibold text-muted-foreground mb-1">Rebalance Status</h3>
          <div className={cn("text-xl md:text-2xl font-bold flex items-center justify-center", rebalanceNeeded ? "text-yellow-600" : "text-green-600")}>
            {rebalanceNeeded ? "Needed" : "Healthy"}
          </div>
        </div>
        <div className="bg-card p-4 rounded-lg border text-center sm:col-span-2">
          <h3 className="text-xs uppercase font-semibold text-muted-foreground mb-1">Net Cash Impact of Recommended Rebalancing</h3>
          <div className={cn("text-xl md:text-2xl font-bold", netImpact > 0 ? "text-green-600" : (netImpact < 0 ? "text-red-600" : ""))} title="Positive indicates cash generated from net sales">
            {netImpact > 0 ? "+" : ""}{formatUSD(netImpact)}
          </div>
        </div>
      </div>

      {/* Slicers & Controls */}
      <div className="flex flex-wrap gap-4 items-end mb-4 border-b pb-4 bg-muted/20 p-4 rounded-lg">
        <div className="min-w-[200px] flex-1 md:flex-none">
          <Label className="text-xs font-bold uppercase mb-1 block">View Lens</Label>
          <Select value={lens} onValueChange={setLens}>
            <SelectTrigger className="w-full md:w-56 bg-background"><SelectValue /></SelectTrigger>
            <SelectContent>{LENSES.map(l => (<SelectItem key={l.value} value={l.value}>{l.label}</SelectItem>))}</SelectContent>
          </Select>
        </div>

        {lens !== 'total' && (
          <div className="min-w-[200px] flex-1 md:flex-none">
            <Label className="text-xs font-bold uppercase mb-1 block">Filter Selection</Label>
            <Popover>
              <PopoverTrigger asChild>
                <Button variant="outline" className="w-full md:w-64 justify-between bg-background">
                  {selectedValues.length === availableValues.length ? 'All selected' : `${selectedValues.length} selected`}
                  <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-full p-0">
                <Command>
                    <CommandInput placeholder="Search values..." />
                    <CommandList>
                      <CommandEmpty>No results.</CommandEmpty>
                      <CommandGroup>
                        {availableValues.map(item => (
                          <CommandItem key={item.value} onSelect={() => toggleValue(item.value)}>
                            <Check className={cn("mr-2 h-4 w-4", selectedValues.includes(item.value) ? "opacity-100" : "opacity-0")} />
                            {item.label}
                          </CommandItem>
                        ))}
                      </CommandGroup>
                    </CommandList>
                </Command>
              </PopoverContent>
            </Popover>
          </div>
        )}

        {lens !== 'total' && selectedValues.length > 1 && (
          <div className="flex items-center gap-2 mb-2 p-2 px-4 border rounded-md bg-background">
            <Switch checked={aggregate} onCheckedChange={setAggregate} id="agg-switch" />
            <Label htmlFor="agg-switch" className="cursor-pointer text-sm">Aggregate charts</Label>
          </div>
        )}
      </div>

      {/* Visualizations Grid */}
      <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
        {chartData.map((slice, idx) => {
           const bars = slice.data.map((d: any) => {
              const drift = d.percentage - d.target_pct
              return { name: d.subkey, drift, current: d.percentage, target: d.target_pct }
           }).sort((a:any, b:any) => b.drift - a.drift)

           return (
             <div key={idx} className="bg-card p-4 rounded-lg border shadow-sm space-y-4">
                <h3 className="font-bold border-b pb-2">{slice.key}</h3>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-2 h-[350px]">
                   <ResponsiveContainer width="100%" height="100%">
                      <PieChart>
                         <Pie data={slice.data} dataKey="value" nameKey="subkey" outerRadius="85%" label={({ percent }) => `${((percent || 0) * 100).toFixed(0)}%`}>
                            {slice.data.map((_: any, i: number) => (<Cell key={i} fill={COLORS[i % COLORS.length]} />))}
                         </Pie>
                         <RechartsTooltip formatter={(v: any) => formatUSD(v)} />
                      </PieChart>
                   </ResponsiveContainer>
                   <ResponsiveContainer width="100%" height="100%">
                      <BarChart data={bars} layout="vertical" margin={{ left: 10, right: 10 }}>
                         <CartesianGrid strokeDasharray="3 3" horizontal={false} />
                         <XAxis type="number" unit="%" domain={['auto', 'auto']} fontSize={10} />
                         <YAxis type="category" dataKey="name" interval={0} width={60} fontSize={10} tick={{ fill: '#666' }} />
                         <RechartsTooltip formatter={(v:any) => `${Number(v).toFixed(1)}%`} />
                         <Bar dataKey="drift">
                            {bars.map((entry: any, index: number) => (<Cell key={index} fill={getDriftColor(entry.drift)} />))}
                         </Bar>
                      </BarChart>
                   </ResponsiveContainer>
                </div>
             </div>
           )
        })}
      </div>

      {/* DETAILED STRATEGY TABLES - Always Sub-Portfolios */}
      <div className="pt-8 border-t">
        <h2 className="text-xl md:text-2xl font-bold mb-6 flex items-center gap-2">
            Detailed Rebalancing Strategy
        </h2>
        <Accordion type="multiple" value={openItems} onValueChange={setOpenItems} className="space-y-4">
          {data.subPortfolios.map((sp: any) => {
             const spAllocations = data.currentAllocations.filter((a: any) => a.sub_portfolio_id === sp.id);
             const spValue = spAllocations.reduce((sum: number, a: any) => sum + a.current_value, 0);
             const spTarget = sp.target_allocation || 0;
             const spCurrent = data.totalValue > 0 ? (spValue / data.totalValue) * 100 : 0;
             
             return (
               <AccordionItem key={sp.id} value={sp.id} className="border rounded-lg overflow-hidden shadow-sm">
                  <AccordionTrigger className="bg-black text-white px-4 py-4 hover:bg-zinc-900 transition-colors">
                     <div className="flex flex-col md:flex-row md:justify-between w-full mr-4 gap-2 text-left">
                        <span className="font-bold text-lg">{sp.name}</span>
                        <div className="flex flex-wrap items-center gap-4 text-xs md:text-sm font-normal text-zinc-300">
                           <span className="bg-zinc-800 px-2 py-1 rounded text-white">{formatUSD(spValue)}</span>
                           <span>Current: <strong>{spCurrent.toFixed(1)}%</strong></span>
                           <span>Target: <strong>{spTarget.toFixed(1)}%</strong></span>
                        </div>
                     </div>
                  </AccordionTrigger>
                  <AccordionContent className="p-0 bg-background">
                    {/* Sub-Portfolio Level Controls */}
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-6 p-4 bg-muted/20 border-b">
                        <div className="space-y-1.5">
                            <Label className="text-[10px] uppercase font-bold text-muted-foreground flex items-center gap-1">
                                Sub-Portfolio Target % <Info className="w-3 h-3"/>
                            </Label>
                            <Input 
                                type="number" step="0.1" 
                                defaultValue={spTarget}
                                onBlur={(e) => updateSubPortfolio(sp.id, 'target_allocation', parseFloat(e.target.value))}
                                className="h-8 max-w-[120px]"
                            />
                        </div>
                        <div className="space-y-1.5">
                            <Label className="text-[10px] uppercase font-bold text-muted-foreground">Upside Threshold %</Label>
                            <Input 
                                type="number" step="1" 
                                defaultValue={sp.upside_threshold || 5}
                                onBlur={(e) => updateSubPortfolio(sp.id, 'upside_threshold', parseFloat(e.target.value))}
                                className="h-8 max-w-[120px]"
                            />
                        </div>
                        <div className="space-y-1.5">
                            <Label className="text-[10px] uppercase font-bold text-muted-foreground">Downside Threshold %</Label>
                            <Input 
                                type="number" step="1" 
                                defaultValue={sp.downside_threshold || 5}
                                onBlur={(e) => updateSubPortfolio(sp.id, 'downside_threshold', parseFloat(e.target.value))}
                                className="h-8 max-w-[120px]"
                            />
                        </div>
                    </div>

                    <div className="overflow-x-auto w-full">
                        <Table className="min-w-[1000px]">
                            <TableHeader>
                                <TableRow className="bg-muted/50 hover:bg-muted/50">
                                <TableHead className="w-[18%]">Asset</TableHead>
                                <TableHead className="w-[12%] text-right">Current Value ($)</TableHead>
                                <TableHead className="w-[10%] text-right">Current Weight</TableHead>
                                <TableHead className="w-[10%] text-right text-blue-600">Target Weight (editable)</TableHead>
                                <TableHead className="w-[10%] text-right">Implied Overall Target %</TableHead>
                                <TableHead className="w-[10%] text-right">Drift</TableHead>
                                <TableHead className="w-[10%] text-center">Action</TableHead>
                                <TableHead className="w-[20%] text-right">Tactical Execution Suggestion</TableHead>
                                </TableRow>
                            </TableHeader>
                            <TableBody>
                                {spAllocations.map((item: any) => (
                                <TableRow key={item.asset_id} className="hover:bg-muted/10">
                                    <TableCell className="w-[18%]">
                                        <div className="flex flex-col">
                                            <span className="font-bold">{item.ticker}</span>
                                            <span className="text-[10px] text-muted-foreground truncate max-w-[140px]">{item.name}</span>
                                        </div>
                                    </TableCell>
                                    <TableCell className="w-[12%] text-right tabular-nums">{formatUSD(item.current_value)}</TableCell>
                                    <TableCell className="w-[10%] text-right tabular-nums">{item.current_in_sp.toFixed(1)}%</TableCell>
                                    <TableCell className="w-[10%] text-right tabular-nums">
                                        <Input 
                                            type="number" step="0.1" 
                                            className="h-7 text-right w-16 ml-auto"
                                            defaultValue={item.sub_portfolio_target_percentage}
                                            onBlur={(e) => updateAssetTarget(item.asset_id, sp.id, parseFloat(e.target.value))}
                                        />
                                    </TableCell>
                                    <TableCell className="w-[10%] text-right tabular-nums">{item.implied_overall_target.toFixed(2)}%</TableCell>
                                    <TableCell className={cn("w-[10%] text-right tabular-nums font-semibold", item.drift_percentage > 0 ? "text-green-600" : "text-red-500")}>
                                        {item.drift_percentage.toFixed(1)}%
                                    </TableCell>
                                    <TableCell className="w-[10%] text-center tabular-nums font-bold">
                                        {item.action === 'hold' ? <span className="text-muted-foreground">-</span> : 
                                            <div className="flex flex-col leading-tight">
                                                <span className={item.action === 'buy' ? "text-green-600" : "text-red-600"}>
                                                    {item.action.toUpperCase()}
                                                </span>
                                                <span className="text-[10px] font-normal">{formatUSD(item.amount)}</span>
                                            </div>
                                        }
                                    </TableCell>
                                    <TableCell className="w-[20%] text-right text-[11px] font-medium leading-tight text-blue-800">
                                        {item.reinvestment_suggestions?.map((s: any, idx: number) => (
                                            <div key={idx}>Reallocate from {s.from_ticker}: {formatUSD(s.amount)}</div>
                                        )) || <span className="text-muted-foreground">-</span>}
                                    </TableCell>
                                </TableRow>
                                ))}
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
