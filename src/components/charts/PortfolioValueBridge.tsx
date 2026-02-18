'use client'

import { useEffect, useMemo, useState } from 'react'
import { ResponsiveContainer, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Cell, ReferenceLine } from 'recharts'
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
  offset: number
  value: number
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
      offset: Math.min(0, startValue),
      value: Math.abs(startValue),
      delta: startValue,
      runningTotal: startValue,
      isAnchor: true,
      fill: BRIDGE_COLORS.anchor,
    },
    {
      name: 'Income',
      shortName: 'Income',
      range: [startValue, step1],
      offset: Math.min(startValue, step1),
      value: Math.abs(income),
      delta: income,
      runningTotal: step1,
      isAnchor: false,
      fill: income >= 0 ? BRIDGE_COLORS.positive : BRIDGE_COLORS.negative,
    },
    {
      name: 'Realized Gain/Loss',
      shortName: 'Realized',
      range: [step1, step2],
      offset: Math.min(step1, step2),
      value: Math.abs(realized),
      delta: realized,
      runningTotal: step2,
      isAnchor: false,
      fill: realized >= 0 ? BRIDGE_COLORS.positive : BRIDGE_COLORS.negative,
    },
    {
      name: 'Unrealized Gain/Loss',
      shortName: 'Unrealized',
      range: [step2, step3],
      offset: Math.min(step2, step3),
      value: Math.abs(unrealized),
      delta: unrealized,
      runningTotal: step3,
      isAnchor: false,
      fill: unrealized >= 0 ? BRIDGE_COLORS.positive : BRIDGE_COLORS.negative,
    },
    {
      name: 'Terminal Value',
      shortName: 'End',
      range: [0, reconciledTerminal],
      offset: Math.min(0, reconciledTerminal),
      value: Math.abs(reconciledTerminal),
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
          <BarChart data={rows} margin={{ top: 16, right: 14, left: 8, bottom: isMobile ? 20 : 36 }} barCategoryGap={16}>
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
            <Bar dataKey="offset" stackId="value-bridge" fill="transparent" stroke="transparent" isAnimationActive={false} />
            <Bar dataKey="value" stackId="value-bridge" radius={[6, 6, 0, 0]} barSize={36}>
              {rows.map((row) => (
                <Cell key={row.name} fill={row.fill} stroke={row.fill} strokeWidth={1} />
              ))}
            </Bar>
          </BarChart>
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
