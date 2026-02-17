'use client'

import { ResponsiveContainer, LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, BarChart, Bar, Cell, ReferenceLine } from 'recharts'
import { formatUSD } from '@/lib/formatters'
import { useMemo } from 'react'
import { Card, CardContent } from '@/components/ui/card'

const COLORS = {
  net: '#3b82f6',
  income: '#10b981',
  realized: '#f59e0b',
  unrealized: '#ef4444',
  start: '#8b5cf6',
  end: '#06b6d4',
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

export default function CombinedMetricsCharts({ data, height = 450 }: Props) {
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

  const valueBridgeData = useMemo(() => {
    const totalsList = Object.values(data?.totals || {}) as Array<{ netGain?: number; income?: number; realized?: number; unrealized?: number }>
    if (!totalsList.length) return []

    const i = totalsList.reduce((sum, t) => sum + Number(t?.income || 0), 0)
    const r = totalsList.reduce((sum, t) => sum + Number(t?.realized || 0), 0)
    const u = totalsList.reduce((sum, t) => sum + Number(t?.unrealized || 0), 0)
    const netGain = i + r + u
    const firstPoint = combinedLineData[0]
    const lastPoint = combinedLineData[combinedLineData.length - 1]
    const endValue = Number(lastPoint?.portfolioValue ?? 0)
    const startValue = Number(firstPoint?.portfolioValue ?? (endValue - netGain))

    return [
      { name: 'Starting Value', value: startValue, fill: COLORS.start },
      { name: 'Income', value: i, fill: i >= 0 ? COLORS.income : COLORS.unrealized },
      { name: 'Realized G/L', value: r, fill: r >= 0 ? COLORS.realized : COLORS.unrealized },
      { name: 'Unrealized G/L', value: u, fill: u >= 0 ? COLORS.net : COLORS.unrealized },
      { name: 'Ending Value', value: endValue, fill: COLORS.end },
    ]
  }, [combinedLineData, data])

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
      <Card className="rounded-xl border bg-card shadow-sm overflow-hidden">
        <CardContent className="p-5" style={{ minHeight: `${height}px` }}>
          <h4 className="text-lg font-semibold mb-1">
            Metrics Evolution
          </h4>
          <p className="text-sm text-muted-foreground mb-4">Aggregated over the selected period</p>
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={combinedLineData} margin={{ top: 10, right: 20, left: 0, bottom: 20 }}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="date" minTickGap={24} tickMargin={8} />
              <YAxis tickFormatter={formatUSD} tickMargin={8} width={96} />
              <Tooltip formatter={(value) => formatUSD(Number(value || 0))} />
              <Legend />
              <Line type="monotone" dataKey="netGain" name="Net G/L" stroke={COLORS.net} strokeWidth={2.5} dot={false} />
              <Line type="monotone" dataKey="income" name="Income" stroke={COLORS.income} strokeWidth={2} dot={false} />
              <Line type="monotone" dataKey="realized" name="Realized" stroke={COLORS.realized} strokeWidth={2} dot={false} />
              <Line type="monotone" dataKey="unrealized" name="Unrealized" stroke={COLORS.unrealized} strokeWidth={2} dot={false} />
            </LineChart>
          </ResponsiveContainer>
        </CardContent>
      </Card>

      <Card className="rounded-xl border bg-card shadow-sm overflow-hidden">
        <CardContent className="p-5" style={{ minHeight: `${height}px` }}>
          <h4 className="text-lg font-semibold mb-1">
            Waterfall Build
          </h4>
          <p className="text-sm text-muted-foreground mb-4">Start value, return components, and ending value</p>
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={valueBridgeData} margin={{ top: 20, right: 24, left: 8, bottom: 24 }} barCategoryGap={22}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="name" tick={{ fontSize: 11 }} interval={0} angle={-12} textAnchor="end" height={68} />
              <YAxis tickFormatter={formatUSD} tickMargin={8} width={96} />
              <ReferenceLine y={0} stroke="#94a3b8" strokeDasharray="4 4" />
              <Tooltip formatter={(value) => formatUSD(Number(value || 0))} />
              <Bar dataKey="value" radius={[6, 6, 0, 0]} barSize={48}>
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
