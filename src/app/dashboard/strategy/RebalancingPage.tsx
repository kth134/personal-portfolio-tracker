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
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from '@/components/ui/accordion'
import { Popover, PopoverTrigger, PopoverContent } from '@/components/ui/popover'
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from '@/components/ui/command'
import { Check, ChevronsUpDown, AlertTriangle } from 'lucide-react'
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

  // Fetch distinct values for multi-select
  useEffect(() => {
    if (lens === 'total') {
      setAvailableValues([])
      setSelectedValues([])
      return
    }
    const fetchVals = async () => {
      const res = await fetch('/api/dashboard/values', { method: 'POST', body: JSON.stringify({ lens }) })
      const payload = await res.json()
      setAvailableValues(payload.values || [])
      setSelectedValues((payload.values || []).map((v: any) => v.value))
    }
    fetchVals()
  }, [lens])

  // Load backend data (Static Table Data)
  useEffect(() => {
    const fetchData = async () => {
      setLoading(true)
      try {
        const res = await fetch('/api/rebalancing')
        const payload = await res.json()
        setData(payload)
        setOpenItems(payload.subPortfolios.map((p: any) => p.id))
      } catch (err) { console.error(err) } finally { setLoading(false) }
    }
    fetchData()
  }, [])

  // Load Chart Data (Dynamic Sliced Data)
  useEffect(() => {
    const loadCharts = async () => {
      const res = await fetch('/api/dashboard/allocations', {
        method: 'POST',
        body: JSON.stringify({ 
          lens, 
          selectedValues: lens === 'total' ? [] : selectedValues,
          aggregate 
        })
      })
      const payload = await res.json()
      setChartData(payload.allocations || [])
    }
    loadCharts()
  }, [lens, selectedValues, aggregate])

  const toggleValue = (value: string) => {
    setSelectedValues(prev => prev.includes(value) ? prev.filter(v => v !== value) : [...prev, value])
  }

  if (loading || !data) return <div className="p-8 text-center text-lg">Loading rebalancing insights...</div>

  // SUMMARY CALCULATIONS
  const rebalanceNeeded = data.currentAllocations.some((a: any) => a.action !== 'hold')
  const netImpact = -data.cashNeeded // Inverse sign: + means cash generated (sells > buys)

  const getDriftColor = (drift: number) => {
    const abs = Math.abs(drift)
    if (abs <= 5) return '#10b981'
    if (abs <= 20) return '#f59e0b'
    return '#ef4444'
  }

  return (
    <div className="space-y-8 p-4">
      {/* Summary Row */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <div className="bg-card p-4 rounded-lg border text-center">
          <h3 className="text-xs uppercase font-semibold text-muted-foreground mb-1">Portfolio Value</h3>
          <div className="text-2xl font-bold">{formatUSD(data.totalValue)}</div>
        </div>
        <div className="bg-card p-4 rounded-lg border text-center">
          <h3 className="text-xs uppercase font-semibold text-muted-foreground mb-1">Rebalance Status</h3>
          <div className={cn("text-2xl font-bold flex items-center justify-center", rebalanceNeeded ? "text-yellow-600" : "text-green-600")}>
            {rebalanceNeeded ? <><AlertTriangle className="w-5 h-5 mr-2" /> Action Needed</> : "All Good"}
          </div>
        </div>
        <div className="bg-card p-4 rounded-lg border text-center col-span-2">
          <h3 className="text-xs uppercase font-semibold text-muted-foreground mb-1">Net Cash Impact of Suggested Trades</h3>
          <div className={cn("text-2xl font-bold", netImpact > 0 ? "text-green-600" : (netImpact < 0 ? "text-red-600" : ""))}>
            {netImpact > 0 ? "+" : ""}{formatUSD(netImpact)}
          </div>
        </div>
      </div>

      {/* Slicers & Controls (Restored) */}
      <div className="flex flex-wrap gap-4 items-end mb-4 border-b pb-4">
        <div>
          <Label className="text-xs font-bold uppercase mb-1 block">View Lens</Label>
          <Select value={lens} onValueChange={setLens}>
            <SelectTrigger className="w-56"><SelectValue /></SelectTrigger>
            <SelectContent>{LENSES.map(l => (<SelectItem key={l.value} value={l.value}>{l.label}</SelectItem>))}</SelectContent>
          </Select>
        </div>

        {lens !== 'total' && (
          <div className="min-w-64">
            <Label className="text-xs font-bold uppercase mb-1 block">Filter Selection</Label>
            <Popover>
              <PopoverTrigger asChild>
                <Button variant="outline" className="w-full justify-between">
                  {selectedValues.length === availableValues.length ? 'All selected' : `${selectedValues.length} selected`}
                  <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-full p-0">
                <Command>
                  <CommandInput placeholder="Search..." />
                  <CommandList>
                    <CommandEmpty>No values found.</CommandEmpty>
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
          <div className="flex items-center gap-2 mb-2">
            <Switch checked={aggregate} onCheckedChange={setAggregate} />
            <Label>Aggregate charts</Label>
          </div>
        )}
      </div>

      {/* Visualizations - Reintroduced Slicing Logic */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {chartData.map((slice, idx) => {
           // Flatten drift data for bars
           const bars = slice.data.map((d: any) => {
              const drift = d.percentage - d.target_pct
              return { name: d.subkey, drift, current: d.percentage, target: d.target_pct }
           }).sort((a:any, b:any) => b.drift - a.drift)

           return (
             <div key={idx} className="bg-card p-6 rounded-lg border space-y-4">
                <h3 className="font-bold text-center">{slice.key}</h3>
                <div className="grid grid-cols-2 gap-4 h-[300px]">
                   <ResponsiveContainer width="100%" height="100%">
                      <PieChart>
                         <Pie data={slice.data} dataKey="value" nameKey="subkey" outerRadius={80} label={({ percent }) => `${(percent * 100).toFixed(0)}%`}>
                            {slice.data.map((_: any, i: number) => (<Cell key={i} fill={COLORS[i % COLORS.length]} />))}
                         </Pie>
                         <RechartsTooltip formatter={(v: any) => formatUSD(v)} />
                      </PieChart>
                   </ResponsiveContainer>
                   <ResponsiveContainer width="100%" height="100%">
                      <BarChart data={bars} layout="vertical">
                         <CartesianGrid strokeDasharray="3 3" horizontal={false} />
                         <XAxis type="number" unit="%" hide />
                         <YAxis type="category" dataKey="name" interval={0} width={60} fontSize={10} />
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

      {/* Strategy Table (Always sub-portfolios) */}
      <div className="pt-8 border-t">
        <h2 className="text-xl font-bold mb-4">Detailed Rebalancing Strategy</h2>
        <Accordion type="multiple" value={openItems} onValueChange={setOpenItems}>
          {data.subPortfolios.map((sp: any) => {
             const spAllocations = data.currentAllocations.filter((a: any) => a.sub_portfolio_id === sp.id)
             const spValue = spAllocations.reduce((sum: number, a: any) => sum + a.current_value, 0)
             const spTarget = sp.target_allocation || 0
             const spCurrent = data.totalValue > 0 ? (spValue / data.totalValue) * 100 : 0
             
             return (
               <AccordionItem key={sp.id} value={sp.id}>
                  <AccordionTrigger className="bg-black text-white px-4 py-2 hover:bg-gray-800">
                     <div className="flex justify-between w-full mr-4">
                        <span className="font-semibold">{sp.name}</span>
                        <span className="text-sm">{formatUSD(spValue)} | {spCurrent.toFixed(1)}% (Target: {spTarget.toFixed(1)}%)</span>
                     </div>
                  </AccordionTrigger>
                  <AccordionContent className="p-0">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead className="w-[20%]">Asset</TableHead>
                          <TableHead className="w-[20%] text-right">Weight (SP / Target)</TableHead>
                          <TableHead className="w-[15%] text-right">Drift %</TableHead>
                          <TableHead className="w-[15%] text-center">Action</TableHead>
                          <TableHead className="w-[30%] text-right">Draft Reinvestment Suggestion</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {spAllocations.map((item: any) => (
                          <TableRow key={item.asset_id}>
                            <TableCell className="w-[20%]"><div className="font-bold">{item.ticker}</div><div className="text-xs text-muted-foreground">{item.name}</div></TableCell>
                            <TableCell className="w-[20%] text-right">{item.current_in_sp.toFixed(1)}% / {item.sub_portfolio_target_percentage.toFixed(1)}%</TableCell>
                            <TableCell className={cn("w-[15%] text-right font-medium", item.drift_percentage > 0 ? "text-green-600" : "text-red-600")}>{item.drift_percentage.toFixed(1)}%</TableCell>
                            <TableCell className="w-[15%] text-center font-bold">
                               {item.action === 'hold' ? '-' : item.action.toUpperCase()}
                               {item.action !== 'hold' && <div className="text-xs font-normal">{formatUSD(item.amount)}</div>}
                            </TableCell>
                            <TableCell className="w-[30%] text-right">
                               {item.reinvestment_suggestions?.map((s: any, idx: number) => (
                                  <div key={idx} className="text-xs text-blue-700">From {s.from_ticker}: {formatUSD(s.amount)}</div>
                               ))}
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </AccordionContent>
               </AccordionItem>
             )
          })}
        </Accordion>
      </div>
    </div>
  )
}
