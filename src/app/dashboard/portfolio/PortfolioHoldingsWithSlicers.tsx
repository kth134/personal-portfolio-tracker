'use client'

import { useState, useEffect, useMemo } from 'react'
import {
  PieChart, Pie, Cell, ResponsiveContainer, Tooltip, Legend,
} from 'recharts'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'
import { Label } from '@/components/ui/label'
import { Button } from '@/components/ui/button'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from '@/components/ui/accordion'
import { Popover, PopoverTrigger, PopoverContent } from '@/components/ui/popover'
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from '@/components/ui/command'
import { Check, ChevronsUpDown } from 'lucide-react'
import { formatUSD } from '@/lib/formatters'
import { cn } from '@/lib/utils'
import { refreshAssetPrices } from './actions'

const COLORS = ['#3b82f6', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6', '#ec4899', '#06b6d4', '#14b8a6', '#f97316', '#a855f7']

const LENSES = [
  { value: 'total', label: 'Total Portfolio' },
  { value: 'sub_portfolio', label: 'Sub-Portfolio' },
  { value: 'account', label: 'Account' },
  { value: 'asset_type', label: 'Asset Type' },
]

export default function PortfolioHoldingsWithSlicers({
  cash,
  cashByAccountName,
}: {
  cash: number
  cashByAccountName: Map<string, number>
}) {
  const [lens, setLens] = useState('total')
  const [availableValues, setAvailableValues] = useState<{value: string, label: string}[]>([])
  const [selectedValues, setSelectedValues] = useState<string[]>([])
  const [aggregate, setAggregate] = useState(true)
  const [allocations, setAllocations] = useState<any[]>([])
  const [pieAllocations, setPieAllocations] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [refreshMessage, setRefreshMessage] = useState<string | null>(null)
  const [refreshTrigger, setRefreshTrigger] = useState(0)
  const [openItems, setOpenItems] = useState<string[]>([])

  useEffect(() => {
    if (lens === 'total') {
      setAvailableValues([])
      setSelectedValues([])
      return
    }
    const fetchValues = async () => {
      try {
        const res = await fetch('/api/dashboard/values', { method: 'POST', body: JSON.stringify({ lens }) })
        const data = await res.json()
        setAvailableValues(data.values || [])
        setSelectedValues((data.values || []).map((v: any) => v.value))
      } catch (err) { console.error(err) }
    }
    fetchValues()
  }, [lens])

  useEffect(() => {
    const loadData = async () => {
      setLoading(true)
      try {
        const payload = { lens, selectedValues: lens === 'total' ? [] : selectedValues, aggregate }
        const [pieRes, tableRes] = await Promise.all([
          fetch('/api/dashboard/allocations', { method: 'POST', body: JSON.stringify(payload), cache: 'no-store' }),
          fetch('/api/dashboard/allocations', { method: 'POST', body: JSON.stringify({ ...payload, aggregate: false }), cache: 'no-store' })
        ])
        const [pieData, tableData] = await Promise.all([pieRes.json(), tableRes.json()])
        setPieAllocations(pieData.allocations || [])
        setAllocations(tableData.allocations || [])
        setOpenItems((tableData.allocations || []).map((a: any) => a.key))
      } catch (err) { console.error(err) } finally { setLoading(false) }
    }
    loadData()
  }, [lens, selectedValues, aggregate, refreshTrigger])

  const totalValueAcrossSelection = useMemo(() => {
    return allocations.reduce((sum, a) => sum + (Number(a.value) || 0), 0) + cash
  }, [allocations, cash])

  return (
    <div className="space-y-4 md:space-y-8 p-2 md:p-4 max-w-[1600px] mx-auto overflow-x-hidden">
      {/* Controls Container - Responsive */}
      <div className="flex flex-wrap gap-4 items-end mb-4 bg-muted/20 p-4 rounded-lg">
        <div className="flex-1 min-w-[200px] md:min-w-0">
          <Label className="text-xs font-bold uppercase mb-1 block">Slice by</Label>
          <Select value={lens} onValueChange={setLens}>
            <SelectTrigger className="w-full md:w-56 bg-background"><SelectValue /></SelectTrigger>
            <SelectContent>{LENSES.map(l => (<SelectItem key={l.value} value={l.value}>{l.label}</SelectItem>))}</SelectContent>
          </Select>
        </div>

        {lens !== 'total' && (
          <div className="flex-1 min-w-[220px] md:min-w-0">
            <Label className="text-xs font-bold uppercase mb-1 block">Select {LENSES.find(l => l.value === lens)?.label}s</Label>
            <Popover>
              <PopoverTrigger asChild>
                <Button variant="outline" className="w-full md:w-64 justify-between bg-background">
                  {selectedValues.length === availableValues.length ? 'All selected' : `${selectedValues.length} selected`}
                  <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-full p-0"><Command><CommandInput placeholder="Search..." /><CommandList><CommandEmpty>None.</CommandEmpty><CommandGroup>{availableValues.map(item => (<CommandItem key={item.value} onSelect={() => setSelectedValues(prev => prev.includes(item.value) ? prev.filter(v => v !== item.value) : [...prev, item.value])}><Check className={cn("mr-2 h-4 w-4", selectedValues.includes(item.value) ? "opacity-100" : "opacity-0")} />{item.label}</CommandItem>))}</CommandGroup></CommandList></Command></PopoverContent>
            </Popover>
          </div>
        )}

        {lens !== 'total' && selectedValues.length > 1 && (
          <div className="flex items-center gap-2 mb-2 p-2 border rounded bg-background">
            <Switch checked={aggregate} onCheckedChange={setAggregate} />
            <Label className="text-sm cursor-pointer whitespace-nowrap">Aggregate charts</Label>
          </div>
        )}

        <Button onClick={async () => {
          setRefreshing(true);
          await refreshAssetPrices();
          setRefreshTrigger(t => t + 1);
          setRefreshing(false);
        }} disabled={refreshing} className="mb-0.5">
          {refreshing ? 'Hold...' : 'Refresh Prices'}
        </Button>
      </div>

      {/* Pie Charts Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-8">
        {pieAllocations.map((slice, idx) => (
          <div key={idx} className="bg-card p-4 rounded-xl border shadow-sm space-y-4">
            <h4 className="font-bold text-center border-b pb-2 text-sm uppercase tracking-tight truncate px-2" title={slice.key}>{slice.key}</h4>
            <div className="h-[300px] w-full">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart margin={{ top: 20, right: 20, bottom: 20, left: 20 }}>
                  <Pie 
                    data={slice.data} 
                    dataKey="value" 
                    nameKey="subkey" 
                    outerRadius="70%" 
                    labelLine={true}
                    label={({ percent }) => `${((percent || 0) * 100).toFixed(0)}%`}
                  >
                    {slice.data.map((_: any, i: number) => (<Cell key={i} fill={COLORS[i % COLORS.length]} strokeWidth={1} />))}
                  </Pie>
                  <Tooltip formatter={(v: any) => formatUSD(v)} />
                  <Legend iconType="circle" wrapperStyle={{ fontSize: '10px', paddingTop: '10px' }} />
                </PieChart>
              </ResponsiveContainer>
            </div>
          </div>
        ))}
      </div>

      {/* Holdings Tables */}
      <Accordion type="multiple" value={openItems} onValueChange={setOpenItems} className="space-y-4">
        {[...allocations]
          .map(group => {
            const groupVal = Number(group.value) || 0;
            const cashVal = lens === 'account' ? (cashByAccountName.get(group.key) || 0) : 0;
            return { ...group, totalGroupVal: groupVal + cashVal };
          })
          .sort((a, b) => b.totalGroupVal - a.totalGroupVal)
          .map((group) => {
            const totalGroupVal = group.totalGroupVal;
            const groupWeight = totalValueAcrossSelection > 0 ? (totalGroupVal / totalValueAcrossSelection) * 100 : 0;

              <AccordionItem key={group.key} value={group.key} className="border rounded-lg overflow-hidden shadow-sm">
                <AccordionTrigger className="bg-black text-white px-0 py-4 hover:bg-zinc-900 transition-colors">
                  <div className="flex items-center w-full text-left gap-0">
                    <span className="w-[30%] sm:w-[25%] px-4 font-bold text-white truncate">{group.key}</span>
                    <div className="flex-1 flex items-center text-xs sm:text-sm font-bold text-white">
                      <span className="w-[33.3%] text-right pr-4 sm:pr-8">Basis: {formatUSD(Number(group.cost_basis) || 0)}</span>
                      <span className="w-[33.3%] text-right pr-4 sm:pr-8">Value: {formatUSD(totalGroupVal)}</span>
                      <span className="w-[33.4%] text-right pr-4 sm:px-4">{groupWeight.toFixed(2)}%</span>
                    </div>
                  </div>
                </AccordionTrigger>
                <AccordionContent className="p-0 overflow-x-auto">
                  <Table className="min-w-[700px] sm:min-w-full table-fixed">
                    <TableHeader>
                      <TableRow className="bg-muted/50">
                        <TableHead className="w-[30%] sm:w-[25%] px-4">Asset</TableHead>
                        <TableHead className="w-[23%] sm:w-[25%] text-right font-semibold">Total Cost Basis</TableHead>
                        <TableHead className="w-[23%] sm:w-[25%] text-right font-semibold">Current Value</TableHead>
                        <TableHead className="w-[23%] sm:w-[25%] text-right font-semibold px-4">Weight</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {[...(group.items || [])]
                        .sort((a, b) => (Number(b.value) || 0) - (Number(a.value) || 0))
                        .map((item: any) => {
                          const v = Number(item.value) || 0;
                          const w = totalValueAcrossSelection > 0 ? (v / totalValueAcrossSelection) * 100 : 0;
                          return (
                            <TableRow key={item.ticker}>
                              <TableCell className="w-[30%] sm:w-[25%] px-4">
                                <div className="font-bold leading-tight">{item.ticker}</div>
                                <div className="text-[10px] sm:text-[11px] opacity-70 truncate max-w-[150px] sm:max-w-none" title={item.name}>{item.name}</div>
                              </TableCell>
                              <TableCell className="w-[23%] sm:w-[25%] text-right tabular-nums text-xs sm:text-sm">{formatUSD(item.cost_basis)}</TableCell>
                              <TableCell className="w-[23%] sm:w-[25%] text-right tabular-nums font-medium text-xs sm:text-sm">{formatUSD(v)}</TableCell>
                              <TableCell className="w-[23%] sm:w-[25%] text-right tabular-nums px-4 text-xs sm:text-sm">{w.toFixed(2)}%</TableCell>
                            </TableRow>
                          )
                        })}
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
