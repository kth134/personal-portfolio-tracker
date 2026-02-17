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

type TooltipEntry = {
  name?: string
  value?: number | string
  payload?: {
    name?: string
    delta?: number
  }
}

type TooltipState = {
  active?: boolean
  payload?: TooltipEntry[]
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
    const totalsList = Object.values(data?.totals || {}) as Array<{ netGain?: number; income?: number; realized?: number; unrealized?: number }>
    if (!totalsList.length) return []

    const i = totalsList.reduce((sum, t) => sum + Number(t?.income || 0), 0)
    const r = totalsList.reduce((sum, t) => sum + Number(t?.realized || 0), 0)
    const u = totalsList.reduce((sum, t) => sum + Number(t?.unrealized || 0), 0)

    let running = 0
    const steps = [
      { name: 'Income', delta: i },
      { name: 'Realized G/L', delta: r },
      { name: 'Unrealized G/L', delta: u },
    ].map((step) => {
      const next = running + step.delta
      const row = {
        name: step.name,
        delta: step.delta,
        offset: Math.min(running, next),
        value: Math.abs(step.delta),
        fill: step.delta >= 0 ? THEME.positive : THEME.negative,
      }
      running = next
      return row
    })

    return [
      ...steps,
      {
        name: 'Net Gain/Loss',
        delta: running,
        offset: Math.min(0, running),
        value: Math.abs(running),
        fill: running >= 0 ? THEME.accent : THEME.negative,
      },
    ]
  }, [data])

  const tooltipContent = ({ active, payload }: TooltipState) => active && payload?.length ? (
    <div className="bg-black/95 backdrop-blur-sm border border-neutral-800 p-3 rounded-xl shadow-2xl min-w-[180px]">
      <div className="space-y-1 text-xs font-mono">
        {payload.map((entry, idx: number) => (
          <div key={idx} className="flex justify-between">
            <span className="opacity-80">{entry.name}</span>
            <span className={cn('font-bold ml-2', Number(entry.value || 0) >= 0 ? 'text-green-400' : 'text-red-400')}>
              {formatUSD(Number(entry.value || 0))}
            </span>
          </div>
        ))}
      </div>
    </div>
  ) : null

  const waterfallTooltipContent = ({ active, payload }: TooltipState) => {
    if (!active || !payload?.length) return null
    const row = payload[0]?.payload
    const delta = Number(row?.delta || 0)
    return (
      <div className="bg-black/95 backdrop-blur-sm border border-neutral-800 p-3 rounded-xl shadow-2xl min-w-[180px]">
        <div className="space-y-1 text-xs font-mono">
          <div className="flex justify-between">
            <span className="opacity-80">{row?.name}</span>
            <span className={cn('font-bold ml-2', delta >= 0 ? 'text-green-400' : 'text-red-400')}>
              {formatUSD(delta)}
            </span>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
      {/* Combined Lines */}
      <Card className="border-neutral-800 shadow-xl overflow-hidden">
        <CardContent className="p-6 pt-0" style={{ minHeight: `${height}px` }}>
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
        <CardContent className="p-6 pt-0" style={{ minHeight: `${height}px` }}>
          <h4 className="font-mono text-xl font-bold tracking-wider mb-1 text-neutral-200">
            Net Gain Breakdown
          </h4>
          <p className="text-xs text-neutral-500 mb-6 font-mono tracking-tight">Cumulative stack to total</p>
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart layout="vertical" data={waterfallData} margin={{ top: 20, right: 30, left: 0, bottom: 30 }} barCategoryGap={10}>
              <CartesianGrid stroke={THEME.grid} strokeDasharray="3,3" vertical={false} />
              <XAxis type="number" stroke="#666" fontFamily={THEME.fontMono} tickLine={false} axisLine={false} tickFormatter={formatUSD} />
              <YAxis type="category" dataKey="name" stroke="#666" fontFamily={THEME.fontMono} tick={{fontSize: 11, fontWeight: 500}} tickLine={false} axisLine={false} width={120} />
              <Tooltip content={waterfallTooltipContent} />
              <Bar dataKey="offset" stackId="waterfall" fill="transparent" stroke="transparent" barSize={40} />
              <Bar dataKey="value" stackId="waterfall" barSize={40}>
                {waterfallData.map((entry) => (
                  <Cell key={entry.name} fill={entry.fill} stroke={entry.fill} strokeWidth={1} />
                ))}
              </Bar>
            </ComposedChart>
          </ResponsiveContainer>
        </CardContent>
      </Card>
    </div>
  )
}
