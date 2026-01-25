'use client'

import { useState, useEffect } from 'react'
import {
  PieChart, Pie, Cell, ResponsiveContainer, Tooltip, Legend,
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
import { Check, ChevronsUpDown, ArrowUpDown, RefreshCw, Download, AlertTriangle } from 'lucide-react'
import { formatUSD } from '@/lib/formatters'
import { cn } from '@/lib/utils'
import { refreshAssetPrices } from '../portfolio/actions'
import { Checkbox } from '@/components/ui/checkbox'

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

type SubPortfolioTarget = {
  id: string
  name: string
  target_allocation: number
  upside_threshold: number
  downside_threshold: number
  band_mode: boolean
}

type AssetTarget = {
  asset_id: string
  sub_portfolio_id: string
  target_percentage: number
}

type RebalancingData = {
  subPortfolios: SubPortfolioTarget[]
  assetTargets: AssetTarget[]
  currentAllocations: {
    sub_portfolio_id: string | null
    asset_id: string
    ticker: string
    name: string | null
    current_value: number
    current_percentage: number
    sub_portfolio_percentage: number
    implied_overall_target: number
    drift_percentage: number
    drift_dollar: number
    action: 'buy' | 'sell' | 'hold'
    amount: number
    tax_notes: string
  }[]
  totalValue: number
  cashNeeded: number
  lastPriceUpdate: string | null
}

type AllocationSlice = {
  key: string
  value: number
  data: { subkey: string; value: number; percentage: number }[]
}

export default function RebalancingPage() {
  const [lens, setLens] = useState('total')
  const [availableValues, setAvailableValues] = useState<{value: string, label: string}[]>([])
  const [selectedValues, setSelectedValues] = useState<string[]>([])
  const [aggregate, setAggregate] = useState(true)
  const [data, setData] = useState<RebalancingData | null>(null)
  const [loading, setLoading] = useState(true)
  const [valuesLoading, setValuesLoading] = useState(false)
  const [refreshing, setRefreshing] = useState(false)
  const [refreshMessage, setRefreshMessage] = useState<string | null>(null)
  const [refreshTrigger, setRefreshTrigger] = useState(0)

  // Accordion state
  const [openItems, setOpenItems] = useState<string[]>([])

  // Editing state
  const [editingSubPortfolio, setEditingSubPortfolio] = useState<string | null>(null)
  const [editingAsset, setEditingAsset] = useState<string | null>(null)
  const [tempTargets, setTempTargets] = useState<{[key: string]: number}>({})

  useEffect(() => {
    fetchData()
  }, [refreshTrigger])

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

  const fetchData = async () => {
    setLoading(true)
    try {
      const res = await fetch('/api/rebalancing')
      if (!res.ok) throw new Error('Failed to fetch rebalancing data')
      const rebalancingData = await res.json()
      setData(rebalancingData)
    } catch (error) {
      console.error('Error fetching rebalancing data:', error)
    } finally {
      setLoading(false)
    }
  }

  const handleRefreshPrices = async () => {
    setRefreshing(true)
    setRefreshMessage(null)
    try {
      const result = await refreshAssetPrices()
      setRefreshMessage(result.message || 'Prices refreshed!')
      setRefreshTrigger(prev => prev + 1)
    } catch (error: any) {
      setRefreshMessage('Error refreshing prices: ' + error.message)
    } finally {
      setRefreshing(false)
    }
  }

  const handleExport = () => {
    if (!data) return
    // Implement CSV export
    const csv = generateCSV(data)
    const blob = new Blob([csv], { type: 'text/csv' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = 'rebalancing-suggestions.csv'
    a.click()
    URL.revokeObjectURL(url)
  }

  const generateCSV = (data: RebalancingData) => {
    const headers = ['Sub-Portfolio', 'Asset', 'Current %', 'Target %', 'Implied Overall Target %', 'Drift %', 'Action', 'Amount', 'Tax Notes']
    const rows = data.currentAllocations.map(item => {
      const subPortfolio = data.subPortfolios.find(sp => sp.id === item.sub_portfolio_id)
      return [
        subPortfolio?.name || 'Unassigned',
        item.ticker,
        item.current_percentage.toFixed(2),
        item.sub_portfolio_percentage.toFixed(2),
        item.implied_overall_target.toFixed(2),
        item.drift_percentage.toFixed(2),
        item.action,
        formatUSD(item.amount),
        item.tax_notes
      ]
    })
    return [headers, ...rows].map(row => row.join(',')).join('\n')
  }

  const updateSubPortfolioTarget = async (id: string, target: number) => {
    try {
      const res = await fetch('/api/rebalancing/sub-portfolio-target', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id, target_percentage: target })
      })
      if (!res.ok) throw new Error('Failed to update target')
      setRefreshTrigger(prev => prev + 1)
    } catch (error) {
      console.error('Error updating sub-portfolio target:', error)
    }
  }

  const updateAssetTarget = async (assetId: string, subPortfolioId: string, target: number) => {
    try {
      const res = await fetch('/api/rebalancing/asset-target', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ asset_id: assetId, sub_portfolio_id: subPortfolioId, target_percentage: target })
      })
      if (!res.ok) throw new Error('Failed to update target')
      setRefreshTrigger(prev => prev + 1)
    } catch (error) {
      console.error('Error updating asset target:', error)
    }
  }

  const updateThresholds = async (id: string, upside: number, downside: number, bandMode: boolean) => {
    try {
      const res = await fetch('/api/rebalancing/thresholds', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id, upside_threshold: upside, downside_threshold: downside, band_mode: bandMode })
      })
      if (!res.ok) throw new Error('Failed to update thresholds')
      setRefreshTrigger(prev => prev + 1)
    } catch (error) {
      console.error('Error updating thresholds:', error)
    }
  }

  if (loading || !data) {
    return <div className="p-8 text-center">Loading rebalancing data...</div>
  }

  const currentAllocations = data.currentAllocations.filter(item => {
    if (lens === 'total') return true
    if (lens === 'sub_portfolio') return selectedValues.includes(item.sub_portfolio_id || 'unassigned')
    // For other lenses, we'd need to implement filtering based on asset metadata
    return true
  })

  const groupedAllocations = currentAllocations.reduce((acc, item) => {
    const key = item.sub_portfolio_id || 'unassigned'
    if (!acc.has(key)) acc.set(key, [])
    acc.get(key)!.push(item)
    return acc
  }, new Map<string, typeof currentAllocations>())

  const pieData = Array.from(groupedAllocations.entries()).map(([key, items]) => ({
    name: data.subPortfolios.find(sp => sp.id === key)?.name || 'Unassigned',
    value: items.reduce((sum, item) => sum + item.current_value, 0),
    percentage: items.reduce((sum, item) => sum + item.current_percentage, 0)
  }))

  const targetPieData = data.subPortfolios.map(sp => ({
    name: sp.name,
    value: sp.target_allocation || 0,
    percentage: sp.target_allocation || 0
  }))

  return (
    <div className="space-y-8">
      {/* Summary Cards */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <div className="bg-card p-4 rounded-lg border">
          <h3 className="font-semibold text-sm text-muted-foreground">Total Portfolio Value</h3>
          <p className="text-2xl font-bold">{formatUSD(data.totalValue)}</p>
        </div>
        <div className="bg-card p-4 rounded-lg border">
          <h3 className="font-semibold text-sm text-muted-foreground">Cash Needed/Generated</h3>
          <p className={cn("text-2xl font-bold", data.cashNeeded > 0 ? "text-red-600" : "text-green-600")}>
            {formatUSD(Math.abs(data.cashNeeded))}
          </p>
        </div>
        <div className="bg-card p-4 rounded-lg border">
          <h3 className="font-semibold text-sm text-muted-foreground">Rebalance Alert</h3>
          <p className="text-2xl font-bold flex items-center">
            {data.currentAllocations.some(item => Math.abs(item.drift_percentage) > 5) ? (
              <><AlertTriangle className="h-6 w-6 text-yellow-500 mr-2" /> Needed</>
            ) : (
              'Balanced'
            )}
          </p>
        </div>
        <div className="bg-card p-4 rounded-lg border">
          <h3 className="font-semibold text-sm text-muted-foreground">Last Price Update</h3>
          <p className="text-sm">{data.lastPriceUpdate ? new Date(data.lastPriceUpdate).toLocaleString() : 'Never'}</p>
        </div>
      </div>

      {/* Controls */}
      <div className="flex flex-wrap gap-4 items-end">
        <div>
          <Label className="text-sm font-medium">View Lens</Label>
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
                    <CommandEmpty>No items found.</CommandEmpty>
                    <CommandGroup>
                      {availableValues.map((item) => (
                        <CommandItem
                          key={item.value}
                          onSelect={() => {
                            if (selectedValues.includes(item.value)) {
                              setSelectedValues(selectedValues.filter(v => v !== item.value))
                            } else {
                              setSelectedValues([...selectedValues, item.value])
                            }
                          }}
                        >
                          <Checkbox
                            checked={selectedValues.includes(item.value)}
                            className="mr-2"
                          />
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

        <div className="flex gap-2">
          <Button onClick={handleRefreshPrices} disabled={refreshing} variant="outline">
            <RefreshCw className={cn("h-4 w-4 mr-2", refreshing && "animate-spin")} />
            Refresh Prices
          </Button>
          <Button onClick={handleExport} variant="outline">
            <Download className="h-4 w-4 mr-2" />
            Export CSV
          </Button>
        </div>
      </div>

      {refreshMessage && (
        <div className="p-4 bg-muted rounded-lg">
          <p className="text-sm">{refreshMessage}</p>
        </div>
      )}

      {/* Visualizations */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
        <div>
          <h3 className="text-lg font-semibold mb-4">Current Allocations</h3>
          <ResponsiveContainer width="100%" height={300}>
            <PieChart>
              <Pie
                data={pieData}
                cx="50%"
                cy="50%"
                labelLine={false}
                label={({ name, percent }) => `${name}: ${((percent || 0) * 100).toFixed(1)}%`}
                outerRadius={80}
                fill="#8884d8"
                dataKey="value"
              >
                {pieData.map((entry, index) => (
                  <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                ))}
              </Pie>
              <Tooltip formatter={(value) => formatUSD(Number(value) || 0)} />
            </PieChart>
          </ResponsiveContainer>
        </div>

        <div>
          <h3 className="text-lg font-semibold mb-4">Target Allocations</h3>
          <ResponsiveContainer width="100%" height={300}>
            <PieChart>
              <Pie
                data={targetPieData}
                cx="50%"
                cy="50%"
                labelLine={false}
                label={({ name, percent }) => `${name}: ${((percent || 0) * 100).toFixed(1)}%`}
                outerRadius={80}
                fill="#8884d8"
                dataKey="value"
              >
                {targetPieData.map((entry, index) => (
                  <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                ))}
              </Pie>
              <Tooltip formatter={(value) => `${Number(value || 0).toFixed(1)}%`} />
            </PieChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* Accordion Table */}
      <Accordion type="multiple" value={openItems} onValueChange={setOpenItems}>
        {Array.from(groupedAllocations.entries()).map(([subPortfolioId, allocations]) => {
          const subPortfolio = data.subPortfolios.find(sp => sp.id === subPortfolioId)
          const subPortfolioName = subPortfolio?.name || 'Unassigned'
          const subPortfolioTarget = subPortfolio?.target_allocation || 0
          const currentSubValue = allocations.reduce((sum, item) => sum + item.current_value, 0)
          const currentSubPercentage = data.totalValue > 0 ? (currentSubValue / data.totalValue) * 100 : 0

          return (
            <AccordionItem key={subPortfolioId} value={subPortfolioId}>
              <AccordionTrigger className="px-4 py-2 hover:bg-muted/50">
                <div className="flex justify-between items-center w-full mr-4">
                  <span className="font-semibold">{subPortfolioName}</span>
                  <div className="flex gap-4 text-sm">
                    <span>Current: {currentSubPercentage.toFixed(2)}%</span>
                    <span>Target: {subPortfolioTarget.toFixed(2)}%</span>
                    <span className={cn(
                      currentSubPercentage - subPortfolioTarget > 5 ? "text-red-600" :
                      subPortfolioTarget - currentSubPercentage > 5 ? "text-blue-600" : "text-green-600"
                    )}>
                      Drift: {(currentSubPercentage - subPortfolioTarget).toFixed(2)}%
                    </span>
                  </div>
                </div>
              </AccordionTrigger>
              <AccordionContent>
                <div className="px-4 pb-4">
                  {/* Sub-Portfolio Header with Editable Target */}
                  <div className="mb-4 p-4 bg-muted/20 rounded-lg">
                    <div className="grid grid-cols-1 md:grid-cols-4 gap-4 items-end">
                      <div>
                        <Label>Target % (sum to 100%)</Label>
                        {editingSubPortfolio === subPortfolioId ? (
                          <div className="flex gap-2">
                            <Input
                              type="number"
                              step="0.1"
                              value={tempTargets[subPortfolioId] ?? subPortfolioTarget}
                              onChange={(e) => setTempTargets({...tempTargets, [subPortfolioId]: parseFloat(e.target.value) || 0})}
                              className="w-24"
                            />
                            <Button size="sm" onClick={() => {
                              updateSubPortfolioTarget(subPortfolioId, tempTargets[subPortfolioId] ?? subPortfolioTarget)
                              setEditingSubPortfolio(null)
                              setTempTargets(prev => {
                                const newTargets = { ...prev }
                                delete newTargets[subPortfolioId]
                                return newTargets
                              })
                            }}>Save</Button>
                            <Button size="sm" variant="outline" onClick={() => {
                              setEditingSubPortfolio(null)
                              setTempTargets(prev => {
                                const newTargets = { ...prev }
                                delete newTargets[subPortfolioId]
                                return newTargets
                              })
                            }}>Cancel</Button>
                          </div>
                        ) : (
                          <div className="flex items-center gap-2">
                            <span className="font-mono">{subPortfolioTarget.toFixed(2)}%</span>
                            <Button size="sm" variant="ghost" onClick={() => setEditingSubPortfolio(subPortfolioId)}>
                              Edit
                            </Button>
                          </div>
                        )}
                      </div>
                      {subPortfolio && (
                        <>
                          <div>
                            <Label>Upside Threshold</Label>
                            <Input
                              type="number"
                              step="1"
                              value={subPortfolio.upside_threshold}
                              onChange={(e) => updateThresholds(subPortfolioId, parseFloat(e.target.value) || 25, subPortfolio.downside_threshold, subPortfolio.band_mode)}
                              className="w-20"
                            />
                          </div>
                          <div>
                            <Label>Downside Threshold</Label>
                            <Input
                              type="number"
                              step="1"
                              value={subPortfolio.downside_threshold}
                              onChange={(e) => updateThresholds(subPortfolioId, subPortfolio.upside_threshold, parseFloat(e.target.value) || 25, subPortfolio.band_mode)}
                              className="w-20"
                            />
                          </div>
                          <div className="flex items-center gap-2">
                            <Switch
                              checked={subPortfolio.band_mode}
                              onCheckedChange={(checked) => updateThresholds(subPortfolioId, subPortfolio.upside_threshold, subPortfolio.downside_threshold, checked)}
                            />
                            <Label>Band Mode</Label>
                          </div>
                        </>
                      )}
                    </div>
                  </div>

                  {/* Assets Table */}
                  <div className="overflow-x-auto">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Asset</TableHead>
                          <TableHead className="text-right">Current % (Sub)</TableHead>
                          <TableHead className="text-right">Target % (Sub)</TableHead>
                          <TableHead className="text-right">Implied Overall Target %</TableHead>
                          <TableHead className="text-right">Drift %</TableHead>
                          <TableHead className="text-right">Drift $</TableHead>
                          <TableHead>Action</TableHead>
                          <TableHead className="text-right">Amount</TableHead>
                          <TableHead>Tax Notes</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {allocations.map((item) => (
                          <TableRow key={item.asset_id}>
                            <TableCell>
                              <div>
                                <div className="font-bold">{item.ticker}</div>
                                <div className="text-sm text-muted-foreground">{item.name}</div>
                              </div>
                            </TableCell>
                            <TableCell className="text-right">{item.sub_portfolio_percentage.toFixed(2)}%</TableCell>
                            <TableCell className="text-right">
                              {editingAsset === item.asset_id ? (
                                <div className="flex gap-2 justify-end">
                                  <Input
                                    type="number"
                                    step="0.1"
                                    value={tempTargets[item.asset_id] ?? item.sub_portfolio_percentage}
                                    onChange={(e) => setTempTargets({...tempTargets, [item.asset_id]: parseFloat(e.target.value) || 0})}
                                    className="w-20"
                                  />
                                  <Button size="sm" onClick={() => {
                                    updateAssetTarget(item.asset_id, subPortfolioId, tempTargets[item.asset_id] ?? item.sub_portfolio_percentage)
                                    setEditingAsset(null)
                                    setTempTargets(prev => {
                                      const newTargets = { ...prev }
                                      delete newTargets[item.asset_id]
                                      return newTargets
                                    })
                                  }}>Save</Button>
                                  <Button size="sm" variant="outline" onClick={() => {
                                    setEditingAsset(null)
                                    setTempTargets(prev => {
                                      const newTargets = { ...prev }
                                      delete newTargets[item.asset_id]
                                      return newTargets
                                    })
                                  }}>Cancel</Button>
                                </div>
                              ) : (
                                <div className="flex items-center justify-end gap-2">
                                  <span>{item.sub_portfolio_percentage.toFixed(2)}%</span>
                                  <Button size="sm" variant="ghost" onClick={() => setEditingAsset(item.asset_id)}>
                                    Edit
                                  </Button>
                                </div>
                              )}
                            </TableCell>
                            <TableCell className="text-right">{item.implied_overall_target.toFixed(2)}%</TableCell>
                            <TableCell className={cn(
                              "text-right font-medium",
                              Math.abs(item.drift_percentage) > 5 ? "text-red-600" : "text-green-600"
                            )}>
                              {item.drift_percentage > 0 ? '+' : ''}{item.drift_percentage.toFixed(2)}%
                            </TableCell>
                            <TableCell className="text-right">{formatUSD(item.drift_dollar)}</TableCell>
                            <TableCell className={cn(
                              "font-medium",
                              item.action === 'buy' ? "text-blue-600" :
                              item.action === 'sell' ? "text-red-600" : "text-green-600"
                            )}>
                              {item.action.toUpperCase()}
                            </TableCell>
                            <TableCell className="text-right">{formatUSD(item.amount)}</TableCell>
                            <TableCell className="text-sm">{item.tax_notes}</TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                </div>
              </AccordionContent>
            </AccordionItem>
          )
        })}
      </Accordion>
    </div>
  )
}