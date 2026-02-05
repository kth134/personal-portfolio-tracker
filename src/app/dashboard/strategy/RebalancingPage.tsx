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
  { value: 'sub_portfolio', label: 'Sub-Portfolio' }
]

export default function RebalancingPage() {
  const [lens, setLens] = useState('total')
  const [aggregate, setAggregate] = useState(true)
  const [data, setData] = useState<any>(null)
  const [loading, setLoading] = useState(true)
  const [openItems, setOpenItems] = useState<string[]>([])

  useEffect(() => {
    fetchData()
  }, [])

  const fetchData = async () => {
    setLoading(true)
    try {
      const res = await fetch('/api/rebalancing', { cache: 'no-store' })
      const payload = await res.json()
      setData(payload)
      setOpenItems(payload.subPortfolios.map((p: any) => p.id))
    } catch (err) { console.error(err) } finally { setLoading(false) }
  }

  const updateSubPortfolio = async (id: string, field: string, value: number) => {
    const endpoint = '/api/rebalancing/sub-portfolio-target'
    await fetch(endpoint, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id, [field]: value }) })
    fetchData()
  }

  const updateAssetTarget = async (assetId: string, spId: string, value: number) => {
    await fetch('/api/rebalancing/asset-target', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ asset_id: assetId, sub_portfolio_id: spId, target_percentage: value }) })
    fetchData()
  }

  if (loading || !data) return <div className="p-8 text-center text-lg">Loading...</div>

  // Unified Data Logic for Charts
  const chartSlices = useMemo(() => {
    if (lens === 'total') {
      return [{ key: 'Portfolio', data: data.currentAllocations }]
    }
    const groups = new Map()
    data.currentAllocations.forEach((a: any) => {
      const k = a.sub_portfolio_name || 'Unassigned'
      if (!groups.has(k)) groups.set(k, [])
      groups.get(k).push(a)
    })
    return Array.from(groups.entries()).map(([key, items]) => ({ key, data: items }))
  }, [data, lens])

  return (
    <div className="space-y-8 p-4 max-w-[1400px] mx-auto">
      {/* Metrics Row */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <div className="bg-card p-4 rounded-lg border text-center">
            <Label className="text-xs uppercase text-muted-foreground">Portfolio Value</Label>
            <div className="text-2xl font-bold">{formatUSD(data.totalValue)}</div>
        </div>
        <div className="bg-card p-4 rounded-lg border text-center col-span-2">
            <Label className="text-xs uppercase text-muted-foreground">Net Cash Impact</Label>
            <div className={cn("text-2xl font-bold", data.cashNeeded < 0 ? "text-green-600" : "text-red-600")}>
                {-data.cashNeeded > 0 ? "+" : ""}{formatUSD(-data.cashNeeded)}
            </div>
        </div>
      </div>

      {/* Slicer */}
      <div className="flex gap-4 items-end border-b pb-4">
        <div className="w-64">
          <Label>View Lens</Label>
          <Select value={lens} onValueChange={setLens}>
            <SelectTrigger><SelectValue/></SelectTrigger>
            <SelectContent>{LENSES.map(l => <SelectItem key={l.value} value={l.value}>{l.label}</SelectItem>)}</SelectContent>
          </Select>
        </div>
      </div>

      {/* Charts Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {chartSlices.map((slice: any, idx: number) => (
          <div key={idx} className="bg-card p-6 rounded-lg border">
            <h3 className="font-bold text-center mb-4">{slice.key}</h3>
            <div className="h-[300px]">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={slice.data} layout="vertical" margin={{ left: 40 }}>
                  <CartesianGrid strokeDasharray="3 3" horizontal={false} />
                  <XAxis type="number" unit="%" domain={[-20, 20]} />
                  <YAxis dataKey="ticker" type="category" interval={0} fontSize={10} width={40} />
                  <RechartsTooltip />
                  <Bar dataKey="drift_percentage">
                    {slice.data.map((entry: any, i: number) => (
                      <Cell key={i} fill={Math.abs(entry.drift_percentage) > 5 ? '#ef4444' : '#10b981'} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>
        ))}
      </div>

      {/* Tables */}
      <Accordion type="multiple" value={openItems} onValueChange={setOpenItems}>
        {data.subPortfolios.map((sp: any) => {
          const items = data.currentAllocations.filter((a: any) => a.sub_portfolio_id === sp.id)
          return (
            <AccordionItem key={sp.id} value={sp.id} className="border rounded-lg mb-4 overflow-hidden">
              <AccordionTrigger className="bg-black text-white px-4 hover:bg-zinc-900">
                <div className="flex justify-between w-full mr-4">
                  <span>{sp.name}</span>
                  <span className="text-sm font-normal">{formatUSD(items.reduce((s:number, i:any) => s+i.current_value, 0))}</span>
                </div>
              </AccordionTrigger>
              <AccordionContent className="p-0">
                {/* Sub-Portfolio Inputs */}
                <div className="grid grid-cols-3 gap-4 p-4 bg-muted/20 border-b">
                   <div><Label className="text-[10px] uppercase">Target %</Label><Input defaultValue={sp.target_allocation} onBlur={(e) => updateSubPortfolio(sp.id, 'target_allocation', parseFloat(e.target.value))} className="h-8"/></div>
                   <div><Label className="text-[10px] uppercase">Upside %</Label><Input defaultValue={sp.upside_threshold} onBlur={(e) => updateSubPortfolio(sp.id, 'upside_threshold', parseFloat(e.target.value))} className="h-8"/></div>
                   <div><Label className="text-[10px] uppercase">Downside %</Label><Input defaultValue={sp.downside_threshold} onBlur={(e) => updateSubPortfolio(sp.id, 'downside_threshold', parseFloat(e.target.value))} className="h-8"/></div>
                </div>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="w-[15%]">Asset</TableHead>
                      <TableHead className="text-right w-[15%]">Value ($)</TableHead>
                      <TableHead className="text-right w-[10%]">Weight</TableHead>
                      <TableHead className="text-right w-[10%]">Target (Edit)</TableHead>
                      <TableHead className="text-right w-[10%]">Implied %</TableHead>
                      <TableHead className="text-right w-[10%]">Drift</TableHead>
                      <TableHead className="text-center w-[10%]">Action</TableHead>
                      <TableHead className="text-right w-[20%]">Suggest</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {items.map((i: any) => (
                      <TableRow key={i.asset_id}>
                        <TableCell className="font-bold">{i.ticker}</TableCell>
                        <TableCell className="text-right">{formatUSD(i.current_value)}</TableCell>
                        <TableCell className="text-right">{i.current_in_sp.toFixed(1)}%</TableCell>
                        <TableCell className="text-right"><Input defaultValue={i.sub_portfolio_target_percentage} onBlur={(e) => updateAssetTarget(i.asset_id, sp.id, parseFloat(e.target.value))} className="h-7 text-right w-16 ml-auto"/></TableCell>
                        <TableCell className="text-right">{i.implied_overall_target.toFixed(1)}%</TableCell>
                        <TableCell className={cn("text-right font-medium", i.drift_percentage > 0 ? "text-green-600" : "text-red-500")}>{i.drift_percentage.toFixed(1)}%</TableCell>
                        <TableCell className="text-center font-bold">{i.action === 'hold' ? '-' : i.action.toUpperCase()}</TableCell>
                        <TableCell className="text-right text-[10px] text-blue-800 leading-tight">
                          {i.reinvestment_suggestions?.map((s:any, idx:number) => <div key={idx}>From {s.from_ticker}: {formatUSD(s.amount)}</div>)}
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
  )
}
