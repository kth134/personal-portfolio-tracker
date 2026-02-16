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
  const [itemSorts, setItemSorts] = useState<Record<string, { key: string; dir: 'asc' | 'desc' }>>({})

  const toggleItemSort = (groupKey: string, sortKey: string) => {
    setItemSorts((prev) => {
      const cur = prev[groupKey]
      if (cur && cur.key === sortKey) {
        const nextDir = cur.dir === 'desc' ? 'asc' : 'desc'
        return { ...prev, [groupKey]: { key: sortKey, dir: nextDir } }
      }
      return { ...prev, [groupKey]: { key: sortKey, dir: 'desc' } }
    })
  }

  const renderSortIndicator = (sortSpec: { key: string; dir: 'asc' | 'desc' } | undefined, col: string) => {
    return (
      <ArrowUpDown className={cn("ml-1 h-3 w-3 inline cursor-pointer", (sortSpec && sortSpec.key === col) ? "text-blue-600" : "text-zinc-400")} />
    )
  }

  const getItemRemainingQuantity = (item: unknown) => {
    if (!item) return 0

    const itemRecord = item as Record<string, unknown>

    const directRemainingQty =
      itemRecord.remaining_quantity ??
      itemRecord.remainingQuantity ??
      itemRecord.quantity_remaining ??
      itemRecord.quantityRemaining

    if (directRemainingQty !== undefined && directRemainingQty !== null && directRemainingQty !== '') {
      return Number(directRemainingQty) || 0
    }

    const activeLots = Array.isArray(itemRecord.active_tax_lots)
      ? itemRecord.active_tax_lots
      : Array.isArray(itemRecord.tax_lots)
        ? itemRecord.tax_lots
        : []

    if (activeLots.length > 0) {
      return activeLots.reduce((sum: number, lot: unknown) => {
        const lotRecord = lot as Record<string, unknown>
        const lotRemainingQty =
          lotRecord.remaining_quantity ??
          lotRecord.remainingQuantity ??
          lotRecord.quantity_remaining ??
          lotRecord.quantityRemaining ??
          lotRecord.quantity ??
          0
        return sum + (Number(lotRemainingQty) || 0)
      }, 0)
    }

    return Number(itemRecord.quantity) || 0
  }

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
        const vals = data.values || []
        setAvailableValues(vals)
        // `allocations` groups `account` and `sub_portfolio` by display name,
        // while `values` returns ids for those lenses. Use labels to match.
        setSelectedValues(
          vals.map((v: any) => (lens === 'account' || lens === 'sub_portfolio') ? (v.label ?? v.value) : v.value)
        )
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

  const normalizedPieSlices = useMemo(() => {
    const source = (Array.isArray(pieAllocations) && pieAllocations.length > 0) ? pieAllocations : allocations;
    return (source || []).map((slice: any) => {
      let dataArr: any[] = [];
      if (Array.isArray(slice.data) && slice.data.length > 0) {
        dataArr = slice.data.map((d: any) => ({ subkey: d.subkey ?? d.name ?? d.ticker ?? 'Unknown', value: Number(d.value) || 0 }))
      } else if (Array.isArray(slice.items) && slice.items.length > 0) {
        dataArr = slice.items.map((i: any) => ({ subkey: i.ticker ?? i.name ?? 'Unknown', value: Number(i.value) || 0 }))
      } else if (typeof slice.value === 'number' || slice.value) {
        // Single-group aggregate: show the group's own value as one slice
        dataArr = [{ subkey: slice.key ?? 'Value', value: Number(slice.value) || 0 }]
      }
      return { ...slice, data: dataArr };
    });
  }, [pieAllocations, allocations]);

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
        {normalizedPieSlices.map((slice, idx) => {
          const sliceData = Array.isArray(slice.data) ? slice.data : [];
          if (!sliceData || sliceData.length === 0) return null;
          return (
            <div key={idx} className={cn("bg-card p-4 rounded-xl border shadow-sm space-y-4 min-w-[300px] flex-1", normalizedPieSlices.length === 1 ? "w-full max-w-none" : "max-w-[500px]")}> 
              <h4 className="font-bold text-center border-b pb-2 text-sm uppercase">{slice.key}</h4>
              <ResponsiveContainer width="100%" height={300}>
                <PieChart>
                  <Pie data={sliceData} dataKey="value" nameKey="subkey" outerRadius={100} label={({ percent }) => `${((percent || 0) * 100).toFixed(0)}%`}>
                    {sliceData.map((_: any, i: number) => (<Cell key={i} fill={COLORS[i % COLORS.length]} />))}
                  </Pie>
                  <Tooltip formatter={(v: any) => formatUSD(v)} />
                  <Legend />
                </PieChart>
              </ResponsiveContainer>
            </div>
          )
        })}
      </div>

      <Accordion type="multiple" value={openItems} onValueChange={setOpenItems} className="space-y-4">
        {[...allocations]
           .map(g => {
             let cashVal = 0
             if (lens === 'account') {
               // `cashByAccountName` may be a Map on the server, but serialized
               // props can arrive as plain objects in the client. Support both.
               if (cashByAccountName instanceof Map) {
                 cashVal = cashByAccountName.get(g.key) || 0
               } else if (cashByAccountName && typeof cashByAccountName === 'object') {
                 cashVal = (cashByAccountName as any)[g.key] || 0
               }
             }
             return { ...g, totalGroupVal: Number(g.value) + cashVal };
           })
           .sort((a,b) => b.totalGroupVal - a.totalGroupVal)
           .map((group) => {
          const groupWeight = totalValueAcrossSelection > 0 ? (group.totalGroupVal / totalValueAcrossSelection) * 100 : 0

          return (
            <AccordionItem key={String(group.key)} value={String(group.key)} className="border rounded-lg overflow-hidden shadow-sm">
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
              <AccordionContent className="p-0 overflow-x-auto overscroll-x-contain [-webkit-overflow-scrolling:touch]">
                <Table className="w-full min-w-[760px] table-fixed">
                  <colgroup>
                    <col className="w-[34%]" />
                    <col className="w-[14%]" />
                    <col className="w-[18%]" />
                    <col className="w-[18%]" />
                    <col className="w-[16%]" />
                  </colgroup>
                  <TableHeader>
                    <TableRow className="bg-muted/50">
                      <TableHead className="px-3 sm:px-4">
                        <button type="button" className="flex w-full items-center gap-2 text-left" onClick={() => toggleItemSort(group.key, 'ticker')}>
                          <span className="truncate">Asset</span>
                          {renderSortIndicator(itemSorts[group.key], 'ticker')}
                        </button>
                      </TableHead>

                      <TableHead className="px-3 sm:px-4 text-right">
                        <button type="button" className="ml-auto flex w-full items-center justify-end gap-2 whitespace-nowrap" onClick={() => toggleItemSort(group.key, 'quantity')}>
                          Quantity
                          {renderSortIndicator(itemSorts[group.key], 'quantity')}
                        </button>
                      </TableHead>

                      <TableHead className="px-3 sm:px-4 text-right">
                        <button type="button" className="ml-auto flex w-full items-center justify-end gap-2 whitespace-nowrap" onClick={() => toggleItemSort(group.key, 'cost_basis')}>
                          Total Cost Basis
                          {renderSortIndicator(itemSorts[group.key], 'cost_basis')}
                        </button>
                      </TableHead>

                      <TableHead className="px-3 sm:px-4 text-right">
                        <button type="button" className="ml-auto flex w-full items-center justify-end gap-2 whitespace-nowrap" onClick={() => toggleItemSort(group.key, 'value')}>
                          Current Value
                          {renderSortIndicator(itemSorts[group.key], 'value')}
                        </button>
                      </TableHead>

                      <TableHead className="px-3 sm:px-4 text-right">
                        <button type="button" className="ml-auto flex w-full items-center justify-end gap-2 whitespace-nowrap" onClick={() => toggleItemSort(group.key, 'weight')}>
                          Weight (Portfolio)
                          {renderSortIndicator(itemSorts[group.key], 'weight')}
                        </button>
                      </TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {(() => {
                      const sortSpec = itemSorts[group.key] || { key: 'value', dir: 'desc' }
                      const dirMul = sortSpec.dir === 'asc' ? 1 : -1
                      return [...(group.items || [])]
                        .slice()
                        .sort((a: any, b: any) => {
                          const k = sortSpec.key
                          if (k === 'ticker') {
                            const aa = (a.ticker || '').toLowerCase()
                            const bb = (b.ticker || '').toLowerCase()
                            return aa.localeCompare(bb) * dirMul
                          }
                          if (k === 'quantity') {
                            const qa = getItemRemainingQuantity(a)
                            const qb = getItemRemainingQuantity(b)
                            return (qa - qb) * dirMul
                          }
                          if (k === 'weight') {
                            const wa = totalValueAcrossSelection > 0 ? ((Number(a.value) || 0) / totalValueAcrossSelection) * 100 : 0
                            const wb = totalValueAcrossSelection > 0 ? ((Number(b.value) || 0) / totalValueAcrossSelection) * 100 : 0
                            return (wa - wb) * dirMul
                          }
                          const va = Number(k === 'cost_basis' ? (a.cost_basis ?? 0) : (a.value ?? 0)) || 0
                          const vb = Number(k === 'cost_basis' ? (b.cost_basis ?? 0) : (b.value ?? 0)) || 0
                          return (va - vb) * dirMul
                        })
                        .map((item: any, idx: number) => {
                          const itemValue = Number(item.value) || 0
                          const itemWeight = totalValueAcrossSelection > 0 ? (itemValue / totalValueAcrossSelection) * 100 : 0
                          const itemQuantity = getItemRemainingQuantity(item)
                          return (
                            <TableRow key={`${item.ticker ?? item.name ?? idx}`}>
                              <TableCell className="px-3 sm:px-4 align-top">
                                <div className="font-bold truncate">{item.ticker}</div>
                                <div className="text-[10px] opacity-70 truncate">{item.name}</div>
                              </TableCell>
                              <TableCell className="px-3 sm:px-4 text-right tabular-nums whitespace-nowrap">{itemQuantity.toLocaleString(undefined, { maximumFractionDigits: 6 })}</TableCell>
                              <TableCell className="px-3 sm:px-4 text-right tabular-nums whitespace-nowrap">{formatUSD(item.cost_basis)}</TableCell>
                              <TableCell className="px-3 sm:px-4 text-right tabular-nums font-bold whitespace-nowrap">{formatUSD(itemValue)}</TableCell>
                              <TableCell className="px-3 sm:px-4 text-right tabular-nums whitespace-nowrap">{itemWeight.toFixed(2)}%</TableCell>
                            </TableRow>
                          )
                        })
                    })()}
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
