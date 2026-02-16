'use client'

import { useMemo, useState, useEffect, Fragment } from 'react'
import { ResponsiveContainer, LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend } from 'recharts'
import CombinedMetricsCharts from '@/components/charts/CombinedMetricsCharts'
import { Button } from '@/components/ui/button'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from '@/components/ui/command'
import { Switch } from '@/components/ui/switch'
import { Label } from '@/components/ui/label'
import { Check, ChevronsUpDown, RefreshCw } from 'lucide-react'
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

const PERIODS = [
  { value: '1M', label: '1M' },
  { value: '3M', label: '3M' },
  { value: '1Y', label: '1Y' },
  { value: '3Y', label: '3Y' },
  { value: '5Y', label: '5Y' },
  { value: 'inception', label: 'From Inception' },
  { value: 'All', label: 'All' },
  { value: 'custom', label: 'Custom' },
]

const BENCHMARKS = [
  { value: 'sp500', label: 'S&P 500' },
  { value: 'nasdaq', label: 'Nasdaq' },
  { value: 'tlt', label: 'TLT' },
  { value: 'vxus', label: 'VXUS (Ex-US)' },
  { value: '6040', label: '60/40' },
]

const METRIC_CARDS = [
  { key: 'netGain', label: 'Net Gain / Loss' },
  { key: 'income', label: 'Income' },
  { key: 'realized', label: 'Realized G/L' },
  { key: 'unrealized', label: 'Unrealized G/L' },
  { key: 'irr', label: 'Annual IRR %', type: 'percent' },
  { key: 'totalReturnPct', label: 'Total Return %', type: 'percent' },
]

const SERIES_METRICS = [
  { key: 'netGain', label: 'Net Gain / Loss' },
  { key: 'income', label: 'Income' },
  { key: 'realized', label: 'Realized G/L' },
  { key: 'unrealized', label: 'Unrealized G/L' },
]

const chartFormatter = (value: number, mode: 'percent' | 'dollar') => {
  if (mode === 'percent') return `${value.toFixed(2)}%`
  return formatUSD(value)
}

type ValuesResponse = { values: { value: string, label: string }[] }

type ReportsResponse = {
  series: Record<string, any[]>
  totals: Record<string, any>
  benchmarks: Record<string, { date: string, value: number }[]>
  assetSeries?: Record<string, Record<string, any[]>> // group -> asset -> data (for non-aggregate mode)
  assetTotals?: Record<string, Record<string, any>> // group -> asset -> totals
  assetBreakdown?: Record<string, any[]> // asset -> data (for total portfolio non-aggregate)
}

