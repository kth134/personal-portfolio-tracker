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
  { value: 'asset_subtype', label: 'Asset Sub-Type' },
  { value: 'geography', label: 'Geography' },
  { value: 'size_tag', label: 'Size' },
  { value: 'factor_tag', label: 'Factor' },
]

type AllocationSlice = {
  key: string
  value: number
  data: { subkey: string; value: number; percentage: number }[]
  items?: { ticker?: string; name?: string; quantity?: number; value?: number; net_gain?: number; cost_basis?: number; unrealized?: number; key?: string }[]
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
  groupKey?: string
}

export default function PortfolioHoldingsWithSlicers({
  cash,
}: {
  cash: number
}) {
  const [lens, setLens] = useState('total')
  const [availableValues, setAvailableValues] = useState<{value: string, label: string}[]>([])
  const [selectedValues, setSelectedValues] = useState<string[]>([])
  const [aggregate, setAggregate] = useState(true)
  const [allocations, setAllocations] = useState<AllocationSlice[]>([])
  const [loading, setLoading] = useState(true)
  const [valuesLoading, setValuesLoading] = useState(false)
  const [refreshing, setRefreshing] = useState(false)
  const [refreshMessage, setRefreshMessage] = useState<string | null>(null)
  const [refreshTrigger, setRefreshTrigger] = useState(0)

  useEffect(() => {
    if (lens === 'total') {
      setAvailableValues([])
      setSelectedValues([])
      return
    }

    const fetchValues = async () => {
      setValuesLoading(true)
      const res = await fetch('/api/dashboard/values', {
        method: 'POST',
        body: JSON.stringify({ lens }),
      })
      if (!res.ok) throw new Error('Failed to fetch values')
      const data = await res.json()
      const vals = data.values || []
      setAvailableValues(vals)
      setSelectedValues(vals.map((item: any) => item.value))
      setValuesLoading(false)
    }
    fetchValues()
  }, [lens])

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
      if (!res.ok) throw new Error('Failed to fetch allocations')
      const data = await res.json()
      setAllocations(data.allocations || [])
      setLoading(false)
    }
    load()
  }, [lens, selectedValues, aggregate, refreshTrigger])

  const toggleValue = (value: string) => {
    setSelectedValues(prev =>
      prev.includes(value) ? prev.filter(v => v !== value) : [...prev, value]
    )
  }

  const handleRefresh = async () => {
    setRefreshing(true)
    setRefreshMessage(null)
    try {
      const result = await refreshAssetPrices()
      setRefreshMessage(result.message || 'Prices refreshed!')
      // Reload allocations
      const payload = { lens, selectedValues: lens === 'total' ? [] : selectedValues, aggregate }
      const res = await fetch('/api/dashboard/allocations', { method: 'POST', body: JSON.stringify(payload) })
      const data = await res.json()
      setAllocations(data.allocations || [])
    } catch (err) {
      setRefreshMessage('Error refreshing prices')
    } finally {
      setRefreshing(false)
    }
  }

  const getTableRows = (): HoldingRow[] => {
    const rows: HoldingRow[] = []
    allocations.forEach(slice => {
      (slice.items || []).forEach(item => {
        const currValue = item.value || 0
        const totalBasis = item.cost_basis || 0
        const quantity = item.quantity || 0
        rows.push({
          ticker: item.ticker || item.key || 'Unknown',
          name: item.name || null,
          quantity,
          avgBasis: quantity > 0 ? totalBasis / quantity : 0,
          totalBasis,
          currPrice: quantity > 0 ? currValue / quantity : 0,
          currValue,
          unrealized: item.unrealized || (currValue - totalBasis),
          groupKey: aggregate ? undefined : slice.key,
        })
      })
    })
    return rows
  }

  const rows = getTableRows()

  const selectedTotalBasis = rows.reduce((sum, row) => sum + row.totalBasis, 0) + cash
  const selectedTotalValue = rows.reduce((sum, row) => sum + row.currValue, 0) + cash

  const groupedRows = rows.reduce((acc, row) => {
    const key = row.groupKey || 'Aggregated'
    if (!acc.has(key)) acc.set(key, [])
    acc.get(key)!.push(row)
    return acc
  }, new Map<string, HoldingRow[]>())

  return (
    <div className="space-y-8">
      <div className="flex flex-wrap gap-4 items-end mb-4">
        <div>
          <Label className="text-sm font-medium">Slice by</Label>
          <Select value={lens} onValueChange={setLens}>
            <SelectTrigger className="w-56">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {LENSES.map(l => (
                <SelectItem key={l.value} value={l.value}>{l.label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {lens !== 'total' && (
          <div className="min-w-64">
            <Label className="text-sm font-medium">
              Select {LENSES.find(l => l.value === lens)?.label}s {valuesLoading && '(loading...)'}
            </Label>
            <Popover>
              <PopoverTrigger asChild>
                <Button variant="outline" className="w-full justify-between">
                  {selectedValues.length === availableValues.length ? 'All selected' :
                   selectedValues.length === 0 ? 'None selected' :
                   `${selectedValues.length} selected`}
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
          <div className="flex items-center gap-2">
            <Switch checked={aggregate} onCheckedChange={setAggregate} />
            <Label>Aggregate selected</Label>
          </div>
        )}

        <Button onClick={handleRefresh} disabled={refreshing}>
          {refreshing ? 'Refreshing...' : 'Refresh Prices'}
        </Button>
        {refreshMessage && <span className="text-sm text-green-600">{refreshMessage}</span>}
      </div>

      {loading ? (
        <div className="text-center py-12">Loading portfolio data...</div>
      ) : (
        <div className="flex flex-wrap gap-8 justify-center">
          {allocations.map((slice, idx) => (
            <div key={idx} className="space-y-4 min-w-0 flex-shrink-0">
              <h4 className="font-medium text-center">{slice.key}</h4>
              <ResponsiveContainer width="100%" height={300} minWidth={300}>
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
                  <Tooltip formatter={(v: number | undefined) => v !== undefined ? formatUSD(v) : ''} />
                  <Legend />
                </PieChart>
              </ResponsiveContainer>
            </div>
          ))}
        </div>
      )}

      <div className="overflow-x-auto">
        {aggregate ? (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Asset</TableHead>
                <TableHead className="text-right">Quantity</TableHead>
                <TableHead className="text-right">Avg Basis</TableHead>
                <TableHead className="text-right">Total Basis</TableHead>
                <TableHead className="text-right">Curr Price</TableHead>
                <TableHead className="text-right">Curr Value</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map(row => (
                <TableRow key={row.ticker}>
                  <TableCell>
                    <div className="flex flex-col">
                      <span className="font-bold">{row.ticker}</span>
                      <span className="text-muted-foreground">{row.name || '-'}</span>
                    </div>
                  </TableCell>
                  <TableCell className="text-right">{row.quantity.toFixed(4)}</TableCell>
                  <TableCell className="text-right">{formatUSD(row.avgBasis)}</TableCell>
                  <TableCell className="text-right">{formatUSD(row.totalBasis)}</TableCell>
                  <TableCell className="text-right">{formatUSD(row.currPrice)}</TableCell>
                  <TableCell className="text-right">{formatUSD(row.currValue)}</TableCell>
                </TableRow>
              ))}
              <TableRow className="font-semibold bg-muted/30">
                <TableCell>Total</TableCell>
                <TableCell className="text-right">{rows.reduce((sum, r) => sum + r.quantity, 0).toFixed(4)}</TableCell>
                <TableCell className="text-right">-</TableCell>
                <TableCell className="text-right">{formatUSD(rows.reduce((sum, r) => sum + r.totalBasis, 0))}</TableCell>
                <TableCell className="text-right">-</TableCell>
                <TableCell className="text-right">{formatUSD(rows.reduce((sum, r) => sum + r.currValue, 0))}</TableCell>
              </TableRow>
            </TableBody>
          </Table>
        ) : (
          <Accordion type="multiple">
            {Array.from(groupedRows).map(([key, groupRows]) => (
              <AccordionItem key={key} value={key}>
                <AccordionTrigger>{key}</AccordionTrigger>
                <AccordionContent>
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Asset</TableHead>
                        <TableHead className="text-right">Quantity</TableHead>
                        <TableHead className="text-right">Avg Basis</TableHead>
                        <TableHead className="text-right">Total Basis</TableHead>
                        <TableHead className="text-right">Curr Price</TableHead>
                        <TableHead className="text-right">Curr Value</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {groupRows.map(row => (
                        <TableRow key={row.ticker}>
                          <TableCell>
                            <div className="flex flex-col">
                              <span className="font-bold">{row.ticker}</span>
                              <span className="text-muted-foreground">{row.name || '-'}</span>
                            </div>
                          </TableCell>
                          <TableCell className="text-right">{row.quantity.toFixed(4)}</TableCell>
                          <TableCell className="text-right">{formatUSD(row.avgBasis)}</TableCell>
                          <TableCell className="text-right">{formatUSD(row.totalBasis)}</TableCell>
                          <TableCell className="text-right">{formatUSD(row.currPrice)}</TableCell>
                          <TableCell className="text-right">{formatUSD(row.currValue)}</TableCell>
                        </TableRow>
                      ))}
                      <TableRow className="font-semibold bg-muted/30">
                        <TableCell>Sub-Total</TableCell>
                        <TableCell className="text-right">{groupRows.reduce((sum, r) => sum + r.quantity, 0).toFixed(4)}</TableCell>
                        <TableCell className="text-right">-</TableCell>
                        <TableCell className="text-right">{formatUSD(groupRows.reduce((sum, r) => sum + r.totalBasis, 0))}</TableCell>
                        <TableCell className="text-right">-</TableCell>
                        <TableCell className="text-right">{formatUSD(groupRows.reduce((sum, r) => sum + r.currValue, 0))}</TableCell>
                      </TableRow>
                    </TableBody>
                  </Table>
                </AccordionContent>
              </AccordionItem>
            ))}
          </Accordion>
        )}
      </div>

      {/* Footer totals */}
      <div className="overflow-x-auto mt-4">
        <Table>
          <TableBody>
            <TableRow className="font-bold bg-muted/50">
              <TableCell>Holdings Total</TableCell>
              <TableCell className="text-right">-</TableCell>
              <TableCell className="text-right">-</TableCell>
              <TableCell className="text-right">{formatUSD(selectedTotalBasis - cash)}</TableCell>
              <TableCell className="text-right">-</TableCell>
              <TableCell className="text-right">{formatUSD(selectedTotalValue - cash)}</TableCell>
            </TableRow>
            <TableRow className="font-bold bg-muted/50">
              <TableCell>Cash Balance</TableCell>
              <TableCell className="text-right">-</TableCell>
              <TableCell className="text-right">-</TableCell>
              <TableCell className="text-right">{formatUSD(cash)}</TableCell>
              <TableCell className="text-right">-</TableCell>
              <TableCell className="text-right">{formatUSD(cash)}</TableCell>
            </TableRow>
            <TableRow className="font-bold text-lg">
              <TableCell>Portfolio Total</TableCell>
              <TableCell className="text-right">-</TableCell>
              <TableCell className="text-right">-</TableCell>
              <TableCell className="text-right">{formatUSD(selectedTotalBasis)}</TableCell>
              <TableCell className="text-right">-</TableCell>
              <TableCell className="text-right">{formatUSD(selectedTotalValue)}</TableCell>
            </TableRow>
          </TableBody>
        </Table>
      </div>
    </div>
  )
}