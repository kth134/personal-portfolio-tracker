'use client'

import { useState, useEffect } from 'react'
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer
} from 'recharts'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'
import { Label } from '@/components/ui/label'
import { Button } from '@/components/ui/button'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from '@/components/ui/command'
import { Check, ChevronsUpDown } from 'lucide-react'
import { cn } from '@/lib/utils'
import { formatUSD } from '@/lib/formatters'

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

const METRICS = [
  { value: 'totalReturn', label: 'Total Return %' },
  { value: 'portfolioValue', label: 'Portfolio Value' },
  { value: 'netGain', label: 'Net Gain / Loss' },
  { value: 'unrealized', label: 'Unrealized Gain / Loss' },
  { value: 'realized', label: 'Realized Gain / Loss' },
  { value: 'income', label: 'Income' },
]

const BENCH_OPTIONS = [
  { value: 'sp500', label: 'S&P 500' },
  { value: 'nasdaq', label: 'Nasdaq' },
  { value: 'intlExUs', label: 'Intl ex US' },
  { value: 'gold', label: 'Gold' },
  { value: 'bitcoin', label: 'Bitcoin' },
]

type SeriesData = {
  date: string
  portfolioValue: number
  investmentValue: number
  netGain: number
  unrealized: number
  realized: number
  income: number
  costBasisTotal: number
  benchmarkValues: Record<string, number>
}

type TimeSeries = Record<string, SeriesData[]> // key: 'aggregated' or slice key

