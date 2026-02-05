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
import { Check, ChevronsUpDown, ArrowUpDown } from 'lucide-react'
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
  weight: number
  groupKey?: string
}

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
  const [allocations, setAllocations] = useState<AllocationSlice[]>([])
  const [pieAllocations, setPieAllocations] = useState<AllocationSlice[]>([])
  const [loading, setLoading] = useState(true)
  const [valuesLoading, setValuesLoading] = useState(false)
  const [refreshing, setRefreshing] = useState(false)
  const [refreshMessage, setRefreshMessage] = useState<string | null>(null)
  const [refreshTrigger, setRefreshTrigger] = useState(0)

  // Sorting state
  const [sortColumn, setSortColumn] = useState<keyof HoldingRow | null>('currValue')
  const [sortDirection, setSortDirection] = useState<'asc' | 'desc'>('desc')

  // Accordion state
  const [openItems, setOpenItems] = useState<string[]>([])

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
    const loadPieCharts = async () => {
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
      setPieAllocations(data.allocations || [])
    }

    const loadTables = async () => {
      setLoading(true)
      const payload = {
        lens,
        selectedValues: lens === 'total' ? [] : selectedValues,
        aggregate: false,
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

    loadPieCharts().then(loadTables)
  }, [lens, selectedValues, aggregate, refreshTrigger])

  useEffect(() => {
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
          weight: 0,
          groupKey: slice.key,
        })
      })
    })
    const groupedRows = rows.reduce((acc, row) => {
      const key = row.groupKey || 'Aggregated'
      if (!acc.has(key)) acc.set(key, [])
      acc.get(key)!.push(row)
      return acc
    }, new Map<string, HoldingRow[]>())
    setOpenItems(Array.from(groupedRows.keys()))
  }, [allocations])

  const handleRefresh = async () => {
    setRefreshing(true)
    setRefreshMessage(null)
    try {
      const result = await refreshAssetPrices()
      setRefreshMessage(result.message || 'Prices refreshed!')
      setRefreshTrigger(t => t + 1)
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
          weight: 0,
          groupKey: slice.key,
        })
      })
    })
    if (sortColumn) {
      rows.sort((a, b) => {
        const aVal = a[sortColumn!] ?? ''
        const bVal = b[sortColumn!] ?? ''
        if (typeof aVal === 'number' && typeof bVal === 'number') return sortDirection === 'asc' ? aVal - bVal : bVal - aVal
        if (typeof aVal === 'string' && typeof bVal === 'string') return sortDirection === 'asc' ? aVal.localeCompare(bVal) : bVal.localeCompare(aVal)
        return 0
      })
    }
    return rows
  }

  const rows = getTableRows()
  const totalBasis = rows.reduce((sum, r) => sum + r.totalBasis, 0)
  const selectedTotalValue = rows.reduce((sum, row) => sum + row.currValue, 0) + cash
  const holdingsTotalBasis = totalBasis

  rows.forEach(row => {
    row.weight = selectedTotalValue > 0 ? (row.currValue / selectedTotalValue) * 100 : 0
  })

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
            <SelectTrigger className="w-56"><SelectValue /></SelectTrigger>
            <SelectContent>{LENSES.map(l => (<SelectItem key={l.value} value={l.value}>{l.label}</SelectItem>))}</SelectContent>
          </Select>
        </div>
        <Button onClick={handleRefresh} disabled={refreshing}>Refresh Prices</Button>
      </div>

      <Accordion type="multiple" value={openItems} onValueChange={setOpenItems}>
        {Array.from(groupedRows.entries()).map(([key, groupRows]) => {
          const groupCurrValue = groupRows.reduce((sum, r) => sum + r.currValue, 0) + (lens === 'account' ? (cashByAccountName.get(key) || 0) : 0)
          const groupWeight = selectedTotalValue > 0 ? (groupCurrValue / selectedTotalValue) * 100 : 0
          const groupTotalBasis = groupRows.reduce((sum, r) => sum + r.totalBasis, 0)

          return (
            <AccordionItem key={key} value={key}>
              <AccordionTrigger className="bg-black text-white font-semibold px-4 py-2 hover:bg-gray-800 [&>svg]:text-white">
                <div className="flex justify-between w-full mr-4">
                   <span>{key}</span>
                   <span>{formatUSD(groupCurrValue)} | {groupWeight.toFixed(2)}%</span>
                </div>
              </AccordionTrigger>
              <AccordionContent>
                <Table>
                  <TableHeader>
                    <TableRow>
                     <TableHead>Asset</TableHead>
                     <TableHead className="text-right">Value</TableHead>
                     <TableHead className="text-right">Weight</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {groupRows.map(row => (
                      <TableRow key={row.ticker}>
                        <TableCell><div className="font-bold">{row.ticker}</div><div className="text-sm text-muted-foreground">{row.name}</div></TableCell>
                        <TableCell className="text-right">{formatUSD(row.currValue)}</TableCell>
                        <TableCell className="text-right">{row.weight.toFixed(2)}%</TableCell>
                      </TableRow>
                    ))}
                    <TableRow className="font-semibold bg-muted">
                      <TableCell>Total</TableCell>
                      <TableCell className="text-right">{formatUSD(groupCurrValue)}</TableCell>
                      <TableCell className="text-right">{groupWeight.toFixed(2)}%</TableCell>
                    </TableRow>
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
