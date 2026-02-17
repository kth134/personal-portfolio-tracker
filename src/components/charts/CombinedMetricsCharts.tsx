'use client'

import { ResponsiveContainer, LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, BarChart, Bar, Cell, ReferenceLine } from 'recharts'
import { useMemo } from 'react'
import { Card, CardContent } from '@/components/ui/card'

const COLORS = {
  net: '#3b82f6',
  income: '#10b981',
  realized: '#f59e0b',
  unrealized: '#ef4444',
  total: '#334155',
  positive: '#10b981',
  negative: '#ef4444',
}

interface MetricsPoint {
  date: string
  netGain?: number
  income?: number
  realized?: number
  unrealized?: number
  portfolioValue?: number
}

interface MetricsData {
  series: Record<string, MetricsPoint[]>
  totals: Record<string, { netGain: number; income: number; realized: number; unrealized: number }>
}

interface Props {
  data: MetricsData | null
  height?: number
}

type TooltipEntry = {
  name?: string
  value?: number | string
}

type TooltipState = {
  active?: boolean
  payload?: TooltipEntry[]
}

type WaterfallRow = {
  name: string
  offset: number
  value: number
  delta: number
  cumulative: number
  fill: string
  isTotal: boolean
}

export default function CombinedMetricsCharts({ data, height = 450 }: Props) {
  const formatUSDWhole = (value: number) => new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(value || 0)

  const axisFormatter = (value: number) => new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    notation: 'compact',
    maximumFractionDigits: 0,
  }).format(value || 0)

  const combinedLineData = useMemo((): MetricsPoint[] => {
    if (!data?.series) return []
    type AggregatedPoint = {
      date: string
      netGain: number
      income: number
      realized: number
      unrealized: number
      portfolioValue: number
    }
    const dateAgg = new Map<string, AggregatedPoint>()
    Object.values(data.series).forEach(points => {
      points.forEach(p => {
        const key = p.date
        const agg = dateAgg.get(key) || { date: key, netGain: 0, income: 0, realized: 0, unrealized: 0, portfolioValue: 0 }
        agg.netGain += p.netGain || 0
        agg.income += p.income || 0
        agg.realized += p.realized || 0
        agg.unrealized += p.unrealized || 0
        agg.portfolioValue = (agg.portfolioValue || 0) + (p.portfolioValue || 0)
        dateAgg.set(key, agg)
      })
    })
    return Array.from(dateAgg.values()).sort((a, b) => a.date.localeCompare(b.date))
  }, [data])

  const valueBridgeData = useMemo<WaterfallRow[]>(() => {
    if (!combinedLineData.length) return []

    const firstPoint = combinedLineData[0]
    const lastPoint = combinedLineData[combinedLineData.length - 1]

    const startValue = Number(firstPoint?.portfolioValue ?? 0)
    const endValue = Number(lastPoint?.portfolioValue ?? 0)

    // Use period deltas so each bar is a true step from left-to-right.
    const incomeDelta = Number(lastPoint?.income ?? 0) - Number(firstPoint?.income ?? 0)
    const realizedDelta = Number(lastPoint?.realized ?? 0) - Number(firstPoint?.realized ?? 0)
    const unrealizedDelta = endValue - startValue - incomeDelta - realizedDelta

    const c0 = startValue
    const c1 = c0 + incomeDelta
    const c2 = c1 + realizedDelta
    const c3 = c2 + unrealizedDelta

    return [
      {
        name: 'Starting Value',
        offset: 0,
        value: Math.abs(startValue),
        delta: startValue,
        cumulative: c0,
        fill: COLORS.total,
        isTotal: true,
      },
      {
        name: 'Income',
        offset: Math.min(c0, c1),
        value: Math.abs(incomeDelta),
        delta: incomeDelta,
        cumulative: c1,
        fill: incomeDelta >= 0 ? COLORS.positive : COLORS.negative,
        isTotal: false,
      },
      {
        name: 'Realized G/L',
        offset: Math.min(c1, c2),
        value: Math.abs(realizedDelta),
        delta: realizedDelta,
        cumulative: c2,
        fill: realizedDelta >= 0 ? COLORS.positive : COLORS.negative,
        isTotal: false,
      },
      {
        name: 'Unrealized G/L',
        offset: Math.min(c2, c3),
        value: Math.abs(unrealizedDelta),
        delta: unrealizedDelta,
        cumulative: c3,
        fill: unrealizedDelta >= 0 ? COLORS.positive : COLORS.negative,
        isTotal: false,
      },
      {
        name: 'Ending Value',
        offset: 0,
        value: Math.abs(endValue),
        delta: endValue,
        cumulative: endValue,
        fill: COLORS.total,
        isTotal: true,
      },
    ]
  }, [combinedLineData, data])

  const waterfallTooltip = ({ active, payload }: any) => {
    if (!active || !payload?.length) return null
    const row = payload[0]?.payload
    if (!row) return null

    return (
      <div className="rounded-md border bg-background p-2 text-xs shadow-sm">
        <div className="font-medium mb-1">{row.name}</div>
        <div>{row.isTotal ? 'Value' : 'Change'}: {formatUSDWhole(row.delta)}</div>
        {!row.isTotal && <div>Running Total: {formatUSDWhole(row.cumulative)}</div>}
      </div>
    )
  }

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 min-w-0">
      <Card className="rounded-xl border bg-card shadow-sm overflow-hidden min-w-0">
        <CardContent className="p-4 sm:p-5" style={{ minHeight: `${height}px` }}>
          <h4 className="text-lg font-semibold mb-1">
            Metrics Evolution
          </h4>
          <p className="text-sm text-muted-foreground mb-4">Aggregated over the selected period</p>
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={combinedLineData} margin={{ top: 12, right: 14, left: 8, bottom: 28 }}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="date" minTickGap={24} tickMargin={10} tick={{ fontSize: 11 }} />
              <YAxis tickFormatter={axisFormatter} tickMargin={10} width={108} />
              <Tooltip formatter={(value) => formatUSDWhole(Number(value || 0))} />
              <Legend />
              <Line type="monotone" dataKey="netGain" name="Net G/L" stroke={COLORS.net} strokeWidth={2.5} dot={false} />
              <Line type="monotone" dataKey="income" name="Income" stroke={COLORS.income} strokeWidth={2} dot={false} />
              <Line type="monotone" dataKey="realized" name="Realized" stroke={COLORS.realized} strokeWidth={2} dot={false} />
              <Line type="monotone" dataKey="unrealized" name="Unrealized" stroke={COLORS.unrealized} strokeWidth={2} dot={false} />
            </LineChart>
          </ResponsiveContainer>
        </CardContent>
      </Card>

      <Card className="rounded-xl border bg-card shadow-sm overflow-hidden min-w-0">
        <CardContent className="p-4 sm:p-5" style={{ minHeight: `${height}px` }}>
          <h4 className="text-lg font-semibold mb-1">
            Waterfall Build
          </h4>
          <p className="text-sm text-muted-foreground mb-4">Floating-step build from starting value to ending value</p>
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={valueBridgeData} margin={{ top: 16, right: 14, left: 8, bottom: 36 }} barCategoryGap={16}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="name" tick={{ fontSize: 11 }} interval={0} angle={-18} textAnchor="end" height={78} />
              <YAxis tickFormatter={axisFormatter} tickMargin={10} width={108} />
              <ReferenceLine y={0} stroke="#94a3b8" strokeDasharray="4 4" />
              <Tooltip content={waterfallTooltip} />
              <Bar dataKey="offset" stackId="wf" fill="transparent" stroke="transparent" isAnimationActive={false} />
              <Bar dataKey="value" stackId="wf" radius={[6, 6, 0, 0]} barSize={38}>
                {valueBridgeData.map((entry) => (
                  <Cell key={entry.name} fill={entry.fill} stroke={entry.fill} strokeWidth={1} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </CardContent>
      </Card>
    </div>
  )
}
