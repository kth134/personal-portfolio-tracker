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
  const [valuesLoading, setValuesLoading] = useState(false)
  const [refreshing, setRefreshing] = useState(false)
  const [refreshMessage, setRefreshMessage] = useState<string | null>(null)
  const [refreshTrigger, setRefreshTrigger] = useState(0)

  // Tracking open items
  const [openItems, setOpenItems] = useState<string[]>([])

  // Fetch distinct values for multi-select
  useEffect(() => {
    if (lens === 'total') {
      setAvailableValues([])
      setSelectedValues([])
      return
    }

    const fetchValues = async () => {
      setValuesLoading(true)
      try {
        const res = await fetch('/api/dashboard/values', {
          method: 'POST',
          body: JSON.stringify({ lens }),
        })
        if (!res.ok) throw new Error(`Failed to fetch values: ${res.status}`)
        const data = await res.json()
        const vals = data.values || []
        setAvailableValues(vals)
        setSelectedValues(vals.map((v: any) => v.value))
      } catch (err) {
        console.error('Values fetch failed:', err)
      } finally {
        setValuesLoading(false)
      }
    }
    fetchValues()
  }, [lens])

  // Load backend data
  useEffect(() => {
    const loadData = async () => {
      setLoading(true)
      try {
        const payload = {
          lens,
          selectedValues: lens === 'total' ? [] : selectedValues,
          aggregate,
        }
        
        // Fetch for pies (respects aggregate)
        const pieRes = await fetch('/api/dashboard/allocations', {
          method: 'POST',
          body: JSON.stringify(payload),
          cache: 'no-store'
        })
        const pieData = await pieRes.json()
        setPieAllocations(pieData.allocations || [])

        // Fetch for tables (never aggregate)
        const tableRes = await fetch('/api/dashboard/allocations', {
          method: 'POST',
          body: JSON.stringify({ ...payload, aggregate: false }),
          cache: 'no-store'
        })
        const tableData = await tableRes.json()
        setAllocations(tableData.allocations || [])
        
        // Expand all by default
        setOpenItems((tableData.allocations || []).map((a: any) => a.key))
      } catch (err) {
        console.error('Allocations fetch failed:', err)
      } finally {
        setLoading(false)
      }
    }
    loadData()
  }, [lens, selectedValues, aggregate, refreshTrigger])

  const toggleValue = (value: string) => {
    setSelectedValues(prev => prev.includes(value) ? prev.filter(v => v !== value) : [...prev, value])
  }

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

  // Calculate global totals
  const totalValueAcrossSelection = useMemo(() => {
    const holdingsTotal = allocations.reduce((sum, a) => sum + (Number(a.value) || 0), 0)
    return holdingsTotal + cash
  }, [allocations, cash])

  if (loading && allocations.length === 0) {
    return <div className="text-center py-12">Loading portfolio data...</div>
  }

  return (
    <div className="space-y-8">
      {/* Controls */}
      <div className="flex flex-wrap gap-4 items-end mb-4">
        <div>
          <Label className="text-sm font-medium">Slice by</Label>
          <Select value={lens} onValueChange={setLens}>
            <SelectTrigger className="w-56"><SelectValue /></SelectTrigger>
            <SelectContent>{LENSES.map(l => (
              <SelectItem key={l.value} value={l.value}>{l.label}</SelectItem>
            ))}</SelectContent>
          </Select>
        </div>

        {lens !== 'total' && (
          <div className="min-w-64">
            <Label className="text-sm font-medium">Select {LENSES.find(l => l.value === lens)?.label}s</Label>
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
          <div className="flex items-center gap-2">
            <Switch checked={aggregate} onCheckedChange={setAggregate} />
            <Label>Aggregate selected</Label>
          </div>
        )}

        <Button onClick={handleRefresh} disabled={refreshing}>Refresh Prices</Button>
      </div>

      {/* Visuals */}
      <div className="flex flex-wrap gap-8 justify-center">
        {pieAllocations.map((slice, idx) => (
          <div key={idx} className="space-y-4 min-w-0 flex-shrink-0">
            <h4 className="font-medium text-center">{slice.key}</h4>
            <ResponsiveContainer width="100%" height={400} minWidth={300}>
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
                <Tooltip formatter={(v: any) => formatUSD(v)} />
                <Legend />
              </PieChart>
            </ResponsiveContainer>
          </div>
        ))}
      </div>

      {/* Tables Mapping - Bug #41 Header logic */}
      <Accordion type="multiple" value={openItems} onValueChange={setOpenItems}>
        {allocations.map((group) => {
          const groupHoldingsValue = Number(group.value) || 0
          const accountCash = lens === 'account' ? (cashByAccountName.get(group.key) || 0) : 0
          const groupTotalValue = groupHoldingsValue + accountCash
          const groupWeight = totalValueAcrossSelection > 0 ? (groupTotalValue / totalValueAcrossSelection) * 100 : 0

          return (
            <AccordionItem key={group.key} value={group.key}>
              <AccordionTrigger className="bg-black text-white px-4 py-2 hover:bg-gray-800">
                <div className="flex justify-between w-full mr-4">
                  <span className="font-semibold">{group.key}</span>
                  <span className="text-sm">{formatUSD(groupTotalValue)} | {groupWeight.toFixed(2)}%</span>
                </div>
              </AccordionTrigger>
              <AccordionContent className="p-0">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="w-[40%]">Asset</TableHead>
                      <TableHead className="w-[20%] text-right">Total Cost Basis</TableHead>
                      <TableHead className="w-[20%] text-right">Current Value</TableHead>
                      <TableHead className="w-[20%] text-right">Weight (Portfolio)</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {(group.items || []).map((item: any) => {
                      const itemValue = Number(item.value) || 0
                      const itemBasis = Number(item.cost_basis) || 0
                      const itemWeight = totalValueAcrossSelection > 0 ? (itemValue / totalValueAcrossSelection) * 100 : 0
                      return (
                        <TableRow key={item.ticker}>
                          <TableCell className="w-[40%]"><div className="font-bold">{item.ticker}</div><div className="text-xs text-muted-foreground">{item.name}</div></TableCell>
                          <TableCell className="w-[20%] text-right">{formatUSD(itemBasis)}</TableCell>
                          <TableCell className="w-[20%] text-right">{formatUSD(itemValue)}</TableCell>
                          <TableCell className="w-[20%] text-right">{itemWeight.toFixed(2)}%</TableCell>
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
