'use client'

import { useState, useEffect, useMemo } from 'react'
import { useRouter } from 'next/navigation'
import {
  PieChart, Pie, Cell, ResponsiveContainer, Tooltip, Legend,
} from 'recharts'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'
import { Label } from '@/components/ui/label'
import { Button } from '@/components/ui/button'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from '@/components/ui/accordion'
import { Popover, PopoverTrigger, PopoverContent } from '@/components/ui/popover'
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from '@/components/ui/command'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Check, ChevronsUpDown, ArrowUpDown, RefreshCw } from 'lucide-react'
import { formatUSD } from '@/lib/formatters'
import { cn } from '@/lib/utils'
import { refreshAssetPrices } from './actions'
import { DashboardSurface } from '@/components/dashboard-shell'

type RefreshEventDetail = {
  register?: (promise: Promise<unknown>) => void
}

const COLORS = ['#3b82f6', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6', '#ec4899', '#06b6d4', '#14b8a6', '#f97316', '#a855f7']

const LENSES = [
  { value: 'total', label: 'Total Portfolio' },
  { value: 'sub_portfolio', label: 'Sub-Portfolio' },
  { value: 'account', label: 'Account' },
  { value: 'asset_type', label: 'Asset Type' },
  { value: 'asset_subtype', label: 'Asset Sub-Type' },
  { value: 'size_tag', label: 'Size' },
  { value: 'geography', label: 'Geography' },
  { value: 'factor_tag', label: 'Factor' },
]

const getAllocationLensTitle = (lens: string) => {
  if (lens === 'total') return 'Asset'
  const lensLabel = LENSES.find((item) => item.value === lens)?.label || 'Selection'
  return lensLabel.replace(/\s+/g, '-')
}

const formatUSDWhole = (value: number | null | undefined) => {
  const num = Math.round(Number(value) || 0)
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(num)
}

const formatPctTenth = (value: number | null | undefined) => `${(Number(value) || 0).toFixed(1)}%`

const RADIAN = Math.PI / 180

type PiePercentageLabelProps = {
  cx?: number
  cy?: number
  midAngle?: number
  outerRadius?: number
  percent?: number
  index?: number
}

const renderPiePercentageLabel = ({
  cx = 0,
  cy = 0,
  midAngle = 0,
  outerRadius = 0,
  percent = 0,
  index = 0,
}: PiePercentageLabelProps) => {
  if (!percent || percent < 0.04) return null

  const isRightSide = Math.cos(-midAngle * RADIAN) >= 0
  const startRadius = outerRadius
  const midRadius = outerRadius + 12
  const labelRadius = outerRadius + 28 + (index % 2) * 6
  const startX = cx + startRadius * Math.cos(-midAngle * RADIAN)
  const startY = cy + startRadius * Math.sin(-midAngle * RADIAN)
  const midX = cx + midRadius * Math.cos(-midAngle * RADIAN)
  const midY = cy + midRadius * Math.sin(-midAngle * RADIAN)
  const labelX = cx + labelRadius * Math.cos(-midAngle * RADIAN) + (isRightSide ? 14 : -14)
  const labelY = cy + labelRadius * Math.sin(-midAngle * RADIAN)
  const lineEndX = labelX + (isRightSide ? -4 : 4)

  return (
    <g>
      <path
        d={`M ${startX} ${startY} L ${midX} ${midY} L ${lineEndX} ${labelY}`}
        stroke="#71717a"
        strokeWidth="1"
        fill="none"
      />
      <text
        x={labelX}
        y={labelY}
        fill="#18181b"
        textAnchor={isRightSide ? 'start' : 'end'}
        dominantBaseline="central"
        className="text-[11px] font-semibold"
      >
        {`${(percent * 100).toFixed(1)}%`}
      </text>
    </g>
  )
}

export default function PortfolioHoldingsWithSlicers({
  cash,
  cashByAccountId,
  accountCashDetails,
}: {
  cash: number
  cashByAccountId: Record<string, number>
  accountCashDetails: Record<string, {
    accountId: string
    accountName: string
    autoCash: number
    effectiveCash: number
    hasManualAnchor: boolean
    anchorId: string | null
    anchorEffectiveDate: string | null
    anchorNote: string | null
  }>
}) {
  const router = useRouter()
  const [lens, setLens] = useState('total')
  const [availableValues, setAvailableValues] = useState<{value: string, label: string}[]>([])
  const [selectedValues, setSelectedValues] = useState<string[]>([])
  const [aggregate, setAggregate] = useState(true)
  const [allocations, setAllocations] = useState<any[]>([])
  const [pieAllocations, setPieAllocations] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [refreshTrigger, setRefreshTrigger] = useState(0)
  const [openItems, setOpenItems] = useState<string[]>([])
  const [itemSorts, setItemSorts] = useState<Record<string, { key: string; dir: 'asc' | 'desc' }>>({})
  const [cashDialogAccountId, setCashDialogAccountId] = useState<string | null>(null)
  const [cashFormDate, setCashFormDate] = useState(new Date().toISOString().slice(0, 10))
  const [cashFormBalance, setCashFormBalance] = useState('')
  const [cashFormNote, setCashFormNote] = useState('')
  const [cashDialogError, setCashDialogError] = useState<string | null>(null)
  const [cashSaving, setCashSaving] = useState(false)

  const handleRefreshPrices = async () => {
    setRefreshing(true)
    await refreshAssetPrices()
    setRefreshTrigger(t => t + 1)
    setRefreshing(false)
  }

  useEffect(() => {
    const handleBannerRefresh = (event: Event) => {
      const detail = (event as CustomEvent<RefreshEventDetail>).detail
      detail?.register?.(handleRefreshPrices())
    }

    window.addEventListener('dashboard:portfolio-refresh', handleBannerRefresh)
    return () => window.removeEventListener('dashboard:portfolio-refresh', handleBannerRefresh)
  }, [])

  const toggleItemSort = (groupKey: string, sortKey: string) => {
    setItemSorts((prev) => {
      const cur = prev[groupKey]
      if (cur && cur.key === sortKey) {
        const nextDir = cur.dir === 'desc' ? 'asc' : 'desc'
        return { ...prev, [groupKey]: { key: sortKey, dir: nextDir } }
      }
      return { ...prev, [groupKey]: { key: sortKey, dir: 'desc' } }
    })
  }

  const renderSortIndicator = (sortSpec: { key: string; dir: 'asc' | 'desc' } | undefined, col: string) => {
    return (
      <ArrowUpDown className={cn("ml-1 h-3 w-3 inline cursor-pointer", (sortSpec && sortSpec.key === col) ? "text-blue-600" : "text-zinc-400")} />
    )
  }

  const getItemRemainingQuantity = (item: unknown) => {
    if (!item) return 0

    const itemRecord = item as Record<string, unknown>

    const directRemainingQty =
      itemRecord.remaining_quantity ??
      itemRecord.remainingQuantity ??
      itemRecord.quantity_remaining ??
      itemRecord.quantityRemaining

    if (directRemainingQty !== undefined && directRemainingQty !== null && directRemainingQty !== '') {
      return Number(directRemainingQty) || 0
    }

    const activeLots = Array.isArray(itemRecord.active_tax_lots)
      ? itemRecord.active_tax_lots
      : Array.isArray(itemRecord.tax_lots)
        ? itemRecord.tax_lots
        : []

    if (activeLots.length > 0) {
      return activeLots.reduce((sum: number, lot: unknown) => {
        const lotRecord = lot as Record<string, unknown>
        const lotRemainingQty =
          lotRecord.remaining_quantity ??
          lotRecord.remainingQuantity ??
          lotRecord.quantity_remaining ??
          lotRecord.quantityRemaining ??
          lotRecord.quantity ??
          0
        return sum + (Number(lotRemainingQty) || 0)
      }, 0)
    }

    return Number(itemRecord.quantity) || 0
  }

  const getItemRemainingCostBasis = (item: unknown) => {
    if (!item) return 0

    const itemRecord = item as Record<string, unknown>

    const activeLots = Array.isArray(itemRecord.active_tax_lots)
      ? itemRecord.active_tax_lots
      : Array.isArray(itemRecord.tax_lots)
        ? itemRecord.tax_lots
        : []

    if (activeLots.length > 0) {
      return activeLots.reduce((sum: number, lot: unknown) => {
        const lotRecord = lot as Record<string, unknown>
        const lotRemainingQty =
          lotRecord.remaining_quantity ??
          lotRecord.remainingQuantity ??
          lotRecord.quantity_remaining ??
          lotRecord.quantityRemaining ??
          lotRecord.quantity ??
          0
        const lotCostBasisPerUnit =
          lotRecord.cost_basis_per_unit ??
          lotRecord.costBasisPerUnit ??
          0
        return sum + ((Number(lotRemainingQty) || 0) * (Number(lotCostBasisPerUnit) || 0))
      }, 0)
    }

    return Number(itemRecord.cost_basis) || 0
  }

  useEffect(() => {
    if (lens === 'total') {
      setAvailableValues([])
      setSelectedValues([])
      return
    }
    const fetchValues = async () => {
      try {
        const res = await fetch('/api/dashboard/values', { method: 'POST', body: JSON.stringify({ lens }) })
        const data = await res.json()
        const vals = data.values || []
        setAvailableValues(vals)
        setSelectedValues(
            vals.map((v: any) => lens === 'sub_portfolio' ? (v.label ?? v.value) : v.value)
        )
      } catch (err) { console.error(err) }
    }
    fetchValues()
  }, [lens])

    useEffect(() => {
      if (!cashDialogAccountId) {
        setCashFormDate(new Date().toISOString().slice(0, 10))
        setCashFormBalance('')
        setCashFormNote('')
        setCashDialogError(null)
        return
      }

      const account = accountCashDetails[cashDialogAccountId]
      setCashFormDate(new Date().toISOString().slice(0, 10))
      setCashFormBalance(String((account?.effectiveCash ?? 0).toFixed(2)))
      setCashFormNote('')
      setCashDialogError(null)
    }, [cashDialogAccountId, accountCashDetails])

  useEffect(() => {
    const loadData = async () => {
      setLoading(true)
      try {
        const payload = { lens, selectedValues: lens === 'total' ? [] : selectedValues, aggregate }
        const [pieRes, tableRes] = await Promise.all([
          fetch('/api/dashboard/allocations', { method: 'POST', body: JSON.stringify(payload), cache: 'no-store' }),
          fetch('/api/dashboard/allocations', { method: 'POST', body: JSON.stringify({ ...payload, aggregate: false }), cache: 'no-store' })
        ])
        const [pieData, tableData] = await Promise.all([pieRes.json(), tableRes.json()])
        setPieAllocations(pieData.allocations || [])
        setAllocations(tableData.allocations || [])
        // Initial state: Empty openItems (Collapsed by default)
      } catch (err) { console.error(err) } finally { setLoading(false) }
    }
    loadData()
  }, [lens, selectedValues, aggregate, refreshTrigger])

  const totalValueAcrossSelection = useMemo(() => {
    return allocations.reduce((sum, a) => sum + (Number(a.value) || 0), 0) + cash
  }, [allocations, cash])

  const totalInvestmentValue = useMemo(() => {
    return allocations.reduce((sum, allocation) => sum + (Number(allocation.value) || 0), 0)
  }, [allocations])

  const selectedCashAccount = cashDialogAccountId ? accountCashDetails[cashDialogAccountId] : null

  const handleOpenCashDialog = (accountId: string) => {
    setCashDialogAccountId(accountId)
  }

  const handleSaveCashBalance = async () => {
    if (!cashDialogAccountId) return

    const parsedBalance = Number(cashFormBalance)
    if (!cashFormDate) {
      setCashDialogError('Effective date is required.')
      return
    }

    if (cashFormDate > new Date().toISOString().slice(0, 10)) {
      setCashDialogError('Effective date cannot be in the future.')
      return
    }

    if (!Number.isFinite(parsedBalance)) {
      setCashDialogError('Enter a valid cash balance.')
      return
    }

    if (!/^[-+]?\d+(\.\d{1,2})?$/.test(cashFormBalance.trim())) {
      setCashDialogError('Cash balance can include at most 2 decimal places.')
      return
    }

    setCashSaving(true)
    setCashDialogError(null)
    try {
      const res = await fetch('/api/accounts/cash-anchors', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          account_id: cashDialogAccountId,
          effective_date: cashFormDate,
          balance: parsedBalance,
          note: cashFormNote.trim() || null,
        }),
      })

      if (!res.ok) {
        const payload = await res.json().catch(() => ({ error: 'Failed to save cash balance.' }))
        throw new Error(payload.error || 'Failed to save cash balance.')
      }

      setCashDialogAccountId(null)
      router.refresh()
      setRefreshTrigger((value) => value + 1)
    } catch (error) {
      setCashDialogError(error instanceof Error ? error.message : 'Failed to save cash balance.')
    } finally {
      setCashSaving(false)
    }
  }

  const handleRemoveLatestManualBalance = async () => {
    if (!selectedCashAccount?.anchorId) return
    const confirmed = window.confirm('Remove the latest manual cash balance for this account? Cash will revert to the previous manual balance or the automatic transaction-based calculation.')
    if (!confirmed) return

    setCashSaving(true)
    setCashDialogError(null)
    try {
      const res = await fetch('/api/accounts/cash-anchors', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: selectedCashAccount.anchorId }),
      })

      if (!res.ok) {
        const payload = await res.json().catch(() => ({ error: 'Failed to remove manual cash balance.' }))
        throw new Error(payload.error || 'Failed to remove manual cash balance.')
      }

      setCashDialogAccountId(null)
      router.refresh()
      setRefreshTrigger((value) => value + 1)
    } catch (error) {
      setCashDialogError(error instanceof Error ? error.message : 'Failed to remove manual cash balance.')
    } finally {
      setCashSaving(false)
    }
  }

  const normalizedPieSlices = useMemo(() => {
    const source = (Array.isArray(pieAllocations) && pieAllocations.length > 0) ? pieAllocations : allocations;
    return (source || []).map((slice: any) => {
      let dataArr: any[] = [];
      if (Array.isArray(slice.data) && slice.data.length > 0) {
        dataArr = slice.data.map((d: any) => ({ subkey: d.subkey ?? d.name ?? d.ticker ?? 'Unknown', value: Number(d.value) || 0 }))
      } else if (Array.isArray(slice.items) && slice.items.length > 0) {
        dataArr = slice.items.map((i: any) => ({ subkey: i.ticker ?? i.name ?? 'Unknown', value: Number(i.value) || 0 }))
      } else if (typeof slice.value === 'number' || slice.value) {
        // Single-group aggregate: show the group's own value as one slice
        dataArr = [{ subkey: slice.key ?? 'Value', value: Number(slice.value) || 0 }]
      }
      return { ...slice, data: dataArr };
    });
  }, [pieAllocations, allocations]);

  if (loading && allocations.length === 0) {
    return <div className="p-8 text-center text-lg animate-pulse">Loading holdings...</div>
  }

  return (
    <div className="space-y-6">
      <DashboardSurface
        title="Holdings Snapshot"
        description="Slice holdings by portfolio dimension, refresh prices, and compare how value is distributed across the current portfolio."
        contentClassName="space-y-6"
      >
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div className="dashboard-metric-tile min-w-0">
          <Label className="dashboard-metric-label break-words">Total Investment Value</Label>
          <p className="dashboard-metric-value break-words text-zinc-950">{formatUSDWhole(totalInvestmentValue)}</p>
        </div>
        <div className="dashboard-metric-tile min-w-0">
          <Label className="dashboard-metric-label break-words">Total Cash Value</Label>
          <p className="dashboard-metric-value break-words text-zinc-950">{formatUSDWhole(cash)}</p>
        </div>
      </div>

      <div className="dashboard-toolbar">
        <div className="flex-1 min-w-[200px]">
          <Label className="dashboard-metric-label mb-2 block">Slice by</Label>
          <Select value={lens} onValueChange={setLens}>
            <SelectTrigger className="w-full rounded-2xl bg-white md:w-56"><SelectValue /></SelectTrigger>
            <SelectContent>{LENSES.map(l => (
              <SelectItem key={l.value} value={l.value}>{l.label}</SelectItem>
            ))}</SelectContent>
          </Select>
        </div>

        {lens !== 'total' && selectedValues.length > 1 && (
          <div className="flex items-center gap-2 rounded-2xl border border-zinc-200 bg-white px-3 py-2">
            <Switch checked={aggregate} onCheckedChange={setAggregate} />
            <Label className="text-sm cursor-pointer whitespace-nowrap">Aggregate</Label>
          </div>
        )}

      </div>

      <div className="flex flex-wrap gap-8 justify-center">
        {normalizedPieSlices.map((slice, idx) => {
          const sliceData = Array.isArray(slice.data) ? slice.data : [];
          if (!sliceData || sliceData.length === 0) return null;
          return (
            <div key={idx} className={cn("dashboard-chart-panel space-y-4 min-w-[300px] flex-1", normalizedPieSlices.length === 1 ? "w-full max-w-none" : "max-w-[500px]")}> 
              <h4 className="dashboard-contrast-pill rounded-2xl px-4 py-3 text-center text-sm">{lens === 'total' ? getAllocationLensTitle(lens) : aggregate && slice.key === 'Aggregated Selection' ? getAllocationLensTitle(lens) : slice.key} Allocation</h4>
              <ResponsiveContainer width="100%" height={360}>
                <PieChart margin={{ top: 8, right: 34, left: 34, bottom: 58 }}>
                  <Pie data={sliceData} dataKey="value" nameKey="subkey" outerRadius={82} label={renderPiePercentageLabel} labelLine={false}>
                    {sliceData.map((_: any, i: number) => (<Cell key={i} fill={COLORS[i % COLORS.length]} />))}
                  </Pie>
                  <Tooltip formatter={(v: any) => formatUSDWhole(Number(v))} />
                  <Legend
                    verticalAlign="bottom"
                    align="center"
                    iconSize={10}
                    wrapperStyle={{ paddingTop: 18, fontSize: '12px', lineHeight: '16px' }}
                  />
                </PieChart>
              </ResponsiveContainer>
            </div>
          )
        })}
      </div>
      </DashboardSurface>

      <DashboardSurface
        title="Allocation Breakdown"
        description="Expand any group to inspect the positions, values, and portfolio weights that make up that slice of the portfolio."
        contentClassName="space-y-4 px-0 py-0"
      >
      <Accordion type="multiple" value={openItems} onValueChange={setOpenItems} className="space-y-4 px-4 pb-4 sm:px-6 sm:pb-6">
        {[...allocations]
           .map(g => {
             let cashVal = 0
             if (lens === 'account') {
               cashVal = cashByAccountId[g.groupId] || 0
             }
             return { ...g, totalGroupVal: Number(g.value) + cashVal, cashVal };
           })
           .sort((a,b) => b.totalGroupVal - a.totalGroupVal)
           .map((group) => {
          const groupWeight = totalValueAcrossSelection > 0 ? (group.totalGroupVal / totalValueAcrossSelection) * 100 : 0
          const accountDetails = lens === 'account' ? accountCashDetails[group.groupId] : null

          return (
            <AccordionItem key={String(group.key)} value={String(group.key)} className="overflow-hidden rounded-[24px] border border-zinc-200/80 bg-white shadow-sm">
              <AccordionTrigger className="dashboard-contrast-header px-4 py-4">
                <div className="mr-4 hidden w-full items-center justify-between gap-3 text-left sm:flex">
                  <div className="space-y-2">
                    <span className="flex items-center font-bold uppercase text-zinc-950">{group.key}</span>
                    {lens === 'account' ? (
                      <div className="flex flex-wrap items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.12em] text-zinc-700 sm:text-xs">
                        <span>Investments {formatUSDWhole(group.value)}</span>
                        <span className="opacity-50">|</span>
                        <span>Cash {formatUSDWhole(group.cashVal)}</span>
                        <span className="opacity-50">|</span>
                        <span>Total {formatUSDWhole(group.totalGroupVal)}</span>
                        <span className="opacity-50">|</span>
                        <span>{accountDetails?.hasManualAnchor ? `Manual as of ${accountDetails.anchorEffectiveDate}` : 'Auto'}</span>
                      </div>
                    ) : null}
                  </div>
                  <div className="flex items-center gap-3 text-xs font-bold leading-none text-zinc-950 sm:text-sm">
                    {lens === 'account' && accountDetails ? (
                      <Button
                        type="button"
                        variant="outline"
                        className="h-9 rounded-xl bg-white text-[11px] font-semibold uppercase tracking-[0.12em] text-zinc-900"
                        onClick={(event) => {
                          event.preventDefault()
                          event.stopPropagation()
                          handleOpenCashDialog(accountDetails.accountId)
                        }}
                      >
                        {accountDetails.hasManualAnchor ? 'Update Cash Balance' : 'Set Cash Balance'}
                      </Button>
                    ) : null}
                    <span className="flex items-center">Value: {formatUSDWhole(group.totalGroupVal)}</span>
                    <span className="flex items-center opacity-60 text-zinc-700">|</span>
                    <span className="flex items-center">{formatPctTenth(groupWeight)}</span>
                  </div>
                </div>

                <div className="mr-4 flex w-full flex-col gap-3 text-left sm:hidden">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <span className="block truncate font-bold uppercase text-zinc-950">{group.key}</span>
                      <p className="mt-1 text-xs font-semibold uppercase tracking-[0.12em] text-zinc-700">
                        {accountDetails?.hasManualAnchor ? `Manual as of ${accountDetails.anchorEffectiveDate}` : 'Auto cash tracking'}
                      </p>
                    </div>
                    <div className="text-right">
                      <p className="text-base font-bold leading-tight text-zinc-950">{formatUSDWhole(group.totalGroupVal)}</p>
                      <p className="mt-1 text-xs font-semibold uppercase tracking-[0.12em] text-zinc-700">{formatPctTenth(groupWeight)}</p>
                    </div>
                  </div>

                  {lens === 'account' ? (
                    <div className="grid grid-cols-1 gap-2">
                      <div className="grid grid-cols-3 gap-2 rounded-2xl border border-zinc-200/80 bg-white/80 p-3">
                        <div>
                          <p className="dashboard-metric-label">Investments</p>
                          <p className="mt-1 text-sm font-semibold tabular-nums text-zinc-950">{formatUSDWhole(group.value)}</p>
                        </div>
                        <div>
                          <p className="dashboard-metric-label">Cash</p>
                          <p className="mt-1 text-sm font-semibold tabular-nums text-zinc-950">{formatUSDWhole(group.cashVal)}</p>
                        </div>
                        <div>
                          <p className="dashboard-metric-label">Total</p>
                          <p className="mt-1 text-sm font-semibold tabular-nums text-zinc-950">{formatUSDWhole(group.totalGroupVal)}</p>
                        </div>
                      </div>
                      {accountDetails ? (
                        <Button
                          type="button"
                          variant="outline"
                          className="h-10 w-full rounded-2xl bg-white text-xs font-semibold uppercase tracking-[0.12em] text-zinc-900"
                          onClick={(event) => {
                            event.preventDefault()
                            event.stopPropagation()
                            handleOpenCashDialog(accountDetails.accountId)
                          }}
                        >
                          {accountDetails.hasManualAnchor ? 'Update Cash Balance' : 'Set Cash Balance'}
                        </Button>
                      ) : null}
                    </div>
                  ) : null}
                </div>
              </AccordionTrigger>
              <AccordionContent className="border-t border-zinc-200/70 bg-white p-0">
                <div className="space-y-3 p-4 md:hidden">
                  {(() => {
                    const sortSpec = itemSorts[group.key] || { key: 'value', dir: 'desc' }
                    const dirMul = sortSpec.dir === 'asc' ? 1 : -1
                    return [...(group.items || [])]
                      .slice()
                      .sort((a: any, b: any) => {
                        const k = sortSpec.key
                        if (k === 'ticker') {
                          const aa = (a.ticker || '').toLowerCase()
                          const bb = (b.ticker || '').toLowerCase()
                          return aa.localeCompare(bb) * dirMul
                        }
                        if (k === 'quantity') {
                          const qa = getItemRemainingQuantity(a)
                          const qb = getItemRemainingQuantity(b)
                          return (qa - qb) * dirMul
                        }
                        if (k === 'cost_basis_per_share') {
                          const qa = getItemRemainingQuantity(a)
                          const qb = getItemRemainingQuantity(b)
                          const cpa = qa > 0 ? getItemRemainingCostBasis(a) / qa : 0
                          const cpb = qb > 0 ? getItemRemainingCostBasis(b) / qb : 0
                          return (cpa - cpb) * dirMul
                        }
                        if (k === 'current_price') {
                          const qa = getItemRemainingQuantity(a)
                          const qb = getItemRemainingQuantity(b)
                          const cpa = qa > 0 ? (Number(a.value) || 0) / qa : 0
                          const cpb = qb > 0 ? (Number(b.value) || 0) / qb : 0
                          return (cpa - cpb) * dirMul
                        }
                        if (k === 'weight') {
                          const wa = totalValueAcrossSelection > 0 ? ((Number(a.value) || 0) / totalValueAcrossSelection) * 100 : 0
                          const wb = totalValueAcrossSelection > 0 ? ((Number(b.value) || 0) / totalValueAcrossSelection) * 100 : 0
                          return (wa - wb) * dirMul
                        }
                        const va = Number(k === 'cost_basis' ? (a.cost_basis ?? 0) : (a.value ?? 0)) || 0
                        const vb = Number(k === 'cost_basis' ? (b.cost_basis ?? 0) : (b.value ?? 0)) || 0
                        return (va - vb) * dirMul
                      })
                      .map((item: any, idx: number) => {
                        const itemValue = Number(item.value) || 0
                        const itemWeight = totalValueAcrossSelection > 0 ? (itemValue / totalValueAcrossSelection) * 100 : 0
                        const itemQuantity = getItemRemainingQuantity(item)
                        const itemRemainingCostBasis = getItemRemainingCostBasis(item)
                        const itemCostBasisPerShare = itemQuantity > 0 ? itemRemainingCostBasis / itemQuantity : 0
                        const itemCurrentPrice = itemQuantity > 0 ? itemValue / itemQuantity : 0
                        return (
                          <div key={`${item.ticker ?? item.name ?? idx}-mobile`} className="dashboard-mobile-card space-y-4">
                            <div className="grid grid-cols-2 gap-x-3 gap-y-1 min-w-0">
                              <p className="min-w-0 break-words text-lg font-semibold leading-tight text-zinc-950 [overflow-wrap:anywhere]">{item.ticker}</p>
                              <p className="min-w-0 break-words text-right text-lg font-semibold leading-tight tabular-nums text-zinc-950 [overflow-wrap:anywhere]">{formatUSDWhole(itemValue)}</p>
                              <p className="min-w-0 break-words text-xs italic leading-tight text-zinc-500 [overflow-wrap:anywhere]">{item.name}</p>
                              <p className="min-w-0 break-words text-right text-xs italic leading-tight tabular-nums text-zinc-500 [overflow-wrap:anywhere]">{formatPctTenth(itemWeight)}</p>
                            </div>
                            <div className={cn('grid gap-3', lens === 'account' ? 'grid-cols-1' : 'grid-cols-2')}>
                              <div className={cn('rounded-2xl border border-zinc-200/80 bg-zinc-50/80 p-3', lens !== 'account' && 'text-center')}>
                                <p className={cn('dashboard-metric-label', lens !== 'account' && 'text-center')}>Quantity</p>
                                <p className={cn('mt-1 text-sm text-zinc-700 tabular-nums', lens !== 'account' && 'text-center')}>{itemQuantity.toLocaleString(undefined, { maximumFractionDigits: 6 })}</p>
                              </div>
                              <div className={cn('rounded-2xl border border-zinc-200/80 bg-zinc-50/80 p-3', lens !== 'account' && 'text-center')}>
                                <p className={cn('dashboard-metric-label', lens !== 'account' && 'text-center')}>Current Price</p>
                                <p className={cn('mt-1 text-sm text-zinc-700 tabular-nums', lens !== 'account' && 'text-center')}>{formatUSDWhole(itemCurrentPrice)}</p>
                              </div>
                              {lens === 'account' ? (
                                <div className="grid grid-cols-2 gap-3">
                                  <div className="rounded-2xl border border-zinc-200/80 bg-zinc-50/80 p-3">
                                    <p className="dashboard-metric-label">Cost Basis</p>
                                    <p className="mt-1 text-sm text-zinc-700 tabular-nums">{formatUSDWhole(itemRemainingCostBasis)}</p>
                                  </div>
                                  <div className="rounded-2xl border border-zinc-200/80 bg-zinc-50/80 p-3">
                                    <p className="dashboard-metric-label">Weight</p>
                                    <p className="mt-1 text-sm text-zinc-700 tabular-nums">{formatPctTenth(itemWeight)}</p>
                                  </div>
                                </div>
                              ) : null}
                            </div>
                          </div>
                        )
                      })
                  })()}
                </div>
                <div className="dashboard-table-shell hidden rounded-none border-0 shadow-none md:block">
                <Table className="w-full min-w-[760px] table-fixed">
                  <colgroup>
                    <col className="w-[26%]" />
                    <col className="w-[12%]" />
                    <col className="w-[14%]" />
                    <col className="w-[14%]" />
                    <col className="w-[12%]" />
                    <col className="w-[12%]" />
                    <col className="w-[10%]" />
                  </colgroup>
                  <TableHeader>
                    <TableRow className="bg-muted/50">
                      <TableHead className="px-3 sm:px-4">
                        <button type="button" className="flex w-full items-center gap-2 text-left" onClick={() => toggleItemSort(group.key, 'ticker')}>
                          <span className="truncate">Asset</span>
                          {renderSortIndicator(itemSorts[group.key], 'ticker')}
                        </button>
                      </TableHead>

                      <TableHead className="px-3 sm:px-4 text-right">
                        <button type="button" className="ml-auto flex w-full items-center justify-end gap-2 whitespace-nowrap" onClick={() => toggleItemSort(group.key, 'quantity')}>
                          Quantity
                          {renderSortIndicator(itemSorts[group.key], 'quantity')}
                        </button>
                      </TableHead>

                      <TableHead className="px-3 sm:px-4 text-right">
                        <button type="button" className="ml-auto flex w-full items-center justify-end gap-2 whitespace-nowrap" onClick={() => toggleItemSort(group.key, 'cost_basis_per_share')}>
                          Cost Basis / Share
                          {renderSortIndicator(itemSorts[group.key], 'cost_basis_per_share')}
                        </button>
                      </TableHead>

                      <TableHead className="px-3 sm:px-4 text-right">
                        <button type="button" className="ml-auto flex w-full items-center justify-end gap-2 whitespace-nowrap" onClick={() => toggleItemSort(group.key, 'current_price')}>
                          Current Price
                          {renderSortIndicator(itemSorts[group.key], 'current_price')}
                        </button>
                      </TableHead>

                      <TableHead className="px-3 sm:px-4 text-right">
                        <button type="button" className="ml-auto flex w-full items-center justify-end gap-2 whitespace-nowrap" onClick={() => toggleItemSort(group.key, 'cost_basis')}>
                          Total Cost Basis
                          {renderSortIndicator(itemSorts[group.key], 'cost_basis')}
                        </button>
                      </TableHead>

                      <TableHead className="px-3 sm:px-4 text-right">
                        <button type="button" className="ml-auto flex w-full items-center justify-end gap-2 whitespace-nowrap" onClick={() => toggleItemSort(group.key, 'value')}>
                          Current Value
                          {renderSortIndicator(itemSorts[group.key], 'value')}
                        </button>
                      </TableHead>

                      <TableHead className="px-3 sm:px-4 text-right">
                        <button type="button" className="ml-auto flex w-full items-center justify-end gap-2 whitespace-nowrap" onClick={() => toggleItemSort(group.key, 'weight')}>
                          Portfolio Weight
                          {renderSortIndicator(itemSorts[group.key], 'weight')}
                        </button>
                      </TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {(() => {
                      const sortSpec = itemSorts[group.key] || { key: 'value', dir: 'desc' }
                      const dirMul = sortSpec.dir === 'asc' ? 1 : -1
                      return [...(group.items || [])]
                        .slice()
                        .sort((a: any, b: any) => {
                          const k = sortSpec.key
                          if (k === 'ticker') {
                            const aa = (a.ticker || '').toLowerCase()
                            const bb = (b.ticker || '').toLowerCase()
                            return aa.localeCompare(bb) * dirMul
                          }
                          if (k === 'quantity') {
                            const qa = getItemRemainingQuantity(a)
                            const qb = getItemRemainingQuantity(b)
                            return (qa - qb) * dirMul
                          }
                          if (k === 'cost_basis_per_share') {
                            const qa = getItemRemainingQuantity(a)
                            const qb = getItemRemainingQuantity(b)
                            const cpa = qa > 0 ? getItemRemainingCostBasis(a) / qa : 0
                            const cpb = qb > 0 ? getItemRemainingCostBasis(b) / qb : 0
                            return (cpa - cpb) * dirMul
                          }
                          if (k === 'current_price') {
                            const qa = getItemRemainingQuantity(a)
                            const qb = getItemRemainingQuantity(b)
                            const cpa = qa > 0 ? (Number(a.value) || 0) / qa : 0
                            const cpb = qb > 0 ? (Number(b.value) || 0) / qb : 0
                            return (cpa - cpb) * dirMul
                          }
                          if (k === 'weight') {
                            const wa = totalValueAcrossSelection > 0 ? ((Number(a.value) || 0) / totalValueAcrossSelection) * 100 : 0
                            const wb = totalValueAcrossSelection > 0 ? ((Number(b.value) || 0) / totalValueAcrossSelection) * 100 : 0
                            return (wa - wb) * dirMul
                          }
                          const va = Number(k === 'cost_basis' ? (a.cost_basis ?? 0) : (a.value ?? 0)) || 0
                          const vb = Number(k === 'cost_basis' ? (b.cost_basis ?? 0) : (b.value ?? 0)) || 0
                          return (va - vb) * dirMul
                        })
                        .map((item: any, idx: number) => {
                          const itemValue = Number(item.value) || 0
                          const itemWeight = totalValueAcrossSelection > 0 ? (itemValue / totalValueAcrossSelection) * 100 : 0
                          const itemQuantity = getItemRemainingQuantity(item)
                          const itemRemainingCostBasis = getItemRemainingCostBasis(item)
                          const itemCostBasisPerShare = itemQuantity > 0 ? itemRemainingCostBasis / itemQuantity : 0
                          const itemCurrentPrice = itemQuantity > 0 ? itemValue / itemQuantity : 0
                          return (
                            <TableRow key={`${item.ticker ?? item.name ?? idx}`}>
                              <TableCell className="px-3 sm:px-4 align-top">
                                <div className="font-bold truncate">{item.ticker}</div>
                                <div className="text-[10px] opacity-70 truncate">{item.name}</div>
                              </TableCell>
                              <TableCell className="px-3 sm:px-4 text-right tabular-nums whitespace-nowrap">{itemQuantity.toLocaleString(undefined, { maximumFractionDigits: 6 })}</TableCell>
                              <TableCell className="px-3 sm:px-4 text-right tabular-nums whitespace-nowrap">{formatUSD(itemCostBasisPerShare)}</TableCell>
                              <TableCell className="px-3 sm:px-4 text-right tabular-nums whitespace-nowrap">{formatUSD(itemCurrentPrice)}</TableCell>
                              <TableCell className="px-3 sm:px-4 text-right tabular-nums whitespace-nowrap">{formatUSD(item.cost_basis)}</TableCell>
                              <TableCell className="px-3 sm:px-4 text-right tabular-nums font-bold whitespace-nowrap">{formatUSD(itemValue)}</TableCell>
                              <TableCell className="px-3 sm:px-4 text-right tabular-nums whitespace-nowrap">{itemWeight.toFixed(2)}%</TableCell>
                            </TableRow>
                          )
                        })
                    })()}
                  </TableBody>
                </Table>
                </div>
              </AccordionContent>
            </AccordionItem>
          )
        })}
      </Accordion>
      </DashboardSurface>

      <Dialog open={!!cashDialogAccountId} onOpenChange={(open) => setCashDialogAccountId(open ? cashDialogAccountId : null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Set Account Cash Balance</DialogTitle>
            <DialogDescription>
              Create a manual end-of-day cash balance for this account. Future cash values will be recalculated from this balance plus later transactions.
            </DialogDescription>
          </DialogHeader>

          {selectedCashAccount ? (
            <div className="space-y-4">
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div className="rounded-2xl border border-zinc-200 bg-zinc-50 px-4 py-3">
                  <p className="dashboard-metric-label">Account</p>
                  <p className="mt-1 text-sm font-semibold text-zinc-950">{selectedCashAccount.accountName}</p>
                </div>
                <div className="rounded-2xl border border-zinc-200 bg-zinc-50 px-4 py-3">
                  <p className="dashboard-metric-label">Current Manual Anchor</p>
                  <p className="mt-1 text-sm font-semibold text-zinc-950">{selectedCashAccount.hasManualAnchor ? `As of ${selectedCashAccount.anchorEffectiveDate}` : 'None'}</p>
                </div>
                <div className="rounded-2xl border border-zinc-200 bg-zinc-50 px-4 py-3">
                  <p className="dashboard-metric-label">Current Auto Cash</p>
                  <p className="mt-1 text-sm font-semibold text-zinc-950">{formatUSD(selectedCashAccount.autoCash)}</p>
                </div>
                <div className="rounded-2xl border border-zinc-200 bg-zinc-50 px-4 py-3">
                  <p className="dashboard-metric-label">Current Effective Cash</p>
                  <p className="mt-1 text-sm font-semibold text-zinc-950">{formatUSD(selectedCashAccount.effectiveCash)}</p>
                </div>
                <div className="rounded-2xl border border-zinc-200 bg-zinc-50 px-4 py-3 sm:col-span-2">
                  <p className="dashboard-metric-label">Difference</p>
                  <p className="mt-1 text-sm font-semibold text-zinc-950">{formatUSD(selectedCashAccount.effectiveCash - selectedCashAccount.autoCash)}</p>
                </div>
              </div>

              <div className="space-y-2">
                <Label htmlFor="cash-effective-date">Effective Date</Label>
                <Input id="cash-effective-date" type="date" value={cashFormDate} onChange={(event) => setCashFormDate(event.target.value)} max={new Date().toISOString().slice(0, 10)} />
                <p className="text-xs text-zinc-500">This is an end-of-day balance. Transactions on this date are treated as already included.</p>
              </div>

              <div className="space-y-2">
                <Label htmlFor="cash-balance">Cash Balance</Label>
                <Input id="cash-balance" inputMode="decimal" value={cashFormBalance} onChange={(event) => setCashFormBalance(event.target.value)} placeholder="0.00" />
                <p className="text-xs text-zinc-500">Enter the account cash balance as of the effective date.</p>
              </div>

              <div className="space-y-2">
                <Label htmlFor="cash-note">Note</Label>
                <Textarea id="cash-note" value={cashFormNote} onChange={(event) => setCashFormNote(event.target.value)} maxLength={500} placeholder="Optional note, such as statement balance or reconciliation reason" />
              </div>

              {cashDialogError ? <p className="text-sm text-red-600">{cashDialogError}</p> : null}
            </div>
          ) : null}

          <DialogFooter className="gap-2 sm:justify-between">
            <div>
              {selectedCashAccount?.hasManualAnchor && selectedCashAccount.anchorId ? (
                <Button type="button" variant="outline" className="border-red-300 text-red-700 hover:bg-red-50" onClick={handleRemoveLatestManualBalance} disabled={cashSaving}>
                  Remove Latest Manual Balance
                </Button>
              ) : null}
            </div>
            <div className="flex gap-2">
              <Button type="button" variant="outline" onClick={() => setCashDialogAccountId(null)} disabled={cashSaving}>Cancel</Button>
              <Button type="button" onClick={handleSaveCashBalance} disabled={cashSaving}>{cashSaving ? 'Saving...' : 'Save Cash Balance'}</Button>
            </div>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