export default function PerformanceVisualizations() {
  const [lens, setLens] = useState('total')
  const [availableValues, setAvailableValues] = useState<{value: string, label: string}[]>([])
  const [selectedValues, setSelectedValues] = useState<string[]>([])
  const [aggregate, setAggregate] = useState(true)
  const [selectedBenchmarks, setSelectedBenchmarks] = useState<string[]>([])
  const [metric, setMetric] = useState('totalReturn')
  const [timeSeries, setTimeSeries] = useState<TimeSeries>({})
  const [loading, setLoading] = useState(true)
  const [valuesLoading, setValuesLoading] = useState(false)
  const [refreshing, setRefreshing] = useState(false)
  const [refreshMessage, setRefreshMessage] = useState<string | null>(null)

  useEffect(() => {
    if (lens === 'total') {
      setAvailableValues([])
      setSelectedValues([])
      return
    }

    setValuesLoading(true)
    fetch('/api/dashboard/values', {
      method: 'POST',
      body: JSON.stringify({ lens }),
    }).then(res => res.json()).then(data => {
      const vals = data.values || []
      setAvailableValues(vals)
      setSelectedValues(vals.map((item: any) => item.value))
      setValuesLoading(false)
    }).catch(err => {
      console.error(err)
      setValuesLoading(false)
    })
  }, [lens])

  useEffect(() => {
    setLoading(true)
    const payload = {
      lens,
      selectedValues: lens === 'total' ? [] : selectedValues,
      aggregate,
      benchmarks: selectedBenchmarks,
    }
    fetch('/api/performance/time-series', {
      method: 'POST',
      body: JSON.stringify(payload),
      cache: 'no-store',
    }).then(res => res.json()).then(data => {
      setTimeSeries(data.series || {})
      setLoading(false)
    }).catch(err => {
      console.error(err)
      setLoading(false)
    })
  }, [lens, selectedValues, aggregate, selectedBenchmarks, refreshing])

  const toggleValue = (value: string) => {
    setSelectedValues(prev =>
      prev.includes(value) ? prev.filter(v => v !== value) : [...prev, value]
    )
  }

  const toggleBenchmark = (value: string) => {
    setSelectedBenchmarks(prev =>
      prev.includes(value) ? prev.filter(v => v !== value) : [...prev, value]
    )
  }

  const handleRefresh = async () => {
    setRefreshing(true)
    setRefreshMessage(null)
    try {
      const result = await fetch('/api/fetch-prices').then(res => res.json())
      setRefreshMessage(result.message || 'Prices refreshed!')
      setRefreshing(false) // Triggers useEffect
    } catch (err) {
      setRefreshMessage('Error refreshing prices')
      setRefreshing(false)
    }
  }

  const getChartData = () => {
    if (aggregate || lens === 'total') {
      // Single series
      const rawSeries = timeSeries['aggregated'] || []
      if (rawSeries.length === 0) return []

      const first = rawSeries[0]
      return rawSeries.map(point => {
        let value: number
        switch (metric) {
          case 'totalReturn':
            const firstCostBasis = first.costBasisTotal || first.portfolioValue
            const currentNetGain = (point.investmentValue - point.costBasisTotal) + point.realized + point.income
            value = firstCostBasis > 0 ? (currentNetGain / firstCostBasis) * 100 : 0
            break
          case 'portfolioValue':
            value = point.portfolioValue
            break
          case 'netGain':
            value = point.netGain
            break
          case 'unrealized':
            value = point.unrealized
            break
          case 'realized':
            value = point.realized
            break
          case 'income':
            value = point.income
            break
          default:
            value = 0
        }
        const bmData: Record<string, number> = {}
        if (metric === 'totalReturn') {
          selectedBenchmarks.forEach(bm => {
            const firstBm = first.benchmarkValues[bm] || 1
            bmData[bm] = firstBm > 0 ? ((point.benchmarkValues[bm] / firstBm) - 1) * 100 : 0
          })
        }
        return { date: point.date, Portfolio: value, ...bmData }
      })
    } else {
      // Multiple series combined
      const allSlices = Object.keys(timeSeries).filter(key => key !== 'aggregated')
      if (allSlices.length === 0) return []

      const dateMap = new Map<string, { date: string } & Record<string, number>>()

      allSlices.forEach(sliceKey => {
        const rawSeries = timeSeries[sliceKey] || []
        if (rawSeries.length === 0) return

        const first = rawSeries[0]
        rawSeries.forEach(point => {
          if (!dateMap.has(point.date)) {
            dateMap.set(point.date, { date: point.date } as { date: string } & Record<string, number>)
          }
          let value: number
          switch (metric) {
            case 'totalReturn':
              const sliceFirstCostBasis = first.costBasisTotal || first.portfolioValue
              const sliceCurrentNetGain = (point.investmentValue - point.costBasisTotal) + point.realized + point.income
              value = sliceFirstCostBasis > 0 ? (sliceCurrentNetGain / sliceFirstCostBasis) * 100 : 0
              break
            case 'portfolioValue':
              value = point.portfolioValue
              break
            case 'netGain':
              value = point.netGain
              break
            case 'unrealized':
              value = point.unrealized
              break
            case 'realized':
              value = point.realized
              break
            case 'income':
              value = point.income
              break
            default:
              value = 0
          }
          dateMap.get(point.date)![sliceKey] = value
        })
      })

      return Array.from(dateMap.values()).sort((a, b) => a.date.localeCompare(b.date))
    }
  }

  return (
    <div className="space-y-8">
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
            <Label>Select {LENSES.find(l => l.value === lens)?.label}s {valuesLoading && '(loading...)'}</Label>
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

        <div>
          <Label>Metric</Label>
          <Select value={metric} onValueChange={setMetric}>
            <SelectTrigger className="w-56">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {METRICS.map(m => <SelectItem key={m.value} value={m.value}>{m.label}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>

        {metric === 'totalReturn' && (
          <div className="min-w-64">
            <Label>Benchmarks (for Return chart)</Label>
            <Popover>
              <PopoverTrigger asChild>
                <Button variant="outline" className="w-full justify-between">
                  {selectedBenchmarks.length === BENCH_OPTIONS.length ? 'All selected' :
                   selectedBenchmarks.length === 0 ? 'None selected' :
                   `${selectedBenchmarks.length} selected`}
                  <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-full p-0">
                <Command>
                  <CommandInput placeholder="Search..." />
                  <CommandList>
                    <CommandEmpty>No benchmarks found.</CommandEmpty>
                    <CommandGroup>
                      {BENCH_OPTIONS.map(item => (
                        <CommandItem key={item.value} onSelect={() => toggleBenchmark(item.value)}>
                          <Check className={cn("mr-2 h-4 w-4", selectedBenchmarks.includes(item.value) ? "opacity-100" : "opacity-0")} />
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

        <Button onClick={handleRefresh} disabled={refreshing}>
          {refreshing ? 'Refreshing...' : 'Refresh Prices'}
        </Button>
        {refreshMessage && <span className="text-sm text-green-600">{refreshMessage}</span>}
      </div>

      {loading ? (
        <div className="text-center py-12">Loading performance data...</div>
      ) : getChartData().length === 0 ? (
        <div className="text-center py-12 text-muted-foreground">No data available. Add transactions to generate reports.</div>
      ) : (
        <div className="space-y-4 pl-16">
          <ResponsiveContainer width="100%" height={400}>
            <LineChart data={getChartData()}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="date" />
              <YAxis tickFormatter={(v) => v !== undefined ? (metric === 'totalReturn' ? `${v.toFixed(1)}%` : formatUSD(v)) : ''} />
              <Tooltip formatter={(v: number | undefined) => v !== undefined ? (metric === 'totalReturn' ? `${v.toFixed(2)}%` : formatUSD(v)) : ''} />
              <Legend />
              {aggregate || lens === 'total' ? (
                <>
                  <Line type="monotone" dataKey="Portfolio" stroke={COLORS[0]} />
                  {metric === 'totalReturn' && selectedBenchmarks.map((bm, i) => (
                    <Line key={bm} type="monotone" dataKey={bm} name={BENCH_OPTIONS.find(b => b.value === bm)?.label} stroke={COLORS[i + 1]} />
                  ))}
                </>
              ) : (
                Object.keys(timeSeries).filter(key => key !== 'aggregated').map((sliceKey, i) => (
                  <Line key={sliceKey} type="monotone" dataKey={sliceKey} name={sliceKey} stroke={COLORS[i % COLORS.length]} />
                ))
              )}
            </LineChart>
          </ResponsiveContainer>
        </div>
      )}
    </div>
  )
}