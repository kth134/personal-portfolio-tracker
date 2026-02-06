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
import { Check, ChevronsUpDown, ArrowUpDown, RefreshCw } from 'lucide-react'
import { formatUSD } from '@/lib/formatters'
import { cn } from '@/lib/utils'
import { refreshAssetPrices } from './actions'

const COLORS = ['#3b82f6', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6', '#ec4899', '#06b6d4', '#14b8a6', '#f97316', '#a855f7']

const LENSES = [
  { value: 'total', label: 'Total Portfolio' },
  { value: 'sub_portfolio', label: 'Sub-Portfolio' },
  { value: 'account', label: 'Account' },
  { value: 'asset_type', label: 'Asset Type' },
  { value: 'asset_subtype', label: 'Asset Sub-Type' },
  { value: 'size_tag', label: 'Size' },
  { value: 'geography', label: 'Geography' },
  { value: 'factor_tag', label: 'Factor' },
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
        // Initial state: Empty openItems (Collapsed by default)
      } catch (err) { console.error(err) } finally { setLoading(false) }
    }
    loadData()
  }, [lens, selectedValues, aggregate, refreshTrigger])

  const totalValueAcrossSelection = useMemo(() => {
    return allocations.reduce((sum, a) => sum + (Number(a.value) || 0), 0) + cash
  }, [allocations, cash])

  if (loading && allocations.length === 0) {
    return <div className="p-8 text-center text-lg animate-pulse">Loading holdings...</div>
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap gap-4 items-end mb-4 bg-muted/20 p-4 rounded-lg">
        <div className="flex-1 min-w-[200px]">
          <Label className="text-xs uppercase font-bold mb-1 block">Slice by</Label>
          <Select value={lens} onValueChange={setLens}>
            <SelectTrigger className="w-full md:w-56 bg-background"><SelectValue /></SelectTrigger>
            <SelectContent>{LENSES.map(l => (
              <SelectItem key={l.value} value={l.value}>{l.label}</SelectItem>
            ))}</SelectContent>
          </Select>
        </div>

        {lens !== 'total' && selectedValues.length > 1 && (
          <div className="flex items-center gap-2 mb-2 p-2 border rounded bg-background">
            <Switch checked={aggregate} onCheckedChange={setAggregate} />
            <Label className="text-sm cursor-pointer whitespace-nowrap">Aggregate</Label>
          </div>
        )}

        <Button onClick={async () => {
          setRefreshing(true);
          await refreshAssetPrices();
          setRefreshTrigger(t => t + 1);
          setRefreshing(false);
        }} disabled={refreshing}>
          {refreshing ? 'Refreshing...' : 'Refresh Prices'}
        </Button>
      </div>

      <div className="flex flex-wrap gap-8 justify-center">
        {pieAllocations.map((slice, idx) => (
          <div key={idx} className="bg-card p-4 rounded-xl border shadow-sm space-y-4 min-w-[300px] flex-1 max-w-[500px]">
            <h4 className="font-bold text-center border-b pb-2 text-sm uppercase">{slice.key}</h4>
            <ResponsiveContainer width="100%" height={300}>
              <PieChart>
                <Pie data={slice.data} dataKey="value" nameKey="subkey" outerRadius={100} label={({ percent }) => `${((percent || 0) * 100).toFixed(0)}%`}>
                  {slice.data.map((_: any, i: number) => (<Cell key={i} fill={COLORS[i % COLORS.length]} />))}
                </Pie>
                <Tooltip formatter={(v: any) => formatUSD(v)} />
                <Legend />
              </PieChart>
            </ResponsiveContainer>
          </div>
        ))}
      </div>

      <Accordion type="multiple" value={openItems} onValueChange={setOpenItems} className="space-y-4">
        {[...allocations]
           .map(g => {
             const cashVal = lens === 'account' ? (cashByAccountName.get(g.key) || 0) : 0;
             return { ...g, totalGroupVal: Number(g.value) + cashVal };
           })
           .sort((a,b) => b.totalGroupVal - a.totalGroupVal)
           .map((group) => {
          const groupWeight = totalValueAcrossSelection > 0 ? (group.totalGroupVal / totalValueAcrossSelection) * 100 : 0

          return (
            <AccordionItem key={group.key} value={group.key} className="border rounded-lg overflow-hidden shadow-sm">
              <AccordionTrigger className="bg-black text-white px-4 py-4 hover:bg-zinc-900 transition-colors">
                <div className="flex justify-between w-full mr-4 text-left">
                  <span className="font-bold text-white uppercase">{group.key}</span>
                  <div className="flex gap-4 text-xs sm:text-sm font-bold text-white">
                    <span>Basis: {formatUSD(group.cost_basis)}</span>
                    <span className="opacity-60">|</span>
                    <span>Value: {formatUSD(group.totalGroupVal)}</span>
                    <span className="opacity-60">|</span>
                    <span>{groupWeight.toFixed(2)}%</span>
                  </div>
                </div>
              </AccordionTrigger>
              <AccordionContent className="p-0 overflow-x-auto">
                <Table className="min-w-[800px] table-fixed">
                  <TableHeader>
                    <TableRow className="bg-muted/50">
                      <TableHead className="w-[40%]">Asset</TableHead>
                      <TableHead className="w-[20%] text-right">Total Cost Basis</TableHead>
                      <TableHead className="w-[20%] text-right">Current Value</TableHead>
                      <TableHead className="w-[20%] text-right">Weight (Portfolio)</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {[...(group.items || [])]
                      .sort((a,b) => b.value - a.value)
                      .map((item: any) => {
                      const itemValue = Number(item.value) || 0
                      const itemWeight = totalValueAcrossSelection > 0 ? (itemValue / totalValueAcrossSelection) * 100 : 0
                      return (
                        <TableRow key={item.ticker}>
                          <TableCell className="w-[40%]"><div className="font-bold">{item.ticker}</div><div className="text-[10px] opacity-70">{item.name}</div></TableCell>
                          <TableCell className="w-[20%] text-right tabular-nums">{formatUSD(item.cost_basis)}</TableCell>
                          <TableCell className="w-[20%] text-right tabular-nums font-bold">{formatUSD(itemValue)}</TableCell>
                          <TableCell className="w-[20%] text-right tabular-nums">{itemWeight.toFixed(2)}%</TableCell>
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
