'use client'

import { useState, useEffect, useMemo, createContext, useContext, useCallback } from 'react'
import {
  PieChart, Pie, Cell, ResponsiveContainer, Tooltip as RechartsTooltip, Legend,
  BarChart, Bar, XAxis, YAxis, CartesianGrid,
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
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'
import { Check, ChevronsUpDown, ArrowUpDown, RefreshCw, Download, AlertTriangle } from 'lucide-react'
import { formatUSD } from '@/lib/formatters'
import { cn } from '@/lib/utils'
import { refreshAssetPrices } from '../portfolio/actions'

const COLORS = ['#3b82f6', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6', '#ec4899', '#06b6d4', '#14b8a6', '#f97316', '#a855f7']

const LENSES = [
  { value: 'total', label: 'Assets' },
  { value: 'sub_portfolio', label: 'Sub-Portfolio' },
  { value: 'asset_type', label: 'Asset Type' },
  { value: 'asset_subtype', label: 'Asset Sub-Type' },
  { value: 'geography', label: 'Geography' },
  { value: 'size_tag', label: 'Size' },
  { value: 'factor_tag', label: 'Factor' },
]

export default function RebalancingPage() {
  function RecommendedAccountsPopover({ accounts }: { accounts: any[] }) {
    if (!accounts || accounts.length === 0) return <span>-</span>
    return (
      <Popover>
        <PopoverTrigger asChild>
          <div className="cursor-pointer text-xs underline decoration-dotted">View Recommendations ({accounts.length})</div>
        </PopoverTrigger>
        <PopoverContent className="w-72 p-2">
          {accounts.map((acc, idx) => (
             <div key={idx} className="border-b last:border-0 p-1 text-sm">
                <strong>{acc.name}</strong>: {formatUSD(acc.amount)}
             </div>
          ))}
        </PopoverContent>
      </Popover>
    )
  }

  const [lens, setLens] = useState('total')
  const [selectedValues, setSelectedValues] = useState<string[]>([])
  const [aggregate, setAggregate] = useState(true)
  const [data, setData] = useState<any>(null)
  const [loading, setLoading] = useState(true)
  const [barMode, setBarMode] = useState<'divergent' | 'stacked'>('divergent')
  const [openItems, setOpenItems] = useState<string[]>([])

  useEffect(() => {
    const fetchData = async () => {
      setLoading(true)
      try {
        const res = await fetch('/api/rebalancing')
        const payload = await res.json()
        setData(payload)
        setOpenItems(payload.subPortfolios.map((p: any) => p.id))
      } catch (err) {
        console.error(err)
      } finally {
        setLoading(false)
      }
    }
    fetchData()
  }, [])

  const magnitude = useMemo(() => data?.cashNeeded || 0, [data])
  
  if (loading || !data) return <div className="p-8 text-center">Loading strategy insights...</div>

  // Visualizations logic
  const chartData = data.currentAllocations.map((a: any) => ({
    name: a.ticker,
    current: a.current_percentage || 0,
    target: a.implied_overall_target || 0,
    drift: a.drift_percentage || 0,
    sub_portfolio_id: a.sub_portfolio_id
  }))

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
          <h3 className="text-sm font-medium text-muted-foreground">Portfolio Value</h3>
          <div className="text-2xl font-bold">{formatUSD(data.totalValue)}</div>
        </div>
        <div className="bg-card p-4 rounded-lg border text-center">
          <h3 className="text-sm font-medium text-muted-foreground">Cash Needed</h3>
          <div className={cn("text-2xl font-bold", magnitude > 0 ? "text-green-600" : (magnitude < 0 ? "text-red-600" : ""))}>
            {formatUSD(magnitude)}
          </div>
        </div>
      </div>

      {/* Visualizations View */}
      <div className="bg-card p-6 rounded-lg border space-y-6">
        <h3 className="text-lg font-semibold">Allocation & Drift Analysis</h3>
        <div className="h-[400px] w-full">
           <ResponsiveContainer width="100%" height="100%">
             <BarChart data={chartData.filter((c:any) => Math.abs(c.drift) > 0.1).sort((a:any, b:any) => b.drift - a.drift)} layout="vertical" margin={{ left: 40 }}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis type="number" unit="%" />
                <YAxis type="category" dataKey="name" width={60} />
                <RechartsTooltip formatter={(v:any) => `${Number(v).toFixed(2)}%`} />
                <Bar dataKey="drift" label={{ position: 'right', formatter: (v:any) => `${v.toFixed(1)}%` }}>
                   {chartData.map((entry: any, index: number) => (
                     <Cell key={`cell-${index}`} fill={getDriftColor(entry.drift)} />
                   ))}
                </Bar>
             </BarChart>
           </ResponsiveContainer>
        </div>
      </div>

      {/* Strategy Table */}
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
                      <span>{sp.name}</span>
                      <span className="text-sm">{formatUSD(spValue)} | {spCurrent.toFixed(1)}% (Target: {spTarget.toFixed(1)}%)</span>
                   </div>
                </AccordionTrigger>
                <AccordionContent className="p-0">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Asset</TableHead>
                        <TableHead className="text-right">Weight</TableHead>
                        <TableHead className="text-right">Drift</TableHead>
                        <TableHead className="text-center">Action</TableHead>
                        <TableHead className="text-right">Reinvestment Suggestion</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {spAllocations.map((item: any) => (
                        <TableRow key={item.asset_id}>
                          <TableCell>
                             <div className="font-bold">{item.ticker}</div>
                             <div className="text-xs text-muted-foreground">{item.name}</div>
                          </TableCell>
                          <TableCell className="text-right">
                             {item.current_in_sp.toFixed(2)}% / {item.sub_portfolio_target_percentage.toFixed(2)}%
                          </TableCell>
                          <TableCell className={cn("text-right font-medium", item.drift_percentage > 0 ? "text-green-600" : "text-red-600")}>
                             {item.drift_percentage.toFixed(2)}%
                          </TableCell>
                          <TableCell className="text-center font-bold">
                             {item.action === 'hold' ? '-' : item.action.toUpperCase()}
                             {item.action !== 'hold' && <div className="text-xs font-normal">{formatUSD(item.amount)}</div>}
                             <RecommendedAccountsPopover accounts={item.recommended_accounts || []} />
                          </TableCell>
                          <TableCell className="text-right">
                             {item.reinvestment_suggestions?.map((s: any, idx: number) => (
                                <div key={idx} className="text-xs text-blue-700">
                                   From {s.from_ticker}: {formatUSD(s.amount)}
                                </div>
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
  )
}