export default function PerformanceReports() {
  const [lens, setLens] = useState('total')
  const [availableValues, setAvailableValues] = useState<{ value: string, label: string }[]>([])
  const [selectedValues, setSelectedValues] = useState<string[]>([])
  const [aggregate, setAggregate] = useState(true)
  const [period, setPeriod] = useState('1Y')
  const [customStart, setCustomStart] = useState('')
  const [customEnd, setCustomEnd] = useState('')
  const [granularity, setGranularity] = useState<'daily' | 'monthly'>('monthly')
  const [valueMode, setValueMode] = useState<'percent' | 'dollar'>('percent')
  const [returnMode, setReturnMode] = useState<'both' | 'twr' | 'mwr'>('both')
  const [selectedBenchmarks, setSelectedBenchmarks] = useState<string[]>([])
  const [loading, setLoading] = useState(false)
  const [data, setData] = useState<ReportsResponse | null>(null)
  const [valuesLoading, setValuesLoading] = useState(false)
  const axisWidth = valueMode === 'percent' ? 72 : 104

  const refreshValues = async () => {
    if (lens === 'total') return
    setValuesLoading(true)
    try {
      const res = await fetch('/api/dashboard/values', {
        method: 'POST',
        body: JSON.stringify({ lens }),
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
      })
      const json = await res.json() as ValuesResponse
      setAvailableValues(json.values || [])
      setSelectedValues((json.values || []).map(v => v.value))
    } finally {
      setValuesLoading(false)
    }
  }

  const fetchReports = async () => {
    setLoading(true)
    try {
      const payload = {
        lens,
        selectedValues: lens === 'total' ? [] : selectedValues,
        aggregate,
        period,
        startDate: period === 'custom' ? customStart : undefined,
        endDate: period === 'custom' ? customEnd : undefined,
        granularity,
        benchmarks: selectedBenchmarks,
      }
      const res = await fetch('/api/performance/reports', {
        method: 'POST',
        body: JSON.stringify(payload),
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
      })
      const json = await res.json() as ReportsResponse
      setData(json)
    } finally {
      setLoading(false)
    }
  }

  const refreshPrices = async () => {
    setLoading(true)
    try {
      // Trigger price refresh for portfolio assets and benchmarks
      await fetch('/api/fetch-prices', { method: 'POST', credentials: 'include' })
      // Re-fetch reports with fresh prices
      await fetchReports()
    } finally {
      setLoading(false)
    }
  }

  const toggleValue = (value: string) => {
    setSelectedValues(prev => prev.includes(value) ? prev.filter(v => v !== value) : [...prev, value])
  }

  const toggleBenchmark = (value: string) => {
    setSelectedBenchmarks(prev => prev.includes(value) ? prev.filter(v => v !== value) : [...prev, value])
  }

  useEffect(() => {
    if (lens !== 'total') refreshValues()
    else {
      setAvailableValues([])
      setSelectedValues([])
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lens])

  useEffect(() => {
    fetchReports()
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lens, selectedValues, aggregate, period, customStart, customEnd, granularity, selectedBenchmarks])

  // Main chart series (aggregate mode or total portfolio)
  const chartSeries = useMemo(() => {
    if (!data?.series) return []
    const seriesKeys = Object.keys(data.series)

    const mapped: any[] = []
    seriesKeys.forEach(key => {
      const points = data.series[key] || []
      points.forEach((p, idx) => {
        if (!mapped[idx]) mapped[idx] = { date: p.date }
        mapped[idx][`${key}-twr`] = valueMode === 'percent' ? p.twr : p.portfolioValue
        mapped[idx][`${key}-mwr`] = valueMode === 'percent' ? p.irr : p.netGain
        // Show benchmarks only in aggregate/total view
        if (valueMode === 'percent' && data.benchmarks) {
          Object.entries(data.benchmarks).forEach(([bmKey, bmSeries]) => {
            const match = bmSeries.find(b => b.date === p.date)
            mapped[idx][bmKey] = match?.value ?? 0
          })
        }
      })
    })
    return mapped
  }, [data, valueMode])

  // Non-aggregate mode: build series for each group (lens != total)
  const assetChartSeries = useMemo(() => {
    if (!data?.assetSeries) return {}
    const result: Record<string, any[]> = {}
    
    Object.entries(data.assetSeries).forEach(([groupKey, assets]) => {
      const mapped: any[] = []
      Object.entries(assets).forEach(([assetKey, points]) => {
        points.forEach((p, idx) => {
          if (!mapped[idx]) mapped[idx] = { date: p.date }
          mapped[idx][`${assetKey}-twr`] = valueMode === 'percent' ? p.twr : p.portfolioValue
          mapped[idx][`${assetKey}-mwr`] = valueMode === 'percent' ? p.irr : p.netGain
        })
      })
      result[groupKey] = mapped
    })
    return result
  }, [data?.assetSeries, valueMode])

  // Total portfolio non-aggregate: asset breakdown
  const totalPortfolioAssetSeries = useMemo(() => {
    if (!data?.assetBreakdown) return {}
    const mapped: any[] = []
    const assetKeys = Object.keys(data.assetBreakdown)
    
    assetKeys.forEach(key => {
      const points = data.assetBreakdown![key] || []
      points.forEach((p, idx) => {
        if (!mapped[idx]) mapped[idx] = { date: p.date }
        mapped[idx][`${key}-twr`] = valueMode === 'percent' ? p.twr : p.portfolioValue
        mapped[idx][`${key}-mwr`] = valueMode === 'percent' ? p.irr : p.netGain
      })
    })
    return { 'Total Portfolio': mapped }
  }, [data?.assetBreakdown, valueMode])

  // Metric series for aggregate mode
  const metricSeries = (metricKey: string) => {
    const seriesKeys = Object.keys(data?.series || {})
    const mapped: any[] = []
    seriesKeys.forEach(key => {
      const points = data?.series?.[key] || []
      points.forEach((p, idx) => {
        if (!mapped[idx]) mapped[idx] = { date: p.date }
        mapped[idx][key] = p[metricKey]
      })
    })
    return mapped
  }

  // Metric series for non-aggregate mode (per group)
  interface MetricsPoint {
    date: string
    netGain: number
    income: number
    realized: number
    unrealized: number
  }

  interface MetricsData {
    series: Record<string, MetricsPoint[]>
    totals: Record<string, { netGain: number; income: number; realized: number; unrealized: number }>
  }

  // Get metrics data for group (for CombinedCharts)
  const getGroupMetricsData = (groupKey: string, data: ReportsResponse) => {
    const assetSeries = data.assetSeries?.[groupKey] || {}
    const sliceSeries: Record<string, MetricsPoint[]> = {}
    Object.entries(assetSeries).forEach(([assetKey, points]) => {
      sliceSeries[assetKey] = points.map(p => ({
        date: p.date,
        netGain: p.netGain || 0,
        income: p.income || 0,
        realized: p.realized || 0,
        unrealized: p.unrealized || 0,
      }))
    })

    const sliceTotals: Record<string, any> = {}
    const assetTotals = data.assetTotals?.[groupKey] || {}
    Object.entries(assetTotals).forEach(([assetKey, totals]) => {
      sliceTotals[assetKey] = {
        netGain: totals.netGain || 0,
        income: totals.income || 0,
        realized: totals.realized || 0,
        unrealized: totals.unrealized || 0,
      }
    })
    return { series: sliceSeries, totals: sliceTotals }
  }

  const getTotalPortfolioMetricsData = (data: ReportsResponse) => {
    const sliceSeries: Record<string, MetricsPoint[]> = {}
    if (data.assetBreakdown) {
      Object.entries(data.assetBreakdown).forEach(([assetKey, points]) => {
        sliceSeries[assetKey] = points.map(p => ({
          date: p.date,
          netGain: p.netGain || 0,
          income: p.income || 0,
          realized: p.realized || 0,
          unrealized: p.unrealized || 0,
        }))
      })
    }

    const sliceTotals: Record<string, any> = {}
    // Sum asset totals for portfolio
    const totalsSum = { netGain: 0, income: 0, realized: 0, unrealized: 0 }
    Object.entries(data.assetTotals || {}).forEach(([_, assets]) => {
      Object.values(assets).forEach((totals: any) => {
        totalsSum.netGain += totals.netGain || 0
        totalsSum.income += totals.income || 0
        totalsSum.realized += totals.realized || 0
        totalsSum.unrealized += totals.unrealized || 0
      })
    })
    sliceTotals['aggregated'] = totalsSum
    return { series: sliceSeries, totals: sliceTotals }
  }

  // Get totals based on mode
  const totals = useMemo(() => {
    if (!data) return {}
    if (lens === 'total' || aggregate) {
      // For total lens or aggregate mode, use the first (or only) series totals
      const firstKey = Object.keys(data.totals || {})[0]
      return data.totals?.[firstKey] || {}
    }
    // Non-aggregate mode: sum across all groups
    const result = { netGain: 0, income: 0, realized: 0, unrealized: 0, totalReturnPct: 0, irr: 0 }
    let count = 0
    Object.values(data.totals || {}).forEach((t: any) => {
      result.netGain += t?.netGain || 0
      result.income += t?.income || 0
      result.realized += t?.realized || 0
      result.unrealized += t?.unrealized || 0
      result.totalReturnPct += t?.totalReturnPct || 0
      result.irr += t?.irr || 0
      count++
    })
    if (count > 0) {
      result.totalReturnPct /= count
      result.irr /= count
    }
    return result
  }, [data, lens, aggregate])

  return (
    <div className="space-y-10">
      <div className="flex flex-wrap gap-4 items-end">
        <div>
          <Label>Slice by</Label>
          <Select value={lens} onValueChange={setLens}>
            <SelectTrigger className="w-56"><SelectValue /></SelectTrigger>
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
                          <Check className={cn('mr-2 h-4 w-4', selectedValues.includes(item.value) ? 'opacity-100' : 'opacity-0')} />
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

        {lens === 'total' ? (
          <div className="flex items-center gap-2">
            <Switch checked={aggregate} onCheckedChange={setAggregate} />
            <Label>Aggregate</Label>
          </div>
        ) : selectedValues.length > 1 && (
          <div className="flex items-center gap-2">
            <Switch checked={aggregate} onCheckedChange={setAggregate} />
            <Label>Aggregate selected</Label>
          </div>
        )}

        <div>
          <Label>Period</Label>
          <Select value={period} onValueChange={setPeriod}>
            <SelectTrigger className="w-32"><SelectValue /></SelectTrigger>
            <SelectContent>
              {PERIODS.map(p => <SelectItem key={p.value} value={p.value}>{p.label}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>

        {period === 'custom' && (
          <div className="flex items-center gap-2">
            <input type="date" value={customStart} onChange={(e) => setCustomStart(e.target.value)} className="border rounded px-2 py-1" />
            <span>to</span>
            <input type="date" value={customEnd} onChange={(e) => setCustomEnd(e.target.value)} className="border rounded px-2 py-1" />
          </div>
        )}

        <div>
          <Label>Granularity</Label>
          <Select value={granularity} onValueChange={(val) => setGranularity(val as 'daily' | 'monthly')}>
            <SelectTrigger className="w-32"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="daily">Daily</SelectItem>
              <SelectItem value="monthly">Monthly</SelectItem>
            </SelectContent>
          </Select>
        </div>

        <div>
          <Label>Value</Label>
          <Select value={valueMode} onValueChange={(val) => setValueMode(val as 'percent' | 'dollar')}>
            <SelectTrigger className="w-32"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="percent">% Return</SelectItem>
              <SelectItem value="dollar">$ Return</SelectItem>
            </SelectContent>
          </Select>
        </div>

        <div>
          <Label>Return Type</Label>
          <Select value={returnMode} onValueChange={(val) => setReturnMode(val as 'both' | 'twr' | 'mwr')}>
            <SelectTrigger className="w-32"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="both">MWR + TWR</SelectItem>
              <SelectItem value="twr">TWR only</SelectItem>
              <SelectItem value="mwr">MWR only</SelectItem>
            </SelectContent>
          </Select>
        </div>

        <div className="min-w-64">
          <Label>Benchmarks</Label>
          <Popover>
            <PopoverTrigger asChild>
              <Button variant="outline" className="w-full justify-between">
                {selectedBenchmarks.length === BENCHMARKS.length ? 'All selected' :
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
                    {BENCHMARKS.map(item => (
                      <CommandItem key={item.value} onSelect={() => toggleBenchmark(item.value)}>
                        <Check className={cn('mr-2 h-4 w-4', selectedBenchmarks.includes(item.value) ? 'opacity-100' : 'opacity-0')} />
                        {item.label}
                      </CommandItem>
                    ))}
                  </CommandGroup>
                </CommandList>
              </Command>
            </PopoverContent>
          </Popover>
        </div>

        <div>
          <Label className="invisible">Refresh</Label>
          <Button 
            onClick={refreshPrices} 
            disabled={loading} 
            size="sm" 
            variant="default" 
            className="bg-black text-white hover:bg-zinc-800 ml-auto flex items-center h-9 px-4 transition-all shadow-black/20 font-bold"
          >
            <RefreshCw className={cn("w-4 h-4 mr-2", loading && "animate-spin")} />
            {loading ? 'Hold...' : 'Refresh Prices'}
          </Button>
        </div>
      </div>

      {loading && <div className="text-center py-12">Loading performance reports...</div>}

      {!loading && (
        <>
          <div className="grid grid-cols-1 lg:grid-cols-4 gap-4">
            {METRIC_CARDS.map(card => (
              <div key={card.key} className="border rounded-lg p-4">
                <div className="text-sm text-muted-foreground">{card.label}</div>
                <div className="text-xl font-semibold">
                  {card.type === 'percent'
                    ? `${(totals?.[card.key] || 0).toFixed(2)}%`
                    : formatUSD(totals?.[card.key] || 0)}
                </div>
              </div>
            ))}
          </div>

          {/* Aggregate Mode: Single chart with group-level lines */}
          {aggregate && (
            <div className="space-y-4 rounded-xl border bg-card p-5 shadow-sm overflow-hidden">
              <div className="flex items-center justify-between">
                <h3 className="text-lg font-semibold">MWR / TWR Performance</h3>
                <div className="text-sm text-muted-foreground">(MWR = IRR, TWR = time‑weighted)</div>
              </div>
              {valueMode === 'dollar' && (
                <div className="text-sm text-muted-foreground">
                  Benchmarks are hidden in $ mode (benchmark series are % returns).
                </div>
              )}
              <div className="h-[420px] w-full">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={chartSeries} margin={{ top: 20, right: 36, left: 24, bottom: 20 }}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="date" minTickGap={24} tickMargin={8} />
                  <YAxis 
                    tickFormatter={(v) => chartFormatter(v ?? 0, valueMode)} 
                    domain={['auto', 'auto']}
                    padding={{ top: 20, bottom: 20 }}
                    width={axisWidth}
                    tickMargin={8}
                  />
                  <Tooltip formatter={(v) => chartFormatter((v as number) ?? 0, valueMode)} />
                  <Legend />
                  {lens === 'total' ? (
                    // Total portfolio: single portfolio line + benchmarks
                    <>
                      {(returnMode === 'both' || returnMode === 'twr') && (
                        <Line type="monotone" dataKey="aggregated-twr" name="Portfolio TWR" stroke={COLORS[0]} />
                      )}
                      {(returnMode === 'both' || returnMode === 'mwr') && (
                        <Line type="monotone" dataKey="aggregated-mwr" name="Portfolio MWR" stroke={COLORS[1]} />
                      )}
                      {Object.keys(data?.benchmarks || {}).map((bm, i) => (
                        <Line key={bm} type="monotone" dataKey={bm} name={BENCHMARKS.find(b => b.value === bm)?.label || bm} stroke={COLORS[i + 2]} />
                      ))}
                    </>
                  ) : (
                    // Non-total lens with aggregate=true: show each group as a line
                    Object.keys(data?.series || {}).map((key, i) => (
                      <Fragment key={key}>
                        {(returnMode === 'both' || returnMode === 'twr') && (
                          <Line type="monotone" dataKey={`${key}-twr`} name={`${key} TWR`} stroke={COLORS[i % COLORS.length]} />
                        )}
                        {(returnMode === 'both' || returnMode === 'mwr') && (
                          <Line type="monotone" dataKey={`${key}-mwr`} name={`${key} MWR`} stroke={COLORS[(i + 1) % COLORS.length]} />
                        )}
                      </Fragment>
                    ))
                  )}
                </LineChart>
              </ResponsiveContainer>
              </div>
            </div>
          )}

          {/* Non-Aggregate Mode: Multiple charts, one per group with asset lines */}
          {!aggregate && lens !== 'total' && (
            <div className="space-y-8">
              <h3 className="text-lg font-semibold">MWR / TWR Performance by Asset</h3>
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                {Object.entries(assetChartSeries).map(([groupKey, seriesData]) => {
                  const assetKeys = Object.keys(data?.assetSeries?.[groupKey] || {})
                  return (
                    <div key={groupKey} className="space-y-3 rounded-xl border bg-card p-4 shadow-sm overflow-hidden">
                      <h4 className="font-semibold text-center border-b pb-2 truncate">{groupKey}</h4>
                      <div className="h-[340px] w-full">
                      <ResponsiveContainer width="100%" height="100%">
                        <LineChart data={seriesData} margin={{ top: 16, right: 24, left: 20, bottom: 18 }}>
                          <CartesianGrid strokeDasharray="3 3" />
                          <XAxis dataKey="date" minTickGap={24} tickMargin={8} />
                          <YAxis 
                            tickFormatter={(v) => chartFormatter(v ?? 0, valueMode)} 
                            domain={['auto', 'auto']}
                            padding={{ top: 10, bottom: 10 }}
                            width={axisWidth}
                            tickMargin={8}
                          />
                          <Tooltip formatter={(v) => chartFormatter((v as number) ?? 0, valueMode)} />
                          <Legend />
                          {(returnMode === 'both' || returnMode === 'twr') && assetKeys.map((assetKey, i) => (
                            <Line 
                              key={`${assetKey}-twr`} 
                              type="monotone" 
                              dataKey={`${assetKey}-twr`} 
                              name={`${assetKey} TWR`} 
                              stroke={COLORS[i % COLORS.length]} 
                            />
                          ))}
                          {(returnMode === 'both' || returnMode === 'mwr') && assetKeys.map((assetKey, i) => (
                            <Line 
                              key={`${assetKey}-mwr`} 
                              type="monotone" 
                              dataKey={`${assetKey}-mwr`} 
                              name={`${assetKey} MWR`} 
                              stroke={COLORS[(i + 5) % COLORS.length]} 
                              strokeDasharray="5 5"
                            />
                          ))}
                        </LineChart>
                      </ResponsiveContainer>
                      </div>
                    </div>
                  )
                })}
              </div>
            </div>
          )}

          {/* Total Portfolio Non-Aggregate: Single chart with asset lines */}
          {!aggregate && lens === 'total' && (
            <div className="space-y-4 rounded-xl border bg-card p-5 shadow-sm overflow-hidden">
              <div className="flex items-center justify-between">
                <h3 className="text-lg font-semibold">MWR / TWR Performance by Asset</h3>
                <div className="text-sm text-muted-foreground">Individual asset performance</div>
              </div>
              <div className="h-[420px] w-full">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={totalPortfolioAssetSeries['Total Portfolio'] || []} margin={{ top: 20, right: 36, left: 24, bottom: 20 }}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="date" minTickGap={24} tickMargin={8} />
                  <YAxis 
                    tickFormatter={(v) => chartFormatter(v ?? 0, valueMode)} 
                    domain={['auto', 'auto']}
                    padding={{ top: 20, bottom: 20 }}
                    width={axisWidth}
                    tickMargin={8}
                  />
                  <Tooltip formatter={(v) => chartFormatter((v as number) ?? 0, valueMode)} />
                  <Legend />
                  {Object.keys(data?.assetBreakdown || {}).map((assetKey, i) => (
                    <Fragment key={assetKey}>
                      {(returnMode === 'both' || returnMode === 'twr') && (
                        <Line type="monotone" dataKey={`${assetKey}-twr`} name={`${assetKey} TWR`} stroke={COLORS[i % COLORS.length]} />
                      )}
                      {(returnMode === 'both' || returnMode === 'mwr') && (
                        <Line type="monotone" dataKey={`${assetKey}-mwr`} name={`${assetKey} MWR`} stroke={COLORS[(i + 5) % COLORS.length]} strokeDasharray="5 5" />
                      )}
                    </Fragment>
                  ))}
                </LineChart>
              </ResponsiveContainer>
              </div>
            </div>
          )}

          {/* Metric charts for aggregate mode */}
          import CombinedMetricsCharts from '@/components/charts/CombinedMetricsCharts'

{aggregate && data && (
  <CombinedMetricsCharts data={{ series: data.series || {}, totals: data.totals || {} }} />
)}

          {/* Metric charts for non-aggregate mode - Non-total lens */}
          {!aggregate && lens !== 'total' && (
            <div className="space-y-8">
              <h3 className="text-lg font-semibold">Metrics by Asset</h3>
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                {Object.keys(data?.assetSeries || {}).map(groupKey => (
                  <div key={groupKey} className="space-y-4 border rounded-xl bg-card p-4 shadow-sm overflow-hidden">
                    <h4 className="font-semibold text-center border-b pb-2 truncate">{groupKey}</h4>
                    <div className="grid grid-cols-1 gap-4">
                      {SERIES_METRICS.map(metric => (
                        <div key={`${groupKey}-${metric.key}`} className="space-y-1 rounded-lg border bg-background/60 p-3 overflow-hidden">
                          <h5 className="text-sm text-muted-foreground">{metric.label}</h5>
                          <div className="h-[200px] w-full">
                          <ResponsiveContainer width="100%" height="100%">
                            <LineChart data={assetMetricSeries(groupKey, metric.key)} margin={{ top: 10, right: 22, left: 18, bottom: 14 }}>
                              <CartesianGrid strokeDasharray="3 3" />
                              <XAxis dataKey="date" fontSize={10} minTickGap={20} tickMargin={6} />
                              <YAxis 
                                tickFormatter={(v) => formatUSD(v ?? 0)} 
                                fontSize={10}
                                domain={['auto', 'auto']}
                                width={96}
                                tickMargin={6}
                              />
                              <Tooltip formatter={(v) => formatUSD((v as number) ?? 0)} />
                              <Legend fontSize={10} />
                              {Object.keys(data?.assetSeries?.[groupKey] || {}).map((assetKey, i) => (
                                <Line 
                                  key={assetKey} 
                                  type="monotone" 
                                  dataKey={assetKey} 
                                  name={assetKey} 
                                  stroke={COLORS[i % COLORS.length]} 
                                />
                              ))}
                            </LineChart>
                          </ResponsiveContainer>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Metric charts for non-aggregate mode - Total Portfolio lens */}
          {!aggregate && lens === 'total' && (
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              {SERIES_METRICS.map(metric => (
                <div key={metric.key} className="space-y-2 rounded-xl border bg-card p-4 shadow-sm overflow-hidden">
                  <h4 className="font-semibold">{metric.label} by Asset</h4>
                  <div className="h-[290px] w-full">
                  <ResponsiveContainer width="100%" height="100%">
                    <LineChart data={assetMetricSeries('Total Portfolio', metric.key)} margin={{ top: 16, right: 28, left: 20, bottom: 18 }}>
                      <CartesianGrid strokeDasharray="3 3" />
                      <XAxis dataKey="date" minTickGap={24} tickMargin={8} />
                      <YAxis 
                        tickFormatter={(v) => formatUSD(v ?? 0)} 
                        domain={['auto', 'auto']}
                        padding={{ top: 20, bottom: 20 }}
                        width={104}
                        tickMargin={8}
                      />
                      <Tooltip formatter={(v) => formatUSD((v as number) ?? 0)} />
                      <Legend />
                      {Object.keys(data?.assetBreakdown || {}).map((assetKey, i) => (
                        <Line key={assetKey} type="monotone" dataKey={assetKey} name={assetKey} stroke={COLORS[i % COLORS.length]} />
                      ))}
                    </LineChart>
                  </ResponsiveContainer>
                  </div>
                </div>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  )
}
