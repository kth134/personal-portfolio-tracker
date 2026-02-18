'use client'

import { useEffect, useMemo, useState } from 'react'
import { ResponsiveContainer, ComposedChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Cell, ReferenceLine, Line } from 'recharts'
import type { TooltipContentProps } from 'recharts'

const BRIDGE_COLORS = {
  anchor: '#334155',
  positive: '#10b981',
  negative: '#ef4444',
}

type RawBridgeInput = {
  startValue: number
  apiTerminalValue: number
  income: number
  realized: number
  unrealized: number
}

type BridgeRow = {
  name: string
  shortName: string
  range: [number, number]
  anchorValue: number
  stepOffset: number
  stepValue: number
  delta: number
  runningTotal: number
  isAnchor: boolean
  fill: string
}

type Props = {
  input: RawBridgeInput | null
}

const COMPACT_CURRENCY = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
  notation: 'compact',
  minimumFractionDigits: 0,
  maximumFractionDigits: 2,
})

const FULL_CURRENCY = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
  minimumFractionDigits: 0,
  maximumFractionDigits: 0,
})

function formatCompactCurrency(value: number): string {
  return COMPACT_CURRENCY.format(value || 0)
}

function formatWholeCurrency(value: number): string {
  return FULL_CURRENCY.format(value || 0)
}

function toFiniteNumber(value: number): number {
  return Number.isFinite(value) ? value : 0
}

function getTolerance(startValue: number, endValue: number): number {
  const scale = Math.max(Math.abs(startValue), Math.abs(endValue), 1)
  return Math.max(0.5, scale * 0.00001)
}

function buildPortfolioValueBridge(input: RawBridgeInput): BridgeRow[] {
  const startValue = toFiniteNumber(input.startValue)
  const apiTerminalValue = toFiniteNumber(input.apiTerminalValue)
  const income = toFiniteNumber(input.income)
  const realized = toFiniteNumber(input.realized)
  const unrealized = toFiniteNumber(input.unrealized)

  const theoreticalTerminal = startValue + income + realized + unrealized
  const checksumTolerance = getTolerance(startValue, apiTerminalValue)
  const checksumDelta = Math.abs(theoreticalTerminal - apiTerminalValue)
  const reconciledTerminal = checksumDelta <= checksumTolerance ? theoreticalTerminal : apiTerminalValue

  const step1 = startValue + income
  const step2 = step1 + realized
  const step3 = step2 + unrealized

  const rows: BridgeRow[] = [
    {
      name: 'Starting Value',
      shortName: 'Start',
      range: [0, startValue],
      anchorValue: Math.abs(startValue),
      stepOffset: 0,
      stepValue: 0,
      delta: startValue,
      runningTotal: startValue,
      isAnchor: true,
      fill: BRIDGE_COLORS.anchor,
    },
    {
      name: 'Income',
      shortName: 'Income',
      range: [startValue, step1],
      anchorValue: 0,
      stepOffset: Math.min(startValue, step1),
      stepValue: Math.abs(income),
      delta: income,
      runningTotal: step1,
      isAnchor: false,
      fill: income >= 0 ? BRIDGE_COLORS.positive : BRIDGE_COLORS.negative,
    },
    {
      name: 'Realized Gain/Loss',
      shortName: 'Realized',
      range: [step1, step2],
      anchorValue: 0,
      stepOffset: Math.min(step1, step2),
      stepValue: Math.abs(realized),
      delta: realized,
      runningTotal: step2,
      isAnchor: false,
      fill: realized >= 0 ? BRIDGE_COLORS.positive : BRIDGE_COLORS.negative,
    },
    {
      name: 'Unrealized Gain/Loss',
      shortName: 'Unrealized',
      range: [step2, step3],
      anchorValue: 0,
      stepOffset: Math.min(step2, step3),
      stepValue: Math.abs(unrealized),
      delta: unrealized,
      runningTotal: step3,
      isAnchor: false,
      fill: unrealized >= 0 ? BRIDGE_COLORS.positive : BRIDGE_COLORS.negative,
    },
    {
      name: 'Terminal Value',
      shortName: 'End',
      range: [0, reconciledTerminal],
      anchorValue: Math.abs(reconciledTerminal),
      stepOffset: 0,
      stepValue: 0,
      delta: reconciledTerminal,
      runningTotal: reconciledTerminal,
      isAnchor: true,
      fill: BRIDGE_COLORS.anchor,
    },
  ]

  return rows
}

