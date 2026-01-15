// src/app/dashboard/portfolio/PortfolioHoldingsWithSlicers.tsx
'use client'

import { useState, useEffect } from 'react'
import {
  PieChart, Pie, Cell, ResponsiveContainer, Tooltip, Legend,
} from 'recharts'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'
import { Label } from '@/components/ui/label'
import { Button } from '@/components/ui/button'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from '@/components/ui/accordion'
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
  { value: 'geography', label: 'Geography' },
  { value: 'size_tag', label: 'Size' },
  { value: 'factor_tag', label: 'Factor' },
]

type AllocationSlice = {
  key: string
  value: number
  data: { subkey: string; value: number; percentage: number }[]
  items?: { ticker?: string; name?: string; quantity?: number; value?: number; net_gain?: number; key?: string }[]
}

type HoldingRow = {
  ticker: string
  name: string | null
  quantity: number
  avgBasis: number
  totalBasis: number
  currPrice: number
  currValue: number
  unrealized: number
  groupKey?: string // for separate mode grouping
}

export default function PortfolioHoldingsWithSlicers({
  initialAllocations, // optional: server-passed fallback
  cash,
  grandTotalBasis,
  grandTotalValue,
  overallUnrealized,
}: {
  initialAllocations?: AllocationSlice[]
  cash: number
  grandTotalBasis: number
  grandTotalValue: number
  overallUnrealized: number
}) {
  const [lens, setLens] = useState('total')
  const [availableValues, setAvailableValues] = useState<{value: string, label: string}[]>([])
  const [selectedValues, setSelectedValues] = useState<string[]>([])
  const [aggregate, setAggregate] = useState(true)
  const [allocations, setAllocations] = useState<AllocationSlice[]>(initialAllocations || [])
  const [loading, setLoading] = useState(!initialAllocations)
  const [refreshing, setRefreshing] = useState(false)

  // Fetch distinct values for lens (same as dashboard)
  useEffect(() => {
    if (lens === 'total') {
      setAvailableValues([])
      setSelectedValues([])
      return
    }

    const fetchValues = async () => {
      const res = await fetch('/api/dashboard/values', {
        method: 'POST',
        body: JSON.stringify({ lens }),
      })
      const data = await res.json()
      const vals = data.values || []
      setAvailableValues(vals)
      setSelectedValues(vals.map((v: any) => v.value)) // default all
    }
    fetchValues()
  }, [lens])

  // Load allocations when filters change
  useEffect(() => {
    const load = async () => {
      setLoading(true)
      const payload = {
        lens,
        selectedValues: lens === 'total' ? [] : selectedValues,
        aggregate,
      }
      const res = await fetch('/api/dashboard/allocations', {
        method: 'POST',
        body: JSON.stringify(payload),
        cache: 'no-store',
      })
      const data = await res.json()
      setAllocations(data.allocations || [])
      setLoading(false)
    }
    load()
  }, [lens, selectedValues, aggregate])

  const toggleValue = (value: string) => {
    setSelectedValues(prev =>
      prev.includes(value) ? prev.filter(v => v !== value) : [...prev, value]
    )
  }

  const handleRefresh = async () => {
    setRefreshing(true)
    await refreshAssetPrices()
    // Re-trigger load after refresh
    const payload = { lens, selectedValues: lens === 'total' ? [] : selectedValues, aggregate }
    const res = await fetch('/api/dashboard/allocations', { method: 'POST', body: JSON.stringify(payload) })
    const data = await res.json()
    setAllocations(data.allocations || [])
    setRefreshing(false)
  }

  // Flatten holdings for table (aggregate or separate)
  const getTableRows = (): HoldingRow[] => {
    if (aggregate) {
      // Single aggregated view → all assets from all selected groups
      const allItems = allocations.flatMap(a => a.items || [])
      return allItems.map(item => ({
        ticker: item.ticker || item.key || 'Unknown',
        name: item.name || null,
        quantity: item.quantity || 0,
        avgBasis: item.value && item.quantity ? item.value / item.quantity : 0,
        totalBasis: item.value || 0, // approximate; real basis not in allocations yet
        currPrice: 0, // missing – see note below
        currValue: item.value || 0,
        unrealized: 0, // missing
      }))
    } else {
      // Separate → return with groupKey for accordion
      return allocations.flatMap(a =>
        (a.items || []).map(item => ({
          ticker: item.ticker || item.key || 'Unknown',
          name: item.name || null,
          quantity: item.quantity || 0,
          avgBasis: item.value && item.quantity ? item.value / item.quantity : 0,
          totalBasis: item.value || 0,
          currPrice: 0,
          currValue: item.value || 0,
          unrealized: 0,
          groupKey: a.key,
        }))
      )
    }
  }

  const rows = getTableRows()

  return (
    <div className="space-y-8">
      {/* Slicers – identical to dashboard */}
      <div className="flex flex-wrap gap-4 items-end">
        <div>
          <Label>Slice by</Label>
          <Select value={lens} onValueChange={setLens}>
            <SelectTrigger className="w-56">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {LENSES.map(l => <SelectItem key={l.value} value={l.value}>{l.label}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>

        {lens !== 'total' && (
          <div className="min-w-64">
            <Label>Select {LENSES.find(l => l.value === lens)?.label}s</Label>
            {/* Popover/Command multi-select – copy from dashboard/page.tsx */}
            {/* ... paste the Popover + Command block here ... */}
          </div>
        )}

        {lens !== 'total' && selectedValues.length > 1 && (
          <div className="flex items-center gap-2">
            <Switch checked={aggregate} onCheckedChange={setAggregate} />
            <Label>Aggregate selected</Label>
          </div>
        )}

        <Button onClick={handleRefresh} disabled={refreshing}>
          {refreshing ? 'Refreshing...' : 'Refresh Prices'}
        </Button>
      </div>

      {/* Pie Charts – identical rendering to dashboard */}
      {loading ? (
        <div>Loading...</div>
      ) : (
        <div className="grid grid-cols-1 gap-8">
          {allocations.map((slice, idx) => (
            <div key={idx} className="space-y-4">
              <h4 className="font-medium text-center">{slice.key}</h4>
              <ResponsiveContainer width="100%" height={300}>
                <PieChart>
                  <Pie
                    data={slice.data}
                    dataKey="value"
                    nameKey="subkey"
                    outerRadius={100}
                    label={({ percent }) => percent ? `${(percent * 100).toFixed(1)}%` : ''}
                  >
                    {slice.data.map((_: any, i: number) => (
                      <Cell key={`cell-${i}`} fill={COLORS[i % COLORS.length]} />
                    ))}
                  </Pie>
                  <Tooltip formatter={(v: number | undefined) => (v === undefined ? '' : formatUSD(v))} />
                  <Legend />
                </PieChart>
              </ResponsiveContainer>
            </div>
          ))}
        </div>
      )}

      {/* Table – dynamic based on mode */}
      <div className="overflow-x-auto">
        {aggregate ? (
          // Single table for aggregated view
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Asset</TableHead>
                <TableHead className="text-right">Quantity</TableHead>
                <TableHead className="text-right">Avg Basis</TableHead>
                <TableHead className="text-right">Total Basis</TableHead>
                <TableHead className="text-right">Curr Price</TableHead>
                <TableHead className="text-right">Curr Value</TableHead>
                <TableHead className="text-right">Unreal Gain/Loss</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map(row => (
                <TableRow key={row.ticker}>
                  <TableCell>{row.ticker} {row.name && <span className="text-xs text-muted-foreground">({row.name})</span>}</TableCell>
                  <TableCell className="text-right">{row.quantity.toFixed(4)}</TableCell>
                  <TableCell className="text-right">{formatUSD(row.avgBasis)}</TableCell>
                  <TableCell className="text-right">{formatUSD(row.totalBasis)}</TableCell>
                  <TableCell className="text-right">{formatUSD(row.currPrice)}</TableCell>
                  <TableCell className="text-right">{formatUSD(row.currValue)}</TableCell>
                  <TableCell className={cn("text-right", row.unrealized >= 0 ? "text-green-600" : "text-red-600")}>
                    {formatUSD(row.unrealized)}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        ) : (
          // Accordion grouped by slice key (same as current)
          <Accordion type="multiple">
            {allocations.map(slice => (
              <AccordionItem key={slice.key} value={slice.key}>
                <AccordionTrigger>{slice.key}</AccordionTrigger>
                <AccordionContent>
                  <Table>
                    {/* ... same header + rows filtered to this slice.key ... */}
                  </Table>
                </AccordionContent>
              </AccordionItem>
            ))}
          </Accordion>
        )}
      </div>

      {/* Footer totals – reuse your existing logic */}
      {/* ... paste your grand total / cash row here ... */}
    </div>
  )
}