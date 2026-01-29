'use client'

import { useState, useEffect, useRef, useMemo, createContext, useContext } from 'react'
import {
  PieChart, Pie, Cell, ResponsiveContainer, Tooltip as RechartsTooltip, Legend,
  BarChart, Bar, XAxis, YAxis, CartesianGrid,
} from 'recharts'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'
import { Label } from '@/components/ui/label'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from '@/components/ui/accordion'
import { Popover, PopoverTrigger, PopoverContent } from '@/components/ui/popover'
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from '@/components/ui/command'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'
import { Check, ChevronsUpDown, ArrowUpDown, RefreshCw, Download, AlertTriangle } from 'lucide-react'
import { formatUSD } from '@/lib/formatters'
import { cn } from '@/lib/utils'
import { refreshAssetPrices } from '../portfolio/actions'
import { Checkbox } from '@/components/ui/checkbox'

const COLORS = ['#3b82f6', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6', '#ec4899', '#06b6d4', '#14b8a6', '#f97316', '#a855f7']

const LENSES = [
  { value: 'total', label: 'Assets' },
  { value: 'sub_portfolio', label: 'Sub-Portfolio' },
  { value: 'asset_type', label: 'Asset Type' },
  { value: 'asset_subtype', label: 'Asset Sub-Type' },
  { value: 'geography', label: 'Geography' },
  { value: 'size_tag', label: 'Size' },
  { value: 'factor_tag', label: 'Factor' },
]
type SubPortfolioTarget = {
  id: string
  name: string
  target_allocation: number
  upside_threshold: number
  downside_threshold: number
  band_mode: boolean
}

type AssetTarget = {
  asset_id: string
  sub_portfolio_id: string
  target_percentage: number
}

type RebalancingData = {
  subPortfolios: SubPortfolioTarget[]
  assetTargets: AssetTarget[]
  currentAllocations: {
    sub_portfolio_id: string | null
    asset_id: string
    ticker: string
    name: string | null
    current_value: number
    current_percentage: number
    sub_portfolio_percentage: number
    sub_portfolio_target_percentage: number
    implied_overall_target: number
    drift_percentage: number
    drift_dollar: number
    action: 'buy' | 'sell' | 'hold'
    amount: number
    tax_notes: string
    tax_impact: number
    reinvestment_suggestions: {
      asset_id: string
      ticker: string
      name: string | null
      suggested_amount: number
      suggested_shares: number
      reason: string
    }[]
    recommended_accounts: {
      id: string
      name: string
      type: string
      reason: string
    }[]
  }[]
  totalValue: number
  cashNeeded: number
  lastPriceUpdate: string | null
}

export default function RebalancingPage() {
  // Small component to show recommended accounts with per-account split and lot ids in a hover popover
  function RecommendedAccountsPopover({ accounts }: { accounts: any[] }) {
    const [open, setOpen] = useState(false)
    if (!accounts || accounts.length === 0) return <span>-</span>

    const triggerContent = (
      <div className="space-y-1">
        {accounts.slice(0, 2).map((acc: any, idx: number) => (
          <div key={idx} className="text-xs">
            <span className="font-medium">{acc.name}</span>
            <span className="text-muted-foreground"> ({acc.type})</span>
          </div>
        ))}
        {accounts.length > 2 && (
          <div className="text-xs text-muted-foreground">+{accounts.length - 2} more</div>
        )}
      </div>
    )

    return (
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <div onMouseEnter={() => setOpen(true)} onMouseLeave={() => setOpen(false)}>
            {triggerContent}
          </div>
        </PopoverTrigger>

        <PopoverContent className="w-72 p-2">
          <div className="space-y-2 text-sm">
            {accounts.map((acc: any, idx: number) => (
              <div key={idx} className="border rounded p-2">
                <div className="flex items-baseline justify-between">
                  <div className="font-medium">{acc.name} <span className="text-muted-foreground">({acc.type})</span></div>
                  <div className="text-xs">{acc.amount ? formatUSD(acc.amount) : ''}</div>
                </div>
                <div className="text-xs text-muted-foreground">Holding value: {formatUSD(acc.holding_value || 0)}</div>
                {acc.lot_ids && acc.lot_ids.length > 0 && (
                  <div className="text-xs mt-1">Lots: {acc.lot_ids.join(', ')}</div>
                )}
                {acc.reason && <div className="text-xs mt-1 text-muted-foreground">{acc.reason}</div>}
              </div>
            ))}
          </div>
        </PopoverContent>
      </Popover>
    )
  }
  const [lens, setLens] = useState('total')
  const [availableValues, setAvailableValues] = useState<{value: string, label: string}[]>([])
  const [selectedValues, setSelectedValues] = useState<string[]>([])
  const [aggregate, setAggregate] = useState(true)
  const [data, setData] = useState<RebalancingData | null>(null)
  const [loading, setLoading] = useState(true)
  const [valuesLoading, setValuesLoading] = useState(false)
  const [refreshing, setRefreshing] = useState(false)
  const [refreshMessage, setRefreshMessage] = useState<string | null>(null)
  const [refreshTrigger, setRefreshTrigger] = useState(0)
  
  // Load available values for the chosen lens (used by the multi-select)
  useEffect(() => {
    if (lens === 'total') {
      setAvailableValues([])
      setSelectedValues([])
      setValuesLoading(false)
      // ensure aggregate mode is off for asset-level view
      setAggregate(false)
      return
    }

    const fetchValues = async () => {
      setValuesLoading(true)
      try {
        const res = await fetch('/api/dashboard/values', {
          method: 'POST',
          body: JSON.stringify({ lens }),
        })
        if (!res.ok) throw new Error('Failed to fetch values')
        const payload = await res.json()
        const vals = payload.values || []
        setAvailableValues(vals)
        setSelectedValues(vals.map((v: any) => v.value))
      } catch (err) {
        console.error('Error fetching values for lens', lens, err)
        setAvailableValues([])
        setSelectedValues([])
      } finally {
        setValuesLoading(false)
      }
    }

    fetchValues()
  }, [lens])

  const toggleValue = (value: string) => {
    setSelectedValues(prev => prev.includes(value) ? prev.filter(v => v !== value) : [...prev, value])
  }

  // Validation state
  const [validationErrors, setValidationErrors] = useState<{
    subPortfolios: {[key: string]: string};
    assets: {[key: string]: {[key: string]: string}};
  }>({ subPortfolios: {}, assets: {} })
  const [draftSubTargets, setDraftSubTargets] = useState<Record<string, number>>({})
  const [draftAssetTargets, setDraftAssetTargets] = useState<Record<string, Record<string, number>>>({})
  const [savingSubTargets, setSavingSubTargets] = useState<Record<string, boolean>>({})
  const [errorSubTargets, setErrorSubTargets] = useState<Record<string, string>>({})
  const [savingAssetTargets, setSavingAssetTargets] = useState<Record<string, Record<string, boolean>>>({})
  const [errorAssetTargets, setErrorAssetTargets] = useState<Record<string, Record<string, string>>>({})
  const recalcTimerRef = useRef<NodeJS.Timeout | null>(null)
  const pendingRecalcRef = useRef<Record<string, any>>({})

  // Sorting state
  const [sortColumn, setSortColumn] = useState<string>('current_value')
  const [sortDirection, setSortDirection] = useState<'asc' | 'desc'>('desc')

  // Accordion state
  const [openItems, setOpenItems] = useState<string[]>([])

  // Editing state
  const [editingSubPortfolio, setEditingSubPortfolio] = useState<string | null>(null)
  const initialLoadRef = useRef(true)
  

  const [barMode, setBarMode] = useState<'divergent' | 'stacked'>('divergent')

  // Calculate summary metrics dynamically
  const totalPortfolioDrift = useMemo(() => {
    if (!data) return 0
    return data.totalValue > 0
      ? data.currentAllocations.reduce((sum, item) => {
          const weight = item.current_value / data.totalValue
          return sum + (Math.abs(item.drift_percentage) * weight)
        }, 0)
      : 0
  }, [data])

  const subPortfolioDrift = useMemo(() => {
    if (!data) return 0
    const subPortfolioAllocations: { [key: string]: number } = {}
    data.currentAllocations.forEach(item => {
      const subId = item.sub_portfolio_id || 'unassigned'
      subPortfolioAllocations[subId] = (subPortfolioAllocations[subId] || 0) + item.current_value
    })

    let totalWeightedDrift = 0
    let totalValue = 0

    data.subPortfolios.forEach(sp => {
      const currentValue = subPortfolioAllocations[sp.id] || 0
      const currentAllocation = data.totalValue > 0 ? (currentValue / data.totalValue) * 100 : 0
      const targetAllocation = sp.target_allocation
      const relativeDrift = targetAllocation > 0 ? Math.abs((currentAllocation - targetAllocation) / targetAllocation) : 0
      totalWeightedDrift += relativeDrift * currentValue
      totalValue += currentValue
    })

    return totalValue > 0 ? totalWeightedDrift / totalValue : 0
  }, [data])

  const assetDrift = totalPortfolioDrift

  const magnitudeOfRebalance = useMemo(() => {
    return data?.cashNeeded || 0
  }, [data])
  

  // Recalculate actions/amounts whenever sub-portfolio settings change (e.g., thresholds or band mode)
  useEffect(() => {
    if (!data) return

    const subPortfolios = data.subPortfolios
    // Build a map of sub-portfolio total values
    const subValues = new Map<string, number>()
    data.currentAllocations.forEach(a => {
      const key = a.sub_portfolio_id || 'unassigned'
      subValues.set(key, (subValues.get(key) || 0) + a.current_value)
    })

    const updatedAllocations = data.currentAllocations.map(allocation => {
      const subId = allocation.sub_portfolio_id || 'unassigned'
      const subPortfolio = subPortfolios.find(sp => sp.id === subId)
      const assetTarget = data.assetTargets.find(at => at.asset_id === allocation.asset_id && at.sub_portfolio_id === allocation.sub_portfolio_id)?.target_percentage || allocation.sub_portfolio_target_percentage || 0

      const subValue = subValues.get(subId) || 0
      const targetValue = (subValue * assetTarget) / 100
      const transactionAmount = Math.abs(targetValue - allocation.current_value)

      const driftPercentage = assetTarget > 0 ? ((allocation.sub_portfolio_percentage - assetTarget) / assetTarget) * 100 : 0
      const driftDollar = (driftPercentage / 100) * data.totalValue

      let action: 'buy' | 'sell' | 'hold' = 'hold'
      let amount = 0

      if (subPortfolio) {
        const upsideThreshold = subPortfolio.upside_threshold
        const downsideThreshold = subPortfolio.downside_threshold
        const bandMode = subPortfolio.band_mode

        if (driftPercentage <= -Math.abs(downsideThreshold)) {
          action = 'buy'
        } else if (driftPercentage >= Math.abs(upsideThreshold)) {
          action = 'sell'
        } else {
          action = 'hold'
        }

        if (action === 'buy' || action === 'sell') {
          if (bandMode) {
            const targetDrift = action === 'sell' ? upsideThreshold : -downsideThreshold
            const targetPercentage = assetTarget * (1 + targetDrift / 100)
            const targetValueBand = (subValue * targetPercentage) / 100
            amount = Math.abs(targetValueBand - allocation.current_value)
          } else {
            amount = transactionAmount
          }
        }
      }

      const impliedOverallTarget = (subPortfolio?.target_allocation || 0) * assetTarget / 100

      return {
        ...allocation,
        drift_percentage: driftPercentage,
        drift_dollar: driftDollar,
        action,
        amount: Math.abs(amount),
        implied_overall_target: impliedOverallTarget
      }

    })

    setData(prev => prev ? { ...prev, currentAllocations: updatedAllocations } : prev);

    // Recalculate tax data for the updated allocations so tax impact/recommendations refresh immediately
    (async () => {
      const allocationsToUpdate = updatedAllocations.map(a => ({
        asset_id: a.asset_id,
        sub_portfolio_id: a.sub_portfolio_id,
        action: a.action,
        amount: a.amount
      }))
      if (allocationsToUpdate.length > 0) {
        scheduleRecalculate(allocationsToUpdate)
      }
    })()

  }, [JSON.stringify(data?.subPortfolios)])

  const fetchData = async () => {
    setLoading(true)
    try {
      const res = await fetch('/api/rebalancing', { cache: 'no-store' })
      if (!res.ok) throw new Error('Failed to fetch rebalancing data')
      const rebalancingData = await res.json()
      setData(rebalancingData)
      // initialize draft inputs from server data for immediate client-side validation
      const initialSubDrafts: Record<string, number> = {}
      rebalancingData.subPortfolios.forEach((sp: any) => {
        initialSubDrafts[sp.id] = sp.target_allocation || 0
      })
      const initialAssetDrafts: Record<string, Record<string, number>> = {}
      rebalancingData.currentAllocations.forEach((a: any) => {
        const subId = a.sub_portfolio_id || 'unassigned'
        if (!initialAssetDrafts[subId]) initialAssetDrafts[subId] = {}
        initialAssetDrafts[subId][a.asset_id] = a.sub_portfolio_target_percentage || a.sub_portfolio_percentage || 0
      })
      setDraftSubTargets(initialSubDrafts)
      setDraftAssetTargets(initialAssetDrafts)
      validateWithDrafts(rebalancingData)
      // Ensure server-side tax recalculation is applied for all non-hold allocations
      const allocationsToRecalc = rebalancingData.currentAllocations
        .filter((a: any) => a.action && a.action !== 'hold')
        .map((a: any) => ({ asset_id: a.asset_id, sub_portfolio_id: a.sub_portfolio_id, action: a.action, amount: a.amount }))
      if (allocationsToRecalc.length > 0) {
        // fire-and-forget; we want the UI to reflect authoritative server-side tax calculations
        recalculateTaxData(allocationsToRecalc).catch(err => console.error('recalc after fetch failed', err))
      }
    } catch (error) {
      console.error('Error fetching rebalancing data:', error)
    } finally {
      setLoading(false)
    }
  }

  // Re-validate whenever any draft target changes so UI reflects corrections immediately
  useEffect(() => {
    if (data) validateWithDrafts(data)
  }, [JSON.stringify(draftSubTargets), JSON.stringify(draftAssetTargets)])

  // Fetch initial data and on refresh trigger
  useEffect(() => {
    fetchData()
  }, [refreshTrigger])

  // On initial load collapse accordion (only run once)
  useEffect(() => {
    if (initialLoadRef.current && data) {
      setOpenItems([])
      initialLoadRef.current = false
    }
  }, [data])

  const handleRefreshPrices = async () => {
    setRefreshing(true)
    setRefreshMessage(null)
    try {
      const result = await refreshAssetPrices()
      setRefreshMessage(result.message || 'Prices refreshed!')
      setRefreshTrigger(prev => prev + 1)
    } catch (error: any) {
      setRefreshMessage('Error refreshing prices: ' + error.message)
    } finally {
      setRefreshing(false)
    }
  }

  const handleExport = () => {
    if (!data) return
    // Implement CSV export
    const csv = generateCSV(data)
    const blob = new Blob([csv], { type: 'text/csv' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = 'rebalancing-suggestions.csv'
    a.click()
    URL.revokeObjectURL(url)
  }

  const recalculateTaxData = async (allocationsToUpdate: any[]) => {
    if (!data || allocationsToUpdate.length === 0) return

    try {
      // Create a temporary data object with updated allocations for tax calculation
      const tempData = {
        ...data,
        currentAllocations: data.currentAllocations.map(allocation => {
          const updated = allocationsToUpdate.find(a => a.asset_id === allocation.asset_id && a.sub_portfolio_id === allocation.sub_portfolio_id)
          return updated || allocation
        })
      }

      // Call the API to recalculate tax data for these specific allocations
      const res = await fetch('/api/rebalancing/recalculate-tax', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          allocations: allocationsToUpdate,
          totalValue: data.totalValue,
          currentAllocations: tempData.currentAllocations,
          accounts: data.currentAllocations.map(a => ({ id: a.asset_id, name: a.ticker, type: 'Taxable', tax_status: 'Taxable' })) // Simplified
        })
      })

      if (res.ok) {
        const taxUpdates = await res.json()
        
        // Update the local state with the recalculated tax data
        setData(prevData => {
          if (!prevData) return prevData
          
          const updatedAllocations = prevData.currentAllocations.map(allocation => {
            const taxUpdate = taxUpdates.find((update: any) => 
              update.asset_id === allocation.asset_id && update.sub_portfolio_id === allocation.sub_portfolio_id
            )
            if (taxUpdate) {
              return {
                ...allocation,
                tax_impact: taxUpdate.tax_impact,
                recommended_accounts: taxUpdate.recommended_accounts,
                tax_notes: taxUpdate.tax_notes,
                reinvestment_suggestions: taxUpdate.reinvestment_suggestions
              }
            }
            return allocation
          })
          
          return {
            ...prevData,
            currentAllocations: updatedAllocations
          }
        })
      }
    } catch (error) {
      console.error('Error recalculating tax data:', error)
    }
  }

  // Debounced scheduler: merge allocations by key and delay calls to reduce churn
  const scheduleRecalculate = (allocationsToUpdate: any[], delay = 400) => {
    // merge incoming allocations into pending map using key asset|sub
    allocationsToUpdate.forEach(a => {
      const key = `${a.asset_id}::${a.sub_portfolio_id}`
      pendingRecalcRef.current[key] = a
    })

    if (recalcTimerRef.current) clearTimeout(recalcTimerRef.current)
    recalcTimerRef.current = setTimeout(() => {
      const merged = Object.values(pendingRecalcRef.current)
      pendingRecalcRef.current = {}
      recalcTimerRef.current = null
      recalculateTaxData(merged as any[])
    }, delay)
  }

  const validateAllocations = (data: RebalancingData) => {
    const subPortfolioErrors: {[key: string]: string} = {}
    const assetErrors: {[key: string]: {[key: string]: string}} = {}

    // Check sub-portfolio allocations sum to 100%
    const totalSubPortfolioAllocation = data.subPortfolios.reduce((sum, sp) => sum + (sp.target_allocation || 0), 0)
    if (Math.abs(totalSubPortfolioAllocation - 100) > 0.01) {
      // Mark all sub-portfolios as having errors
      data.subPortfolios.forEach(sp => {
        subPortfolioErrors[sp.id] = `Sub-portfolio allocations sum to ${totalSubPortfolioAllocation.toFixed(2)}% (should be 100%)`
      })
    }

    // Check asset allocations within each sub-portfolio sum to 100%
    data.subPortfolios.forEach(sp => {
      const subPortfolioAssets = data.currentAllocations.filter(item => item.sub_portfolio_id === sp.id)
      const totalAssetAllocation = subPortfolioAssets.reduce((sum, item) => {
        const target = item.sub_portfolio_target_percentage || item.sub_portfolio_percentage
        return sum + target
      }, 0)
      
      if (Math.abs(totalAssetAllocation - 100) > 0.01) {
        assetErrors[sp.id] = {}
        subPortfolioAssets.forEach(asset => {
          assetErrors[sp.id][asset.asset_id] = `${sp.name}: Asset allocations sum to ${totalAssetAllocation.toFixed(2)}% (should be 100%)`
        })
      }
    })

    setValidationErrors({ subPortfolios: subPortfolioErrors, assets: assetErrors })
  }

  // Validate merging any in-progress drafts so UI reflects immediate edits
  const validateWithDrafts = (baseData: RebalancingData) => {
    // shallow clone and apply drafts
    const cloned = JSON.parse(JSON.stringify(baseData)) as RebalancingData

    // apply sub-portfolio drafts
    cloned.subPortfolios = cloned.subPortfolios.map(sp => ({
      ...sp,
      target_allocation: draftSubTargets[sp.id] ?? sp.target_allocation
    }))

    // apply asset drafts
    cloned.currentAllocations = cloned.currentAllocations.map(a => ({
      ...a,
      sub_portfolio_target_percentage: (draftAssetTargets[a.sub_portfolio_id || 'unassigned'] || {})[a.asset_id] ?? a.sub_portfolio_target_percentage
    }))

    validateAllocations(cloned)
  }

  const handleSort = (column: string) => {
    if (sortColumn === column) {
      setSortDirection(sortDirection === 'asc' ? 'desc' : 'asc')
    } else {
      setSortColumn(column)
      setSortDirection('desc') // Default to descending for new column
    }
  }

  const sortAllocations = (allocations: any[]) => {
    return [...allocations].sort((a, b) => {
      let aValue: any
      let bValue: any

      switch (sortColumn) {
        case 'ticker':
          aValue = a.ticker.toLowerCase()
          bValue = b.ticker.toLowerCase()
          break
        case 'current_value':
          aValue = a.current_value
          bValue = b.current_value
          break
        case 'current_percentage':
          aValue = a.current_percentage
          bValue = b.current_percentage
          break
        case 'sub_portfolio_percentage':
          aValue = a.sub_portfolio_percentage
          bValue = b.sub_portfolio_percentage
          break
        case 'sub_portfolio_target_percentage':
          aValue = a.sub_portfolio_target_percentage || a.sub_portfolio_percentage
          bValue = b.sub_portfolio_target_percentage || b.sub_portfolio_percentage
          break
        case 'implied_overall_target':
          aValue = a.implied_overall_target
          bValue = b.implied_overall_target
          break
        case 'drift_percentage':
          aValue = a.drift_percentage
          bValue = b.drift_percentage
          break
        case 'amount':
          aValue = a.amount
          bValue = b.amount
          break
        case 'tax_impact':
          aValue = a.tax_impact
          bValue = b.tax_impact
          break
        default:
          return 0
      }

      if (aValue < bValue) return sortDirection === 'asc' ? -1 : 1
      if (aValue > bValue) return sortDirection === 'asc' ? 1 : -1
      return 0
    })
  }

  const calculateTotals = (allocations: any[]) => {
    const totalCurrentValue = allocations.reduce((sum, item) => sum + item.current_value, 0)
    const totalCurrentPercentage = allocations.reduce((sum, item) => sum + item.current_percentage, 0)
    const totalTargetPercentage = allocations.reduce((sum, item) => {
      const target = item.sub_portfolio_target_percentage || item.sub_portfolio_percentage
      return sum + target
    }, 0)
    const totalImpliedOverallTarget = allocations.reduce((sum, item) => sum + item.implied_overall_target, 0)
    
    // Weighted average drift percentage (weighted by current value, using absolute drift)
    const weightedDriftSum = allocations.reduce((sum, item) => sum + (Math.abs(item.drift_percentage) * item.current_value), 0)
    const totalDriftPercentage = totalCurrentValue > 0 ? weightedDriftSum / totalCurrentValue : 0
    
    const totalTaxImpact = allocations.reduce((sum, item) => sum + item.tax_impact, 0)

    return {
      current_value: totalCurrentValue,
      current_percentage: totalCurrentPercentage,
      target_percentage: totalTargetPercentage,
      implied_overall_target: totalImpliedOverallTarget,
      drift_percentage: totalDriftPercentage,
      tax_impact: totalTaxImpact
    }
  }

  const SortableTableHead = ({ column, children, className }: { column: string, children: React.ReactNode, className?: string }) => (
    <TableHead className={cn("cursor-pointer hover:bg-gray-50 select-none", className)} onClick={() => handleSort(column)}>
      <div className="flex items-center justify-between">
        <span>{children}</span>
        <ArrowUpDown className={cn("h-4 w-4 ml-1", sortColumn === column ? "text-blue-600" : "text-gray-400")} />
      </div>
    </TableHead>
  )

  const generateCSV = (data: RebalancingData) => {
    const headers = [
      'Sub-Portfolio', 
      'Asset', 
      'Current %', 
      'Target %', 
      'Implied Overall Target %', 
      'Drift %', 
      'Action', 
      'Recommended Transaction Amount', 
      'Tax Impact', 
      'Recommended Accounts', 
      'Tax Notes',
      'Reinvestment Suggestions'
    ]
    const rows = data.currentAllocations.map(item => {
      const subPortfolio = data.subPortfolios.find(sp => sp.id === item.sub_portfolio_id)
      const recommendedAccounts = item.recommended_accounts.map(acc => `${acc.name} (${acc.type})`).join('; ')
      const reinvestmentSuggestions = item.reinvestment_suggestions.map(s => 
        `${s.ticker}: ${formatUSD(s.suggested_amount)} (${s.suggested_shares.toFixed(0)} shares)`
      ).join('; ')

      return [
        subPortfolio?.name || 'Unassigned',
        item.ticker,
        item.current_percentage.toFixed(2),
        item.sub_portfolio_percentage.toFixed(2),
        item.implied_overall_target.toFixed(2),
        item.drift_percentage.toFixed(2),
        item.action,
        (item.action === 'sell' ? '-' : '') + formatUSD(item.amount).replace('$', ''),
        formatUSD(item.tax_impact),
        recommendedAccounts,
        item.tax_notes,
        reinvestmentSuggestions
      ]
    })
    return [headers, ...rows].map(row => row.join(',')).join('\n')
  }

  const updateSubPortfolioTarget = async (id: string, target: number) => {
    try {
      const res = await fetch('/api/rebalancing/sub-portfolio-target', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id, target_percentage: target })
      })
      setSavingSubTargets(prev => ({ ...prev, [id]: true }))
      setErrorSubTargets(prev => ({ ...prev, [id]: '' }))
      if (!res.ok) throw new Error('Failed to update target')

      // Update local state instead of triggering full refresh
      setData(prevData => {
        if (!prevData) return prevData
        
        // Update sub-portfolio target
        const updatedSubPortfolios = prevData.subPortfolios.map(sp =>
          sp.id === id ? { ...sp, target_allocation: target } : sp
        )
        
        // Recalculate implied overall targets for all assets in this sub-portfolio
        const updatedAllocations = prevData.currentAllocations.map(allocation => {
          if (allocation.sub_portfolio_id === id) {
            const assetTarget = allocation.sub_portfolio_target_percentage || allocation.sub_portfolio_percentage
            const impliedOverallTarget = (target * assetTarget) / 100
            return {
              ...allocation,
              implied_overall_target: impliedOverallTarget
            }
          }
          return allocation
        })
        
        const updatedData = {
          ...prevData,
          subPortfolios: updatedSubPortfolios,
          currentAllocations: updatedAllocations
        }
        
        // Validate allocations after update
        validateAllocations(updatedData)
        return updatedData
      })
      
      // Recalculate tax data for all allocations in this sub-portfolio
      const affectedAllocations = data?.currentAllocations.filter(a => a.sub_portfolio_id === id) || []
      if (affectedAllocations.length > 0) {
        scheduleRecalculate(affectedAllocations)
      }
      setSavingSubTargets(prev => ({ ...prev, [id]: false }))
    } catch (error) {
      // rollback draft to server value when available
      const serverVal = data?.subPortfolios.find(sp => sp.id === id)?.target_allocation || 0
      setDraftSubTargets(prev => ({ ...prev, [id]: serverVal }))
      setErrorSubTargets(prev => ({ ...prev, [id]: (error as any)?.message || 'Save failed' }))
      console.error('Error updating sub-portfolio target:', error)
      setSavingSubTargets(prev => ({ ...prev, [id]: false }))
    }
  }

  const updateAssetTarget = async (assetId: string, subPortfolioId: string, target: number) => {
    try {
      const res = await fetch('/api/rebalancing/asset-target', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ asset_id: assetId, sub_portfolio_id: subPortfolioId, target_percentage: target })
      })
      setSavingAssetTargets(prev => ({ ...prev, [subPortfolioId]: { ...(prev[subPortfolioId] || {}), [assetId]: true } }))
      setErrorAssetTargets(prev => ({ ...prev, [subPortfolioId]: { ...(prev[subPortfolioId] || {}), [assetId]: '' } }))
      if (!res.ok) throw new Error('Failed to update target')

      // Prepare updated assetTargets based on current `data` so we can use it for tax recalculation
      const updatedAssetTargets = (data?.assetTargets || []).some(at =>
        at.asset_id === assetId && at.sub_portfolio_id === subPortfolioId
      )
        ? (data!.assetTargets || []).map(at =>
            at.asset_id === assetId && at.sub_portfolio_id === subPortfolioId
              ? { ...at, target_percentage: target }
              : at
          )
        : [...(data?.assetTargets || []), { asset_id: assetId, sub_portfolio_id: subPortfolioId, target_percentage: target }]

      // Update local state instead of triggering full refresh
      setData(prevData => {
        if (!prevData) return prevData

        // Update asset targets (use prepared updatedAssetTargets)

        // Recalculate drift/action/amount for all assets in this sub-portfolio to match server logic
        const updatedAllocations = prevData.currentAllocations.map(allocation => {
          if ((allocation.sub_portfolio_id || 'unassigned') === (subPortfolioId || 'unassigned')) {
            const assetTarget = updatedAssetTargets.find(at => at.asset_id === allocation.asset_id && at.sub_portfolio_id === subPortfolioId)?.target_percentage || allocation.sub_portfolio_target_percentage || allocation.sub_portfolio_percentage || 0

            const driftPercentage = assetTarget > 0 ? ((allocation.sub_portfolio_percentage - assetTarget) / assetTarget) * 100 : 0
            const driftDollar = (driftPercentage / 100) * prevData.totalValue

            const subPortfolio = prevData.subPortfolios.find(sp => sp.id === subPortfolioId)
            const subValue = prevData.currentAllocations.filter(a => (a.sub_portfolio_id || 'unassigned') === (subPortfolioId || 'unassigned')).reduce((s, a) => s + a.current_value, 0)
            const targetValue = (subValue * assetTarget) / 100
            const transactionAmount = Math.abs(targetValue - allocation.current_value)

            let action: 'buy' | 'sell' | 'hold' = 'hold'
            let amount = 0

            if (subPortfolio) {
              const upsideThreshold = subPortfolio.upside_threshold
              const downsideThreshold = subPortfolio.downside_threshold
              const bandMode = subPortfolio.band_mode

              if (driftPercentage <= -Math.abs(downsideThreshold)) {
                action = 'buy'
              } else if (driftPercentage >= Math.abs(upsideThreshold)) {
                action = 'sell'
              } else {
                action = 'hold'
              }

              if (action === 'buy' || action === 'sell') {
                if (bandMode) {
                  const targetDrift = action === 'sell' ? upsideThreshold : -downsideThreshold
                  const targetPercentage = assetTarget * (1 + targetDrift / 100)
                  const targetValueBand = (subValue * targetPercentage) / 100
                  amount = Math.abs(targetValueBand - allocation.current_value)
                } else {
                  amount = transactionAmount
                }
              }
            }

            const impliedOverallTarget = (subPortfolio?.target_allocation || 0) * assetTarget / 100

            return {
              ...allocation,
              sub_portfolio_target_percentage: assetTarget,
              drift_percentage: driftPercentage,
              drift_dollar: driftDollar,
              implied_overall_target: impliedOverallTarget,
              action,
              amount: Math.abs(amount)
            }
          }
          return allocation
        })

        return {
          ...prevData,
          assetTargets: updatedAssetTargets,
          currentAllocations: updatedAllocations
        }
      })
      
      // Validate allocations after update
      if (data) validateAllocations(data)

      // Build affected allocations for this sub-portfolio (with recalculated action/amount)
      const affectedAllocations = (data?.currentAllocations || [])
        .filter(a => (a.sub_portfolio_id || 'unassigned') === (subPortfolioId || 'unassigned'))
        .map(allocation => {
          const assetTarget = updatedAssetTargets.find(at => at.asset_id === allocation.asset_id && at.sub_portfolio_id === subPortfolioId)?.target_percentage || allocation.sub_portfolio_target_percentage || allocation.sub_portfolio_percentage || 0
          const subValue = (data?.currentAllocations || []).filter(a => (a.sub_portfolio_id || 'unassigned') === (subPortfolioId || 'unassigned')).reduce((s, a) => s + a.current_value, 0)
          const targetValue = (subValue * assetTarget) / 100
          const transactionAmount = Math.abs(targetValue - allocation.current_value)

          const subPortfolio = data?.subPortfolios.find(sp => sp.id === subPortfolioId)
          let action: 'buy' | 'sell' | 'hold' = 'hold'
          let amount = 0
          if (subPortfolio) {
            const upsideThreshold = subPortfolio.upside_threshold
            const downsideThreshold = subPortfolio.downside_threshold
            const bandMode = subPortfolio.band_mode

            const driftPercentage = assetTarget > 0 ? ((allocation.sub_portfolio_percentage - assetTarget) / assetTarget) * 100 : 0
            if (driftPercentage <= -Math.abs(downsideThreshold)) {
              action = 'buy'
            } else if (driftPercentage >= Math.abs(upsideThreshold)) {
              action = 'sell'
            } else {
              action = 'hold'
            }

            if (action === 'buy' || action === 'sell') {
              if (bandMode) {
                const targetDrift = action === 'sell' ? upsideThreshold : -downsideThreshold
                const targetPercentage = assetTarget * (1 + targetDrift / 100)
                const targetValueBand = (subValue * targetPercentage) / 100
                amount = Math.abs(targetValueBand - allocation.current_value)
              } else {
                amount = transactionAmount
              }
            }
          }

          return {
            asset_id: allocation.asset_id,
            sub_portfolio_id: allocation.sub_portfolio_id,
            action,
            amount: Math.abs(amount)
          }
        })

      if (affectedAllocations.length > 0) {
        scheduleRecalculate(affectedAllocations)
      }
      setSavingAssetTargets(prev => ({ ...prev, [subPortfolioId]: { ...(prev[subPortfolioId] || {}), [assetId]: false } }))
    } catch (error) {
      // rollback draft to server value when available
      const serverVal = data?.currentAllocations.find(a => a.asset_id === assetId && a.sub_portfolio_id === subPortfolioId)?.sub_portfolio_target_percentage || 0
      setDraftAssetTargets(prev => ({ ...prev, [subPortfolioId]: { ...(prev[subPortfolioId] || {}), [assetId]: serverVal } }))
      setErrorAssetTargets(prev => ({ ...prev, [subPortfolioId]: { ...(prev[subPortfolioId] || {}), [assetId]: (error as any)?.message || 'Save failed' } }))
      console.error('Error updating asset target:', error)
      setSavingAssetTargets(prev => ({ ...prev, [subPortfolioId]: { ...(prev[subPortfolioId] || {}), [assetId]: false } }))
    }
  }

  const updateThresholds = async (id: string, upside: number, downside: number, bandMode: boolean) => {
    try {
      const res = await fetch('/api/rebalancing/thresholds', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id, upside_threshold: upside, downside_threshold: downside, band_mode: bandMode })
      })
      if (!res.ok) throw new Error('Failed to update thresholds')

      // Update local state instead of triggering full refresh
      setData(prevData => {
        if (!prevData) return prevData

        // Update sub-portfolio thresholds
        const updatedSubPortfolios = prevData.subPortfolios.map(sp =>
          sp.id === id ? { ...sp, upside_threshold: upside, downside_threshold: downside, band_mode: bandMode } : sp
        )

        // Recalculate actions/amounts for all assets in this sub-portfolio
        const prevSubPortfolio = prevData.subPortfolios.find(sp => sp.id === id)
        const thresholdsChanged = !prevSubPortfolio || prevSubPortfolio.upside_threshold !== upside || prevSubPortfolio.downside_threshold !== downside
        const bandModeChanged = !prevSubPortfolio || prevSubPortfolio.band_mode !== bandMode

        const updatedAllocations = prevData.currentAllocations.map(allocation => {
          if (allocation.sub_portfolio_id === id) {
            const assetTarget = prevData.assetTargets.find(at =>
              at.asset_id === allocation.asset_id && at.sub_portfolio_id === id
            )?.target_percentage || 0

            const driftPercentage = assetTarget > 0 ? ((allocation.sub_portfolio_percentage - assetTarget) / assetTarget) * 100 : 0
            const driftDollar = (driftPercentage / 100) * prevData.totalValue

            // Default to preserving existing action/amount unless thresholds changed
            let action: 'buy' | 'sell' | 'hold' = allocation.action || 'hold'
            let amount = allocation.amount || 0

            const relativeUpsideThreshold = assetTarget > 0 ? (upside / assetTarget) * 100 : upside
            const relativeDownsideThreshold = assetTarget > 0 ? (downside / assetTarget) * 100 : downside

            if (thresholdsChanged) {
              // Full recalculation: thresholds changed -> action and amount may change
              action = 'hold'
              amount = 0
              if (driftPercentage <= -Math.abs(downside) ) {
                action = 'buy'
              } else if (driftPercentage >= Math.abs(upside)) {
                action = 'sell'
              } else {
                action = 'hold'
              }

              if (action === 'buy' || action === 'sell') {
                if (bandMode) {
                  const targetDrift = action === 'sell' ? upside : -downside
                  const targetPercentage = assetTarget * (1 + targetDrift / 100)
                  const subValue = prevData.currentAllocations.filter(a => (a.sub_portfolio_id || 'unassigned') === id).reduce((s, a) => s + a.current_value, 0)
                  const targetValueBand = (subValue * targetPercentage) / 100
                  amount = Math.abs(targetValueBand - allocation.current_value)
                } else {
                  const subValue = prevData.currentAllocations.filter(a => (a.sub_portfolio_id || 'unassigned') === id).reduce((s, a) => s + a.current_value, 0)
                  const targetValue = (subValue * assetTarget) / 100
                  amount = Math.abs(targetValue - allocation.current_value)
                }
              }
            } else if (bandModeChanged) {
              // Only band mode changed: preserve action, recompute amount according to new bandMode
              if (allocation.action === 'sell' || allocation.action === 'buy') {
                const subValue = prevData.currentAllocations.filter(a => (a.sub_portfolio_id || 'unassigned') === id).reduce((s, a) => s + a.current_value, 0)
                if (bandMode) {
                  const targetDrift = allocation.action === 'sell' ? upside : -downside
                  const targetPercentage = assetTarget * (1 + targetDrift / 100)
                  const targetValueBand = (subValue * targetPercentage) / 100
                  amount = Math.abs(targetValueBand - allocation.current_value)
                } else {
                  const targetValue = (subValue * assetTarget) / 100
                  amount = Math.abs(targetValue - allocation.current_value)
                }
              } else {
                amount = 0
              }
            }

            return {
              ...allocation,
              drift_percentage: driftPercentage,
              drift_dollar: driftDollar,
              action,
              amount: Math.abs(amount)
            }
          }
          return allocation
        })

        return {
          ...prevData,
          subPortfolios: updatedSubPortfolios,
          currentAllocations: updatedAllocations
        }
      })
      
      // After updating thresholds, recalc tax data for all allocations in the sub-portfolio
      const affectedAllocations = data?.currentAllocations.filter(a => a.sub_portfolio_id === id).map(allocation => {
        // compute new action/amount according to updated sub-portfolio settings
        const assetTarget = data?.assetTargets.find(at => at.asset_id === allocation.asset_id && at.sub_portfolio_id === id)?.target_percentage || allocation.sub_portfolio_target_percentage || 0
        const subValue = data?.currentAllocations.filter(a => (a.sub_portfolio_id || 'unassigned') === (id || 'unassigned')).reduce((s, a) => s + a.current_value, 0) || 0
        const targetValue = (subValue * assetTarget) / 100
        const transactionAmount = Math.abs(targetValue - allocation.current_value)

        const subPortfolio = data?.subPortfolios.find(sp => sp.id === id)
        let action: 'buy' | 'sell' | 'hold' = allocation.action || 'hold'
        let amount = allocation.amount || 0
        if (subPortfolio) {
          const upsideThreshold = upside
          const downsideThreshold = downside
          const bandModeSetting = bandMode
          const driftPercentage = assetTarget > 0 ? ((allocation.sub_portfolio_percentage - assetTarget) / assetTarget) * 100 : 0
          if (driftPercentage <= -Math.abs(downsideThreshold)) {
            action = 'buy'
          } else if (driftPercentage >= Math.abs(upsideThreshold)) {
            action = 'sell'
          } else {
            action = 'hold'
          }
          if (action === 'buy' || action === 'sell') {
            if (bandModeSetting) {
              const targetDrift = action === 'sell' ? upsideThreshold : -downsideThreshold
              const targetPercentage = assetTarget * (1 + targetDrift / 100)
              const targetValueBand = (subValue * targetPercentage) / 100
              amount = Math.abs(targetValueBand - allocation.current_value)
            } else {
              amount = transactionAmount
            }
          }
        }

        return {
          asset_id: allocation.asset_id,
          sub_portfolio_id: allocation.sub_portfolio_id,
          action,
          amount: Math.abs(amount)
        }
      }) || []

      if (affectedAllocations.length > 0) {
        scheduleRecalculate(affectedAllocations)
      }
    } catch (error) {
      console.error('Error updating thresholds:', error)
    }
  }

  if (loading || !data) {
    return <div className="p-8 text-center">Loading rebalancing data...</div>
  }

  const currentAllocations = data.currentAllocations.filter(item => {
    if (lens === 'total') return true
    if (lens === 'sub_portfolio') return selectedValues.includes(item.sub_portfolio_id || 'unassigned')
    // For other lenses, we'd need to implement filtering based on asset metadata
    return true
  })

  const groupedAllocations = currentAllocations.reduce((acc, item) => {
    const key = item.sub_portfolio_id || 'unassigned'
    if (!acc.has(key)) acc.set(key, [])
    acc.get(key)!.push(item)
    return acc
  }, new Map<string, typeof currentAllocations>())

  const pieData = lens === 'total' 
    ? currentAllocations.map(item => ({
        name: item.ticker,
        value: item.current_value,
        percentage: item.current_percentage
      }))
    : aggregate 
      ? Array.from(groupedAllocations.entries()).map(([key, items]) => ({
          name: data.subPortfolios.find(sp => sp.id === key)?.name || 'Unassigned',
          value: items.reduce((sum, item) => sum + item.current_value, 0),
          percentage: items.reduce((sum, item) => sum + item.current_percentage, 0)
        }))
      : currentAllocations.map(item => ({
          name: item.ticker,
          value: item.current_value,
          percentage: item.current_percentage
        }))
  // sort pies descending by value for consistent ordering
  pieData.sort((a, b) => (b.value || 0) - (a.value || 0))

  const targetPieData = lens === 'total'
    ? currentAllocations.map(item => ({
        name: item.ticker,
        value: item.implied_overall_target * data.totalValue / 100,
        percentage: item.implied_overall_target
      }))
    : aggregate
      ? data.subPortfolios.map(sp => ({
          name: sp.name,
          value: sp.target_allocation || 0,
          percentage: sp.target_allocation || 0
        }))
      : currentAllocations.map(item => ({
          name: item.ticker,
          value: item.implied_overall_target * data.totalValue / 100,
          percentage: item.implied_overall_target
        }))
  // sort target pies descending by value
  targetPieData.sort((a, b) => (b.value || 0) - (a.value || 0))

  // Visualizations - RebalanceProvider + VisualController + ChartGrid

  const getChartHeight = (count: number, minHeight = 160) => {
    const perItem = 28
    const padding = 40
    const calculated = count * perItem + padding
    // clamp to a reasonable max to avoid extremely tall charts
    return Math.max(minHeight, Math.min(1200, calculated))
  }

  const RebalanceContext = createContext(null as any)

  function RebalanceProvider({ children }: { children: React.ReactNode }) {
    const [apiAllocations, setApiAllocations] = useState<any[]>([])

    useEffect(() => {
      if (lens === 'total') {
        setApiAllocations([])
        return
      }

      const loadAlloc = async () => {
        try {
          const payload = { lens, selectedValues: lens === 'total' ? [] : selectedValues, aggregate }
          const res = await fetch('/api/dashboard/allocations', { method: 'POST', body: JSON.stringify(payload), cache: 'no-store' })
          if (!res.ok) throw new Error('Failed to fetch allocations')
          const payloadData = await res.json()
          setApiAllocations(payloadData.allocations || [])
        } catch (err) {
          console.error('Error fetching allocations for visuals', err)
          setApiAllocations([])
        }
      }

      loadAlloc()
    }, [lens, selectedValues, aggregate, refreshTrigger])

    const grouped = useMemo(() => {
      if (!data) return []

      // Use API-provided allocations for non-asset lenses to match holdings page behavior
      if (lens !== 'total' && apiAllocations && apiAllocations.length > 0) {
        const totalValue = data.totalValue || apiAllocations.reduce((s: number, a: any) => s + (a.value || 0), 0)
        return apiAllocations.map((a: any) => {
          const items = (a.items && a.items.length) ? a.items : (a.data || []).map((d: any) => ({ ticker: d.subkey, current_value: d.value, current_percentage: d.percentage }))
          const currentValue = a.value || items.reduce((s: number, it: any) => s + (it.current_value || it.value || 0), 0)
          const currentPct = totalValue > 0 ? (currentValue / totalValue) * 100 : 0
          const targetPct = a.target_pct || a.percentage || 0
          const relativeDrift = targetPct > 0 ? (currentPct - targetPct) / targetPct : (currentPct === 0 ? 0 : Infinity)
          return { key: a.key, label: a.key, items, currentValue, targetPct, currentPct, relativeDrift }
        })
      }

      const items = currentAllocations

      const getKey = (item: any) => {
        switch (lens) {
          case 'sub_portfolio': return item.sub_portfolio_id || 'unassigned'
          case 'asset_type': return item.asset_type || 'Unknown'
          case 'asset_subtype': return item.asset_subtype || 'Unknown'
          case 'geography': return item.geography || 'Unknown'
          case 'size_tag': return item.size_tag || 'Unknown'
          case 'factor_tag': return item.factor_tag || 'Unknown'
          case 'asset': return item.ticker || item.asset_id
          default: return 'all'
        }
      }

      const map = new Map<string, { key: string; label: string; items: any[]; currentValue: number; targetPctSum: number }>()

      const filtered = items.filter(it => {
        if (lens === 'total') return true
        if (lens === 'sub_portfolio') {
          if (selectedValues.length === 0) return true
          return selectedValues.includes(it.sub_portfolio_id || 'unassigned')
        }
        const key = getKey(it)
        if (selectedValues.length === 0) return true
        return selectedValues.includes(String(key))
      })

      filtered.forEach(it => {
        const key = getKey(it)
        const label = (() => {
          if (lens === 'sub_portfolio') return data.subPortfolios.find(sp => sp.id === key)?.name || 'Unassigned'
          return key
        })()

        const existing: any = map.get(key) || { key, label, items: [] as any[], currentValue: 0, targetPctSum: 0 }
        existing.items.push(it)
        existing.currentValue += it.current_value || 0
        existing.targetPctSum += it.implied_overall_target || 0
        map.set(key, existing)
      })

      const totalValue = data.totalValue || filtered.reduce((s, it) => s + (it.current_value || 0), 0)

      return Array.from(map.values()).map(g => {
        const currentPct = totalValue > 0 ? (g.currentValue / totalValue) * 100 : 0
        const targetPct = g.targetPctSum || 0
        const relativeDrift = targetPct > 0 ? (currentPct - targetPct) / targetPct : (currentPct === 0 ? 0 : Infinity)
        return {
          ...g,
          currentPct,
          targetPct,
          relativeDrift
        }
      })
    }, [data, lens, aggregate, selectedValues, JSON.stringify(currentAllocations), JSON.stringify(apiAllocations)])

    return (
      <RebalanceContext.Provider value={{ grouped }}>{children}</RebalanceContext.Provider>
    )
  }

  function useRebalance() {
    return useContext(RebalanceContext)
  }

  function DriftLegend() {
    return (
      <div className="text-xs text-muted-foreground mb-3">
        <div className="flex flex-wrap gap-4 items-center">
          <div className="flex items-center gap-2">
            <span className="inline-block w-3 h-3 rounded" style={{ backgroundColor: '#10b981' }} />
            <span>Within 5% of target — Healthy</span>
          </div>
          <div className="flex items-center gap-2">
            <span className="inline-block w-3 h-3 rounded" style={{ backgroundColor: '#f59e0b' }} />
            <span>5–20% from target — Watch</span>
          </div>
          <div className="flex items-center gap-2">
            <span className="inline-block w-3 h-3 rounded" style={{ backgroundColor: '#ef4444' }} />
            <span>&gt;20% from target - Rebalance Consideration</span>
          </div>
        </div>
        <div className="mt-1">We color by absolute distance from target (closer = green).</div>
      </div>
    )
  }

  function StackedTooltip({ active, payload, label }: any) {
    if (!active || !payload || payload.length === 0) return null
    const d = payload[0]?.payload || {}
    const current = d.currentPct ?? null
    const target = d.targetPct ?? null
    return (
      <div className="bg-white border rounded px-3 py-2 text-sm">
        <div className="font-medium mb-1">{label}</div>
        {current !== null && (
          <div className="flex items-center gap-2"><span className="inline-block w-2 h-2" style={{ backgroundColor: '#10b981' }} />Current: {Number(current).toFixed(2)}%</div>
        )}
        {target !== null && (
          <div className="flex items-center gap-2"><span className="inline-block w-2 h-2" style={{ backgroundColor: '#3b82f6' }} />Target: {Number(target).toFixed(2)}%</div>
        )}
      </div>
    )
  }

  const stackedLegendPayload = [
    { value: 'Base (min of current & target)', type: 'square', color: '#0f172a' },
    { value: 'Delta (green if current > target, red if target > current)', type: 'square', color: '#10b981' }
  ]

  function StackedLegend() {
    return (
      <div className="flex items-center gap-4 mb-2">
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <span className="inline-block w-3 h-3" style={{ backgroundColor: '#0f172a' }} />
          <span>Base (min of current & target)</span>
        </div>
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <span className="inline-block w-3 h-3" style={{ backgroundColor: '#10b981' }} />
          <span>Delta (green if current &gt; target, red if target &gt; current)</span>
        </div>
      </div>
    )
  }

  function VisualController({ barMode, setBarMode }: { barMode: 'divergent' | 'stacked', setBarMode: (v: any) => void }) {
    return (
      <div className="flex flex-col md:flex-row md:items-end gap-4 mb-4">
        <div>
          <Label className="text-sm font-medium">View Lens</Label>
          <Select value={lens} onValueChange={(v) => setLens(v)}>
            <SelectTrigger className="w-56">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {LENSES.map(l => (
                <SelectItem key={l.value} value={l.value}>{l.label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {lens !== 'total' && (
          <div className="min-w-64">
            <Label className="text-sm font-medium">
              Select {LENSES.find(l => l.value === lens)?.label}s {valuesLoading && '(loading...)'}
            </Label>
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

        {lens !== 'total' && (
          <div className="flex items-center gap-2">
            <Label className="text-sm font-medium">Aggregate</Label>
            <Switch checked={aggregate} onCheckedChange={(v) => setAggregate(Boolean(v))} />
          </div>
        )}

        <div className="flex items-center gap-2">
          <Label className="text-sm font-medium">Divergent</Label>
          <Switch checked={barMode === 'stacked'} onCheckedChange={(v) => setBarMode(v ? 'stacked' : 'divergent')} />
          <Label className="text-sm font-medium">Target vs Current</Label>
        </div>

        <div className="ml-auto flex items-center gap-2">
          <Button onClick={handleRefreshPrices} disabled={refreshing} variant="default" className="bg-black text-white hover:bg-gray-800">
            <RefreshCw className={cn("h-4 w-4 mr-2", refreshing && "animate-spin")} />
            Refresh Prices
          </Button>
          <Button onClick={handleExport} variant="outline">
            <Download className="h-4 w-4 mr-2" />
            Export CSV
          </Button>
        </div>
      </div>
    )
  }

  function ChartGrid({ barMode }: { barMode: 'divergent' | 'stacked' }) {
    const { grouped } = useRebalance() || { grouped: [] }
    const debugMode = typeof window !== 'undefined' && new URLSearchParams(window.location.search).get('debugViz') === '1'

    const getDriftColor = (rel: number) => {
      const abs = Math.abs(rel) * 100
      if (abs <= 5) return '#10b981'
      if (abs <= 20) return '#f59e0b'
      return '#ef4444'
    }

    // Asset-level (Assets lens) view: show per-asset charts across entire portfolio
    if (lens === 'total') {
      const bars = currentAllocations.map((item: any) => {
        const currentPct = item.current_percentage || 0
        const targetPct = item.implied_overall_target || 0
        const basePct = Math.min(currentPct, targetPct)
        const deltaPct = Math.abs(currentPct - targetPct)
        const deltaColor = currentPct > targetPct ? '#10b981' : '#ef4444'
        return {
          name: item.ticker,
          currentPct,
          targetPct,
          basePct,
          deltaPct,
          deltaColor,
          relativeDriftPct: item.drift_percentage || 0
        }
      })
      const pieCurrent = currentAllocations.map((c: any) => ({ name: c.ticker, value: c.current_value }))
      const pieTarget = currentAllocations.map((c: any) => ({ name: c.ticker, value: (c.implied_overall_target || 0) * (data!.totalValue || 0) / 100 }))
      // sort bars by the largest of current/target percentage (desc)
      bars.sort((a: any, b: any) => Math.max(b.currentPct || 0, b.targetPct || 0) - Math.max(a.currentPct || 0, a.targetPct || 0))
      // sort pies descending by value
      pieCurrent.sort((a: any, b: any) => (b.value || 0) - (a.value || 0))
      pieTarget.sort((a: any, b: any) => (b.value || 0) - (a.value || 0))

      return (
        <div className="space-y-6">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div className="bg-card p-4 rounded-lg border">
              <h4 className="font-semibold mb-2">Current Allocation</h4>
              <ResponsiveContainer width="100%" height={Math.max(280, Math.min(520, Math.ceil(pieCurrent.length / 6) * 140))}>
                <PieChart>
                  <Pie data={pieCurrent} dataKey="value" nameKey="name" cx="50%" cy="50%" outerRadius={100} label={({ name, percent }: any) => `${name}: ${((percent||0)*100).toFixed(1)}%`}>
                    {pieCurrent.map((entry: any, idx: number) => <Cell key={idx} fill={COLORS[idx % COLORS.length]} />)}
                  </Pie>
                  <RechartsTooltip formatter={(value) => formatUSD(Number(value) || 0)} />
                  <Legend />
                </PieChart>
              </ResponsiveContainer>
            </div>

            <div className="bg-card p-4 rounded-lg border">
              <h4 className="font-semibold mb-2">Target Allocation</h4>
              <ResponsiveContainer width="100%" height={Math.max(280, Math.min(520, Math.ceil(pieTarget.length / 6) * 140))}>
                <PieChart>
                  <Pie data={pieTarget} dataKey="value" nameKey="name" cx="50%" cy="50%" outerRadius={100} label={({ name, percent }: any) => `${name}: ${((percent||0)*100).toFixed(1)}%`}>
                    {pieTarget.map((entry: any, idx: number) => <Cell key={idx} fill={COLORS[idx % COLORS.length]} />)}
                  </Pie>
                  <RechartsTooltip formatter={(value) => formatUSD(Number(value) || 0)} />
                  <Legend />
                </PieChart>
              </ResponsiveContainer>
            </div>
          </div>

          <div className="bg-card p-4 rounded-lg border">
            <h4 className="font-semibold mb-2">Drift Analysis (Assets)</h4>
            <div className="flex items-center">
              <ResponsiveContainer width="100%" height={getChartHeight(bars.length, 420)}>
                {barMode === 'divergent' ? (
                  <BarChart data={bars} layout="vertical" margin={{ left: 30 }}>
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis type="number" unit="%" />
                    <YAxis type="category" dataKey="name" interval={0} />
                    <RechartsTooltip formatter={(val: any) => `${Number(val).toFixed(2)}%`} />
                    <Bar dataKey="relativeDriftPct" fill="#8884d8">
                      {bars.map((entry: any, idx: number) => (
                        <Cell key={`cell-${idx}`} fill={getDriftColor(entry.relativeDriftPct / 100)} />
                      ))}
                    </Bar>
                  </BarChart>
                ) : (
                  <BarChart data={bars} layout="vertical" margin={{ left: 30 }}>
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis type="number" />
                    <YAxis type="category" dataKey="name" interval={0} />
                    <RechartsTooltip content={StackedTooltip} />
                    <StackedLegend />
                    <Bar dataKey="basePct" name="Base" fill="#0f172a" stackId="a" />
                    <Bar dataKey="deltaPct" name="Delta" stackId="a">
                      {bars.map((entry: any, idx: number) => (
                        <Cell key={idx} fill={entry.deltaColor} />
                      ))}
                    </Bar>
                  </BarChart>
                )}
              </ResponsiveContainer>
            </div>
            <DriftLegend />
          </div>
        </div>
      )
    }

    if (aggregate) {
      const sortedGrouped = grouped.slice().sort((a: any, b: any) => (b.currentValue || 0) - (a.currentValue || 0))
      const bars = sortedGrouped.map((g: any) => {
        const currentPct = g.currentPct || 0
        const targetPct = g.targetPct || 0
        const basePct = Math.min(currentPct, targetPct)
        const deltaPct = Math.abs(currentPct - targetPct)
        const deltaColor = currentPct > targetPct ? '#10b981' : '#ef4444'
        return { name: g.label, currentPct, targetPct, basePct, deltaPct, deltaColor, relativeDriftPct: g.relativeDrift === Infinity ? 0 : g.relativeDrift * 100 }
      })
      const pieCurrent = sortedGrouped.map((g: any, i: number) => ({ name: g.label, value: g.currentValue }))
      const pieTarget = sortedGrouped.map((g: any) => ({ name: g.label, value: (g.targetPct || 0) * (data!.totalValue || 0) / 100 }))

      // sort bars by the largest of current/target percentage (desc)
      bars.sort((a: any, b: any) => Math.max(b.currentPct || 0, b.targetPct || 0) - Math.max(a.currentPct || 0, a.targetPct || 0))
      // sort pie arrays by value desc (should already match sortedGrouped but ensure consistency)
      pieCurrent.sort((a: any, b: any) => (b.value || 0) - (a.value || 0))
      pieTarget.sort((a: any, b: any) => (b.value || 0) - (a.value || 0))

      return (
        <div className="space-y-6">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div className="bg-card p-4 rounded-lg border">
              <h4 className="font-semibold mb-2">Current Allocation</h4>
              <ResponsiveContainer width="100%" height={Math.max(280, Math.min(520, Math.ceil(pieCurrent.length / 6) * 140))}>
                <PieChart>
                  <Pie data={pieCurrent} dataKey="value" nameKey="name" cx="50%" cy="50%" outerRadius={100} label={({ name, percent }: any) => `${name}: ${((percent||0)*100).toFixed(1)}%`}>
                    {pieCurrent.map((entry: any, idx: number) => <Cell key={idx} fill={COLORS[idx % COLORS.length]} />)}
                  </Pie>
                  <RechartsTooltip formatter={(value) => formatUSD(Number(value) || 0)} />
                  <Legend />
                </PieChart>
              </ResponsiveContainer>
            </div>

            <div className="bg-card p-4 rounded-lg border">
              <h4 className="font-semibold mb-2">Target Allocation</h4>
              <ResponsiveContainer width="100%" height={Math.max(280, Math.min(520, Math.ceil(pieTarget.length / 6) * 140))}>
                <PieChart>
                  <Pie data={pieTarget} dataKey="value" nameKey="name" cx="50%" cy="50%" outerRadius={100} label={({ name, percent }: any) => `${name}: ${((percent||0)*100).toFixed(1)}%`}>
                    {pieTarget.map((entry: any, idx: number) => <Cell key={idx} fill={COLORS[idx % COLORS.length]} />)}
                  </Pie>
                  <RechartsTooltip formatter={(value) => formatUSD(Number(value) || 0)} />
                  <Legend />
                </PieChart>
              </ResponsiveContainer>
            </div>
          </div>

          <div className="bg-card p-4 rounded-lg border">
            <h4 className="font-semibold mb-2">Drift Analysis (Assets)</h4>
            <div className="flex items-center">
              <ResponsiveContainer width="100%" height={getChartHeight(bars.length, 420)}>
                {barMode === 'divergent' ? (
                  <BarChart data={bars} layout="vertical" margin={{ left: 30 }}>
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis type="number" unit="%" />
                    <YAxis type="category" dataKey="name" interval={0} />
                    <RechartsTooltip formatter={(val: any) => `${Number(val).toFixed(2)}%`} />
                    <Bar dataKey="relativeDriftPct" fill="#8884d8">
                      {bars.map((entry: any, idx: number) => (
                        <Cell key={`cell-${idx}`} fill={getDriftColor(entry.relativeDriftPct / 100)} />
                      ))}
                    </Bar>
                  </BarChart>
                ) : (
                  <BarChart data={bars} layout="vertical" margin={{ left: 30 }}>
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis type="number" />
                    <YAxis type="category" dataKey="name" interval={0} />
                    <RechartsTooltip content={StackedTooltip} />
                    <StackedLegend />
                    <Bar dataKey="targetPct" name="Target %" fill="#3b82f6" stackId="a" />
                    <Bar dataKey="currentPct" name="Current %" fill="#10b981" stackId="a" />
                  </BarChart>
                )}
              </ResponsiveContainer>
            </div>
            <DriftLegend />
          </div>

          {debugMode && (
            <div className="mt-2 p-2 bg-yellow-50 text-xs text-gray-700">
              <div>Debug: grouped={grouped.length}, pieCurrent={pieCurrent.length}, pieTarget={pieTarget.length}</div>
            </div>
          )}
        </div>
      )
    }

    return (
      <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-6">
        {grouped.map((g: any, gi: number) => {
          const assets = g.items
          const pieCurr = assets.map((a: any) => ({ name: a.ticker, value: a.current_value }))
          const pieTarg = assets.map((a: any) => ({ name: a.ticker, value: (a.implied_overall_target || 0) * (data!.totalValue || 0) / 100 }))
          const bars = assets.map((a: any) => {
            const currentPct = g.currentValue > 0 ? (a.current_value / g.currentValue) * 100 : 0
            const targetPct = g.targetPctSum > 0 ? ((a.implied_overall_target || 0) / g.targetPctSum) * 100 : 0
            const basePct = Math.min(currentPct, targetPct)
            const deltaPct = Math.abs(currentPct - targetPct)
            const deltaColor = currentPct > targetPct ? '#10b981' : '#ef4444'
            const relativeDriftPct = g.targetPctSum > 0 ? (((a.current_value / g.currentValue) * 100) - (((a.implied_overall_target || 0) / g.targetPctSum) * 100)) : 0
            return { name: a.ticker, currentPct, targetPct, basePct, deltaPct, deltaColor, relativeDriftPct }
          })

          // sort asset-level charts so largest slices/bars appear first
          const pieCurrSorted = pieCurr.slice().sort((x: any, y: any) => (y.value || 0) - (x.value || 0))
          const pieTargSorted = pieTarg.slice().sort((x: any, y: any) => (y.value || 0) - (x.value || 0))
          const barsSorted = bars.slice().sort((a: any, b: any) => Math.max(b.currentPct || 0, b.targetPct || 0) - Math.max(a.currentPct || 0, a.targetPct || 0))

          return (
            <div key={g.key} className="bg-card p-4 rounded-lg border min-w-0" style={{ minWidth: 260 }}>
              <h4 className="font-semibold mb-2">{g.label}</h4>
              <div className="mb-3 flex-1 flex items-center">
                <ResponsiveContainer width="100%" height={getChartHeight(assets.length, 160)}>
                  {barMode === 'divergent' ? (
                      <BarChart data={barsSorted} layout="vertical">
                      <CartesianGrid strokeDasharray="3 3" />
                      <XAxis type="number" />
                      <YAxis type="category" dataKey="name" interval={0} />
                      <RechartsTooltip formatter={(v: any) => `${Number(v).toFixed(2)}%`} />
                      <Bar dataKey="relativeDriftPct">
                          {barsSorted.map((b: any, i: number) => <Cell key={i} fill={getDriftColor(b.relativeDriftPct/100)} />)}
                      </Bar>
                    </BarChart>
                  ) : (
                      <BarChart data={barsSorted} layout="vertical">
                      <CartesianGrid strokeDasharray="3 3" />
                      <XAxis type="number" />
                      <YAxis type="category" dataKey="name" interval={0} />
                      <RechartsTooltip content={StackedTooltip} />
                      <Bar dataKey="targetPct" name="Target %" fill="#3b82f6" stackId="a" />
                      <Bar dataKey="currentPct" name="Current %" fill="#10b981" stackId="a" />
                    </BarChart>
                  )}
                </ResponsiveContainer>
              </div>
              <DriftLegend />

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div className="p-2">
                  <div className="text-sm font-medium mb-1">Current</div>
                  <ResponsiveContainer width="100%" height={160}>
                    <PieChart>
                      <Pie data={pieCurrSorted} dataKey="value" nameKey="name" cx="50%" cy="50%" outerRadius={60} label={false}>
                        {pieCurrSorted.map((_: any, i: number) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}
                      </Pie>
                      <RechartsTooltip formatter={(v:any) => formatUSD(Number(v) || 0)} />
                    </PieChart>
                  </ResponsiveContainer>
                </div>

                <div className="p-2">
                  <div className="text-sm font-medium mb-1">Target</div>
                  <ResponsiveContainer width="100%" height={160}>
                    <PieChart>
                      <Pie data={pieTargSorted} dataKey="value" nameKey="name" cx="50%" cy="50%" outerRadius={60} label={false}>
                        {pieTargSorted.map((_: any, i: number) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}
                      </Pie>
                      <RechartsTooltip formatter={(v:any) => formatUSD(Number(v) || 0)} />
                    </PieChart>
                  </ResponsiveContainer>
                </div>
              </div>
            </div>
          )
        })}
        {debugMode && (
          <div className="mt-2 p-2 bg-yellow-50 text-xs text-gray-700">
            <div>Debug: grouped={grouped.length}</div>
          </div>
        )}
      </div>
    )
  }

  return (
    <TooltipProvider>
      <div className="space-y-8">
      {/* Summary Cards */}
      <div className="grid grid-cols-1 md:grid-cols-5 gap-4">
        <div className="bg-card p-4 rounded-lg border">
          <h3 className="font-semibold text-sm text-muted-foreground text-center">Total Portfolio Value</h3>
          <p className="text-2xl font-bold text-center">{formatUSD(data.totalValue)}</p>
        </div>

        <div className="bg-card p-4 rounded-lg border">
          <h3 className="font-semibold text-sm text-muted-foreground text-center">Portfolio Drift</h3>
          <div className="grid grid-cols-2 gap-4 mt-2">
            <div className="text-center">
              <p className="text-xs text-muted-foreground">Sub-Portfolio Drift</p>
              <p className="text-lg font-bold">{(subPortfolioDrift * 100).toFixed(2)}%</p>
            </div>
            <div className="text-center">
              <p className="text-xs text-muted-foreground">Asset Drift</p>
              <p className="text-lg font-bold">{assetDrift.toFixed(2)}%</p>
            </div>
          </div>
        </div>

        <div className="bg-card p-4 rounded-lg border">
          <h3 className="font-semibold text-sm text-muted-foreground text-center">Rebalance Alert</h3>
          <p className="text-2xl font-bold flex items-center justify-center">
            {data.currentAllocations.some(item => item.action !== 'hold') ? (
              <><AlertTriangle className="h-6 w-6 text-yellow-500 mr-2" /> Needed</>
            ) : (
              'No Action Required'
            )}
          </p>
        </div>

        <div className="bg-card p-4 rounded-lg border">
          <h3 className="font-semibold text-sm text-muted-foreground text-center">Magnitude of Rebalance Actions (Net)</h3>
          <p className={cn("text-2xl font-bold text-center", magnitudeOfRebalance > 0 ? "text-red-600" : "text-green-600")}>
            {formatUSD(Math.abs(magnitudeOfRebalance))}
          </p>
        </div>

        <div className="bg-card p-4 rounded-lg border">
          <h3 className="font-semibold text-sm text-muted-foreground text-center">Last Price Update</h3>
          <p className="text-sm text-center">{data.lastPriceUpdate ? new Date(data.lastPriceUpdate).toLocaleString() : 'Never'}</p>
        </div>
      </div>

      {/* Controls moved into VisualController to avoid duplication */}

      {refreshMessage && (
        <div className="p-4 bg-muted rounded-lg">
          <p className="text-sm">{refreshMessage}</p>
        </div>
      )}
      

      {/* Visualizations: controller + charts */}
      <RebalanceProvider>
        <VisualController barMode={barMode} setBarMode={setBarMode} />
        <ChartGrid barMode={barMode} />
      </RebalanceProvider>


      
      {/* Accordion Table */}
      <Accordion type="multiple" value={openItems} onValueChange={setOpenItems}>
        {Array.from(groupedAllocations.entries()).sort(([aId, aAllocations], [bId, bAllocations]) => {
          const aValue = aAllocations.reduce((sum, item) => sum + item.current_value, 0)
          const bValue = bAllocations.reduce((sum, item) => sum + item.current_value, 0)
          return bValue - aValue // descending order
        }).map(([subPortfolioId, allocations]) => {
          const subPortfolio = data.subPortfolios.find(sp => sp.id === subPortfolioId)
          const subPortfolioName = subPortfolio?.name || 'Unassigned'
          const subPortfolioTarget = subPortfolio?.target_allocation || 0
          const currentSubValue = allocations.reduce((sum, item) => sum + item.current_value, 0)
          const currentSubPercentage = data.totalValue > 0 ? (currentSubValue / data.totalValue) * 100 : 0
          const hasBreached = allocations.some(a => a.action !== 'hold')

          const assetLevelDrift = currentSubValue > 0 ? allocations.reduce((sum, item) => sum + (Math.abs(item.drift_percentage) * item.current_value), 0) / currentSubValue : 0

          return (
            <AccordionItem key={subPortfolioId} value={subPortfolioId}>
              <AccordionTrigger className="bg-black text-white font-semibold px-4 py-2 hover:bg-gray-800 [&>svg]:text-white [&>svg]:stroke-2 [&>svg]:w-5 [&>svg]:h-5">
                <div className="flex flex-col sm:flex-row sm:justify-between sm:items-center w-full mr-4 gap-2 sm:gap-0">
                  <div className="flex items-center gap-2">
                    <span className="font-semibold">{subPortfolioName}</span>
                    {hasBreached && <AlertTriangle className="h-4 w-4 text-yellow-400" />}
                  </div>
                  <div className="flex flex-wrap gap-2 sm:gap-4 text-sm items-center sm:flex-nowrap sm:overflow-x-auto">
                    <span className="text-white font-medium whitespace-nowrap">{formatUSD(currentSubValue)}</span>
                    <span className="text-white hidden sm:inline">|</span>
                    <span className="whitespace-nowrap">Current: {currentSubPercentage.toFixed(2)}%</span>
                    <span className="text-white hidden sm:inline">|</span>
                    <span className="whitespace-nowrap">Target: {subPortfolioTarget.toFixed(2)}%</span>
                    <span className="text-white hidden sm:inline">|</span>
                    <span className={cn(
                      "whitespace-nowrap",
                      subPortfolioTarget > 0 ? ((currentSubPercentage - subPortfolioTarget) / subPortfolioTarget) * 100 > 0 ? "text-green-400" :
                      ((currentSubPercentage - subPortfolioTarget) / subPortfolioTarget) * 100 < 0 ? "text-red-400" : "text-green-400" : "text-green-400"
                    )}>
                      Sub-Portfolio Drift: {subPortfolioTarget > 0 ? (((currentSubPercentage - subPortfolioTarget) / subPortfolioTarget) * 100).toFixed(2) : '0.00'}%
                    </span>
                    <span className="text-white hidden sm:inline">|</span>
                    <span className="text-white whitespace-nowrap">
                      Asset-Level Drift: {assetLevelDrift.toFixed(2)}%
                    </span>
                  </div>
                </div>
              </AccordionTrigger>
              <AccordionContent>
                <div className="px-4 pb-4">
                  {/* Sub-Portfolio Header with Editable Target */}
                  <div className="mb-4 p-4 bg-gray-100 rounded-lg">
                    <div className="grid grid-cols-1 md:grid-cols-4 gap-4 items-end">
                      <div>
                        <Label>Target % (sum to 100%)</Label>
                        <div>
                          <Input
                            type="number"
                            step="0.1"
                            value={draftSubTargets[subPortfolioId] ?? subPortfolioTarget}
                            onChange={(e) => {
                              const newVal = parseFloat(e.target.value) || 0
                              setDraftSubTargets(prev => ({ ...prev, [subPortfolioId]: newVal }))
                            }}
                            onBlur={(e) => {
                              const newValue = parseFloat((e.target as HTMLInputElement).value) || 0
                              if (newValue !== subPortfolioTarget) {
                                updateSubPortfolioTarget(subPortfolioId, newValue)
                              }
                            }}
                            className={cn(
                              "w-24",
                              validationErrors.subPortfolios[subPortfolioId] && "border-red-500 focus:border-red-500"
                            )}
                          />
                          <div className="mt-1 text-xs">
                            {savingSubTargets[subPortfolioId] && <span className="text-blue-600">Saving...</span>}
                            {errorSubTargets[subPortfolioId] && <span className="text-red-600">{errorSubTargets[subPortfolioId]}</span>}
                          </div>
                        </div>
                      </div>
                      {subPortfolio && (
                        <>
                          <div>
                            <Label>Upside Threshold</Label>
                            <Input
                              type="number"
                              step="1"
                              defaultValue={subPortfolio.upside_threshold}
                              onBlur={(e) => {
                                const newValue = parseFloat(e.target.value) || 25
                                if (newValue !== subPortfolio.upside_threshold) {
                                  updateThresholds(subPortfolioId, newValue, subPortfolio.downside_threshold, subPortfolio.band_mode)
                                }
                              }}
                              className="w-20"
                            />
                          </div>
                          <div>
                            <Label>Downside Threshold</Label>
                            <Input
                              type="number"
                              step="1"
                              defaultValue={subPortfolio.downside_threshold}
                              onBlur={(e) => {
                                const newValue = parseFloat(e.target.value) || 25
                                if (newValue !== subPortfolio.downside_threshold) {
                                  updateThresholds(subPortfolioId, subPortfolio.upside_threshold, newValue, subPortfolio.band_mode)
                                }
                              }}
                              className="w-20"
                            />
                          </div>
                          <div className="flex items-center gap-2">
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <div className="flex items-center gap-2 cursor-help">
                                  <Switch
                                    checked={subPortfolio.band_mode}
                                    onCheckedChange={(checked) => updateThresholds(subPortfolioId, subPortfolio.upside_threshold, subPortfolio.downside_threshold, checked)}
                                  />
                                  <Label>{subPortfolio.band_mode ? 'Conservative Rebalance' : 'Absolute Rebalance'}</Label>
                                </div>
                              </TooltipTrigger>
                              <TooltipContent>
                                <p className="max-w-xs">
                                  <strong>Conservative Mode:</strong> Smaller transactions that bring assets back to acceptable ranges<br/><br/>
                                  <strong>Absolute Mode:</strong> Larger transactions that bring assets exactly to target allocations<br/><br/>
                                  <strong>Risk of overcorrection:</strong> Getting exactly to target might overshoot if market conditions change between the calculation and execution
                                </p>
                              </TooltipContent>
                            </Tooltip>
                          </div>
                        </>
                      )}
                    </div>
                  </div>

                  {/* Assets Table */}
                  <div className="w-full overflow-x-auto">
                    <Table containerClassName="pb-10 min-w-full">
                      <TableHeader>
                        <TableRow>
                          <TableHead className="text-center min-w-0 break-words whitespace-nowrap">Asset</TableHead>
                          <SortableTableHead column="current_value" className="text-center min-w-0 break-words whitespace-nowrap">Current Value</SortableTableHead>
                          <SortableTableHead column="current_percentage" className="text-center min-w-0 break-words whitespace-nowrap">Current % (Sub)</SortableTableHead>
                          <SortableTableHead column="sub_portfolio_target_percentage" className="text-center min-w-0 break-words whitespace-nowrap">Target % (Sub)</SortableTableHead>
                          <SortableTableHead column="implied_overall_target" className="text-center min-w-0 break-words whitespace-nowrap">Implied Overall Target %</SortableTableHead>
                          <SortableTableHead column="drift_percentage" className="text-center min-w-0 break-words whitespace-nowrap">Drift %</SortableTableHead>
                          <TableHead className="text-center min-w-0 break-words whitespace-nowrap">Action</TableHead>
                          <SortableTableHead column="amount" className="text-center min-w-0 break-words whitespace-nowrap">Recommended Transaction Amount</SortableTableHead>
                          <SortableTableHead column="tax_impact" className="text-center min-w-0 break-words whitespace-nowrap">Tax Impact</SortableTableHead>
                          <TableHead className="text-center min-w-0 break-words whitespace-nowrap">Recommended Accounts</TableHead>
                          <TableHead className="text-center min-w-0 break-words whitespace-nowrap">Tax Notes</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {(() => {
                          const sortedAllocations = sortAllocations(allocations)
                          
                          /* Total Row */
                          const totals = calculateTotals(sortedAllocations)
                          return (
                            <>
                              {sortedAllocations.map((item) => (
                                <TableRow key={item.asset_id}>
                                  <TableCell className="text-center min-w-0 break-words">
                                    <div>
                                      <div className="font-bold">{item.ticker}</div>
                                      <div className="text-sm text-muted-foreground">{item.name}</div>
                                    </div>
                                  </TableCell>
                                  <TableCell className="text-center min-w-0 break-words">{formatUSD(item.current_value)}</TableCell>
                                  <TableCell className="text-center min-w-0 break-words">{item.sub_portfolio_percentage.toFixed(2)}%</TableCell>
                                  <TableCell className="text-center">
                                    <Tooltip>
                                      <TooltipTrigger asChild>
                                                    <Input
                                                      type="number"
                                                      step="0.1"
                                                      value={
                                                        (draftAssetTargets[subPortfolioId] && draftAssetTargets[subPortfolioId][item.asset_id]) ?? item.sub_portfolio_target_percentage ?? item.sub_portfolio_percentage
                                                      }
                                                      onChange={(e) => {
                                                        const newVal = parseFloat(e.target.value) || 0
                                                        setDraftAssetTargets(prev => ({
                                                          ...prev,
                                                          [subPortfolioId]: {
                                                            ...(prev[subPortfolioId] || {}),
                                                            [item.asset_id]: newVal
                                                          }
                                                        }))
                                                      }}
                                                      onBlur={(e) => {
                                                        const newValue = parseFloat((e.target as HTMLInputElement).value) || 0
                                                        if (newValue !== (item.sub_portfolio_target_percentage || item.sub_portfolio_percentage)) {
                                                          updateAssetTarget(item.asset_id, subPortfolioId, newValue)
                                                        }
                                                      }}
                                                      className={cn(
                                                        "w-20 ml-auto",
                                                        validationErrors.assets[subPortfolioId]?.[item.asset_id] && "border-red-500 focus:border-red-500"
                                                      )}
                                                    />
                                      </TooltipTrigger>
                                      {validationErrors.assets[subPortfolioId]?.[item.asset_id] && (
                                        <TooltipContent>
                                          <p className="text-red-600 font-medium">{validationErrors.assets[subPortfolioId][item.asset_id]}</p>
                                        </TooltipContent>
                                      )}
                                    </Tooltip>
                                    <div className="mt-1 text-xs">
                                      {savingAssetTargets[subPortfolioId]?.[item.asset_id] && <span className="text-blue-600">Saving...</span>}
                                      {errorAssetTargets[subPortfolioId]?.[item.asset_id] && <span className="text-red-600">{errorAssetTargets[subPortfolioId][item.asset_id]}</span>}
                                    </div>
                                  </TableCell>
                                  <TableCell className="text-center min-w-0 break-words">{item.implied_overall_target.toFixed(2)}%</TableCell>
                                  <TableCell className={cn(
                                    "text-center font-medium min-w-0 break-words",
                                    item.drift_percentage > 0 ? "text-green-600" : item.drift_percentage < 0 ? "text-red-600" : "text-green-600"
                                  )}>
                                    {item.drift_percentage > 0 ? '+' : ''}{item.drift_percentage.toFixed(2)}%
                                  </TableCell>
                                  <TableCell className={cn(
                                    "text-center font-bold min-w-0 break-words",
                                    item.action === 'buy' ? "text-green-600" :
                                    item.action === 'sell' ? "text-red-600" : "text-black"
                                  )}>
                                    {item.action.toUpperCase()}
                                  </TableCell>
                                  <TableCell className="text-center min-w-0 break-words">
                                    {item.action === 'sell' ? '-' : ''}{formatUSD(item.amount)}
                                  </TableCell>
                                  <TableCell className="text-center min-w-0 break-words">
                                    <Tooltip>
                                      <TooltipTrigger asChild>
                                        <span className={cn(
                                          item.tax_impact > 0 ? "text-green-600 font-medium" :
                                          item.tax_impact < 0 ? "text-red-600 font-medium" :
                                          "text-black"
                                        )}>
                                          {formatUSD(item.tax_impact)}
                                        </span>
                                      </TooltipTrigger>
                                      <TooltipContent>
                                        <p className="text-sm">Estimated tax impact for this asset.</p>
                                      </TooltipContent>
                                    </Tooltip>
                                  </TableCell>
                                  <TableCell className="text-center min-w-0 break-words">
                                    <RecommendedAccountsPopover accounts={item.recommended_accounts} />
                                  </TableCell>
                                  <TableCell className="text-center min-w-0 break-words">
                                    <div className="text-sm text-muted-foreground">{item.tax_notes}</div>
                                    {item.action === 'sell' && (!item.recommended_accounts || item.recommended_accounts.length === 0) && (
                                      <div className="text-xs text-muted-foreground mt-1">No account/lot-level data available to compute per-account tax — ensure your tax lots are linked to accounts.</div>
                                    )}
                                  </TableCell>
                                </TableRow>
                              ))}

                              {/* Total Row */}
                              <TableRow className="bg-gray-100 font-semibold">
                                <TableCell className="text-center font-bold min-w-0 break-words">TOTAL</TableCell>
                                <TableCell className="text-center font-bold min-w-0 break-words">{formatUSD(totals.current_value)}</TableCell>
                                <TableCell className="text-center font-bold min-w-0 break-words">{totals.current_percentage.toFixed(2)}%</TableCell>
                                <TableCell className="text-center font-bold min-w-0 break-words">{totals.target_percentage.toFixed(2)}%</TableCell>
                                <TableCell className="text-center font-bold min-w-0 break-words">{totals.implied_overall_target.toFixed(2)}%</TableCell>
                                <TableCell className="text-center font-bold min-w-0 break-words">{totals.drift_percentage.toFixed(2)}%</TableCell>
                                <TableCell className="text-center font-bold min-w-0 break-words">-</TableCell>
                                <TableCell className="text-center font-bold min-w-0 break-words">-</TableCell>
                                <TableCell className="text-center font-bold min-w-0 break-words">
                                  <Tooltip>
                                    <TooltipTrigger asChild>
                                      <span className={cn(
                                        totals.tax_impact > 0 ? "text-green-600 font-medium" :
                                        totals.tax_impact < 0 ? "text-red-600 font-medium" :
                                        "text-black"
                                      )}>
                                        {formatUSD(totals.tax_impact)}
                                      </span>
                                    </TooltipTrigger>
                                    <TooltipContent>
                                      <p className="text-sm">Sum of estimated tax impacts across assets in this sub-portfolio.</p>
                                    </TooltipContent>
                                  </Tooltip>
                                </TableCell>
                                <TableCell className="text-center font-bold min-w-0 break-words">-</TableCell>
                                <TableCell className="text-center font-bold min-w-0 break-words">-</TableCell>
                              </TableRow>
                            </>
                          )
                        })()}
                      </TableBody>
                    </Table>
                  </div>

                  {/* Tactical Execution Suggestions: shown when any asset action != 'hold' */}
                  {allocations.some(item => item.action !== 'hold') && (
                    <div className="mt-6 p-4 bg-blue-50 rounded-lg border border-blue-200">
                      <h4 className="font-semibold text-blue-900 mb-3">Tactical Execution Suggestions</h4>
                      <p className="text-sm text-blue-700 mb-4">Execution guidance for the recommended rebalance actions in this sub-portfolio.</p>

                      {/* Consolidated tactical suggestions */}
                      {(() => {
                        const allSuggestions = allocations.flatMap(item => item.reinvestment_suggestions || [])
                        if (allSuggestions.length === 0) return null
                        return (
                          <div className="space-y-3">
                            {allSuggestions.slice(0, 15).map((suggestion, idx) => (
                              <div key={`tactical-${idx}`} className="flex items-center justify-between p-3 bg-white rounded border">
                                <div className="flex items-center gap-3">
                                  <div className="font-medium">{suggestion.ticker}</div>
                                  <div className="text-sm text-muted-foreground">{suggestion.name}</div>
                                  <div className="text-xs px-2 py-1 bg-blue-100 text-blue-800 rounded">{suggestion.reason}</div>
                                </div>
                                <div className="text-right">
                                  <div className="font-medium">{formatUSD(suggestion.suggested_amount)}</div>
                                  <div className="text-sm text-muted-foreground">~{(suggestion.suggested_shares || 0).toFixed(2)} shares</div>
                                </div>
                              </div>
                            ))}
                          </div>
                        )
                      })()}

                      {/* If there are actions but no specific tactical suggestions, show a hint */}
                      {!allocations.some(item => (item.reinvestment_suggestions || []).length > 0) && (
                        <div className="p-3 bg-white rounded border text-sm text-muted-foreground">No tactical execution suggestions available — ensure tax lots and targets are up to date.</div>
                      )}
                    </div>
                  )}
                </div>
              </AccordionContent>
            </AccordionItem>
          )
        })}
      </Accordion>
    </div>
    </TooltipProvider>
  )
}