export default function PortfolioValueBridge({ input }: Props) {
  const [isMobile, setIsMobile] = useState(false)

  useEffect(() => {
    const update = () => setIsMobile(window.innerWidth < 600)
    update()
    window.addEventListener('resize', update)
    return () => window.removeEventListener('resize', update)
  }, [])

  const rows = useMemo(() => {
    if (!input) return []
    return buildPortfolioValueBridge(input)
  }, [input])

  const yDomain = useMemo<[number, number]>(() => {
    if (!rows.length) return [-1, 1]
    let minValue = 0
    let maxValue = 0
    rows.forEach((row) => {
      minValue = Math.min(minValue, row.range[0], row.range[1])
      maxValue = Math.max(maxValue, row.range[0], row.range[1])
    })
    const spread = Math.max(1, maxValue - minValue)
    const padding = spread * 0.08
    return [minValue - padding, maxValue + padding]
  }, [rows])

  const tooltipContent = ({ active, payload }: TooltipContentProps<number, string>) => {
    if (!active || !payload?.length) return null
    const row = payload[0]?.payload as BridgeRow | undefined
    if (!row) return null

    return (
      <div className="rounded-md border bg-background p-2 text-xs shadow-sm">
        <div className="font-medium mb-1">{row.name}</div>
        <div>{row.isAnchor ? 'Value' : 'Change'}: {formatWholeCurrency(row.delta)}</div>
        {!row.isAnchor && <div>Running Total: {formatWholeCurrency(row.runningTotal)}</div>}
      </div>
    )
  }

  return (
    <div className="space-y-3 h-full">
      <div className="h-[320px] sm:h-full w-full min-w-0">
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart data={rows} margin={{ top: 16, right: 14, left: 8, bottom: isMobile ? 20 : 36 }} barCategoryGap={16}>
            <CartesianGrid strokeDasharray="3 3" />
            <XAxis
              dataKey="name"
              interval={0}
              tick={isMobile ? false : { fontSize: 11 }}
              tickFormatter={(value: string) => (isMobile ? '' : value)}
              angle={isMobile ? 0 : -18}
              textAnchor={isMobile ? 'middle' : 'end'}
              height={isMobile ? 28 : 78}
            />
            <YAxis tickFormatter={formatCompactCurrency} tickMargin={10} width={90} domain={yDomain} />
            <ReferenceLine y={0} stroke="#94a3b8" strokeDasharray="4 4" />
            <Tooltip content={tooltipContent} />
            <Line type="linear" dataKey="runningTotal" stroke="#94a3b8" strokeWidth={1.5} strokeDasharray="4 4" dot={false} activeDot={false} isAnimationActive={false} />
            <Bar dataKey="stepOffset" stackId="steps" fillOpacity={0} strokeOpacity={0} isAnimationActive={false} />
            <Bar dataKey="stepValue" stackId="steps" radius={[6, 6, 0, 0]} barSize={30} isAnimationActive={false}>
              {rows.map((row) => (
                <Cell key={`step-${row.name}`} fill={row.isAnchor ? 'transparent' : row.fill} stroke={row.isAnchor ? 'transparent' : row.fill} strokeWidth={1} />
              ))}
            </Bar>
            <Bar dataKey="anchorValue" stackId="anchors" radius={[6, 6, 0, 0]} barSize={40} isAnimationActive={false}>
              {rows.map((row) => (
                <Cell key={`anchor-${row.name}`} fill={row.isAnchor ? row.fill : 'transparent'} stroke={row.isAnchor ? row.fill : 'transparent'} strokeWidth={1} />
              ))}
            </Bar>
          </ComposedChart>
        </ResponsiveContainer>
      </div>

      {isMobile && (
        <div className="flex items-center justify-center gap-4 text-xs text-muted-foreground">
          <div className="flex items-center gap-1.5"><span className="inline-block size-2 rounded-full" style={{ backgroundColor: BRIDGE_COLORS.anchor }} />Start/End</div>
          <div className="flex items-center gap-1.5"><span className="inline-block size-2 rounded-full" style={{ backgroundColor: BRIDGE_COLORS.positive }} />Increase</div>
          <div className="flex items-center gap-1.5"><span className="inline-block size-2 rounded-full" style={{ backgroundColor: BRIDGE_COLORS.negative }} />Decrease</div>
        </div>
      )}
    </div>
  )
}
