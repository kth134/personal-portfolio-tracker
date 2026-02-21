'use client'

import { ResponsiveContainer, LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend } from 'recharts'
import { useMemo } from 'react'
import { Card, CardContent } from '@/components/ui/card'
import PortfolioValueBridge from '@/components/charts/PortfolioValueBridge'

const COLORS = {
  income: '#3b82f6',
  realized: '#8b5cf6',
  unrealized: '#f59e0b',
  netPositive: '#10b981',
  netNegative: '#ef4444',
  total: '#334155',
  positive: '#10b981',
  negative: '#ef4444',
}

interface MetricsPoint {
  date: string
  netGain?: number
  netContributions?: number
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
      netContributions: number
      income: number
      realized: number
      unrealized: number
      portfolioValue: number
    }
    const dateAgg = new Map<string, AggregatedPoint>()
    Object.values(data.series).forEach(points => {
      points.forEach(p => {
        const key = p.date
        const agg = dateAgg.get(key) || { date: key, netGain: 0, netContributions: 0, income: 0, realized: 0, unrealized: 0, portfolioValue: 0 }
        agg.netGain += p.netGain || 0
        agg.netContributions += p.netContributions || 0
        agg.income += p.income || 0
        agg.realized += p.realized || 0
        agg.unrealized += p.unrealized || 0
        agg.portfolioValue = (agg.portfolioValue || 0) + (p.portfolioValue || 0)
        dateAgg.set(key, agg)
      })
    })
    return Array.from(dateAgg.values()).sort((a, b) => a.date.localeCompare(b.date))
  }, [data])

  const valueBridgeInput = useMemo(() => {
    if (!combinedLineData.length) return null
    const firstPoint = combinedLineData[0]
    const lastPoint = combinedLineData[combinedLineData.length - 1]
    const startValue = Number(firstPoint?.portfolioValue ?? 0)
    const apiTerminalValue = Number(lastPoint?.portfolioValue ?? 0)
    const netContributions = Number(lastPoint?.netContributions ?? 0)
    const income = Number(lastPoint?.income ?? 0)
    const realized = Number(lastPoint?.realized ?? 0)
    const unrealized = Number(lastPoint?.unrealized ?? 0)

    return { startValue, apiTerminalValue, netContributions, income, realized, unrealized }
  }, [combinedLineData])

  const netGainColor = useMemo(() => {
    const lastNetGain = Number(combinedLineData[combinedLineData.length - 1]?.netGain || 0)
    return lastNetGain < 0 ? COLORS.netNegative : COLORS.netPositive
  }, [combinedLineData])

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
              <Line type="monotone" dataKey="income" name="Income" stroke={COLORS.income} strokeWidth={2.5} dot={false} />
              <Line type="monotone" dataKey="realized" name="Realized G/L" stroke={COLORS.realized} strokeWidth={2.5} dot={false} />
              <Line type="monotone" dataKey="unrealized" name="Unrealized G/L" stroke={COLORS.unrealized} strokeWidth={2.5} dot={false} />
              <Line type="monotone" dataKey="netGain" name="Net G/L" stroke={netGainColor} strokeWidth={2.5} dot={false} />
            </LineChart>
          </ResponsiveContainer>
        </CardContent>
      </Card>

      <Card className="rounded-xl border bg-card shadow-sm overflow-hidden min-w-0">
        <CardContent className="p-4 sm:p-5" style={{ minHeight: `${height}px` }}>
          <h4 className="text-lg font-semibold mb-1">
            Portfolio Value Bridge
          </h4>
          <p className="text-sm text-muted-foreground mb-4">Starting Value → Net Contributions → Income → Realized → Unrealized → Terminal Value</p>
          <PortfolioValueBridge input={valueBridgeInput} />
        </CardContent>
      </Card>
    </div>
  )
}
