'use client'

import { ResponsiveContainer, LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ComposedChart, Bar, Cell } from 'recharts'
import { formatUSD } from '@/lib/formatters'
import { useMemo } from 'react'
import { Card, CardContent } from '@/components/ui/card'
import { cn } from '@/lib/utils'

// Brutalist: steel dark, harsh grids, neon glows
const THEME = {
  bg: 'hsl(var(--background))',
  grid: '#444',
  positive: '#10b981',
  negative: '#ef4444',
  accent: '#6366f1',
  fontMono: 'ui-monospace, SF Mono, Monaco, Consolas, "Liberation Mono", Menlo, monospace',
}

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

interface Props {
  data: MetricsData | null
  height?: number
}

export default function CombinedMetricsCharts({ data, height = 450 }: Props) {
  const combinedLineData = useMemo((): MetricsPoint[] => {
    if (!data?.series) return []
    const dateAgg = new Map<string, MetricsPoint>()
    Object.values(data.series).forEach(points => {
      points.forEach(p => {
        const key = p.date
        const agg = dateAgg.get(key) || { date: key, netGain: 0, income: 0, realized: 0, unrealized: 0 }
        agg.netGain += p.netGain || 0
        agg.income += p.income || 0
        agg.realized += p.realized || 0
        agg.unrealized += p.unrealized || 0
        dateAgg.set(key, agg)
      })
    })
    return Array.from(dateAgg.values()).sort((a, b) => a.date.localeCompare(b.date))
  }, [data])

  const waterfallData = useMemo(() => {
    const t = Object.values(data?.totals || {})[0] as any
    if (!t) return []
    const i = t.income || 0
    const r = t.realized || 0
    const u = t.unrealized || 0
    const n = t.netGain || 0
    const cumIncome = i
    const cumRealized = i + r
    const cumUnrealized = i + r + u
    return [
      { name: 'Income', height: Math.abs(i), fill: i >= 0 ? THEME.positive : THEME.negative, y: i < 0 ? cumIncome : 0 },
      { name: 'Realized G/L', height: Math.abs(r), fill: r >= 0 ? THEME.positive : THEME.negative, y: r < 0 ? cumRealized : cumIncome },
      { name: 'Unrealized G/L', height: Math.abs(u), fill: u >= 0 ? THEME.positive : THEME.negative, y: u < 0 ? cumUnrealized : cumRealized },
      { name: 'Net Gain/Loss', height: Math.abs(n), fill: n >= 0 ? THEME.accent : THEME.negative, y: 0 },
    ]
  }, [data])

  const tooltipContent = ({ active, payload }: any) => active && payload?.length ? (
    <div className="bg-black/95 backdrop-blur-sm border border-neutral-800 p-3 rounded-xl shadow-2xl min-w-[180px]">
      <div className="space-y-1 text-xs font-mono">
        {payload.map((entry: any, idx: number) => (
          <div key={idx} className="flex justify-between">
            <span className="opacity-80">{entry.name}</span>
            <span className={cn('font-bold ml-2', entry.value >= 0 ? 'text-green-400' : 'text-red-400')}>
              {formatUSD(entry.value)}
            </span>
          </div>
        ))}
      </div>
    </div>
  ) : null

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
      {/* Combined Lines */}
      <Card className="border-neutral-800 shadow-xl overflow-hidden">
        <CardContent className="p-6 pt-0 h-full min-h-[450px]">
          <h4 className="font-mono text-xl font-bold tracking-wider mb-1 text-neutral-200">
            Metrics Evolution
          </h4>
          <p className="text-xs text-neutral-500 mb-6 font-mono tracking-tight">Aggregated over time (hover for glow)</p>
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={combinedLineData} margin={{ top: 10, right: 20, left: 0, bottom: 20 }}>
              <defs>
                <linearGradient id="netGrad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0" stopColor={THEME.accent} stopOpacity={0.8}/>
                  <stop offset="1" stopColor={THEME.accent} stopOpacity={0}/>
                </linearGradient>
                <linearGradient id="posGrad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0" stopColor={THEME.positive} stopOpacity={0.8}/>
                  <stop offset="1" stopColor={THEME.positive} stopOpacity={0}/>
                </linearGradient>
              </defs>
              <CartesianGrid stroke={THEME.grid} strokeDasharray="3,3" vertical={false} />
              <XAxis dataKey="date" stroke="#666" fontFamily={THEME.fontMono} tickLine={false} axisLine={false} tickMargin={12} />
              <YAxis stroke="#666" fontFamily={THEME.fontMono} tickLine={false} axisLine={false} tickMargin={12} tickFormatter={formatUSD} />
              <Tooltip content={tooltipContent} />
              <Legend verticalAlign="top" height={36} wrapperStyle={{ fontFamily: THEME.fontMono, fontSize: '12px' }} />
              <Line type="monotone" dataKey="netGain" name="Net G/L" stroke="url(#netGrad)" strokeWidth={3} dot={false} />
              <Line type="monotone" dataKey="income" name="Income" stroke="url(#posGrad)" strokeWidth={2} dot={{ r: 4, fill: THEME.positive }} />
              <Line type="monotone" dataKey="realized" name="Realized" stroke="#f59e0b" strokeWidth={2} dot={{ r: 3 }} />
              <Line type="monotone" dataKey="unrealized" name="Unrealized" stroke={THEME.negative} strokeWidth={2} dot={{ r: 3 }} />
            </LineChart>
          </ResponsiveContainer>
        </CardContent>
      </Card>

      {/* Waterfall */}
      <Card className="border-neutral-800 shadow-xl overflow-hidden">
        <CardContent className="p-6 pt-0 h-full min-h-[450px]">
          <h4 className="font-mono text-xl font-bold tracking-wider mb-1 text-neutral-200">
            Net Gain Breakdown
          </h4>
          <p className="text-xs text-neutral-500 mb-6 font-mono tracking-tight">Cumulative stack to total</p>
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart layout="vertical" data={waterfallData} margin={{ top: 20, right: 30, left: 0, bottom: 30 }} barCategoryGap={10}>
              <CartesianGrid stroke={THEME.grid} strokeDasharray="3,3" vertical={false} />
              <XAxis type="number" stroke="#666" fontFamily={THEME.fontMono} tickLine={false} axisLine={false} tickFormatter={formatUSD} />
              <YAxis type="category" dataKey="name" stroke="#666" fontFamily={THEME.fontMono} tick={{fontSize: 11, fontWeight: 500}} tickLine={false} axisLine={false} width={120} />
              <Tooltip content={tooltipContent} />
              {waterfallData.map((entry, idx) => (
                <Bar key={entry.name} dataKey="height" stackId="waterfall" yAxisId={0} barSize={40}>
                  <Cell fill={entry.fill} stroke={entry.fill} strokeWidth={1} />
                </Bar>
              ))}
            </ComposedChart>
          </ResponsiveContainer>
        </CardContent>
      </Card>
    </div>
  )
}
