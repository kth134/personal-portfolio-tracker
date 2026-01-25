'use client'

import { useState, useEffect } from 'react'
import {
  PieChart, Pie, Cell, ResponsiveContainer, Tooltip as RechartsTooltip, Legend,
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
  { value: 'total', label: 'Total Portfolio' },
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

type AllocationSlice = {
  key: string
  value: number
  data: { subkey: string; value: number; percentage: number }[]
}

export default function RebalancingPage() {
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

  // Validation state
  const [validationErrors, setValidationErrors] = useState<{
    subPortfolios: {[key: string]: string};
    assets: {[key: string]: {[key: string]: string}};
  }>({ subPortfolios: {}, assets: {} })

  // Sorting state
  const [sortColumn, setSortColumn] = useState<string>('current_value')
  const [sortDirection, setSortDirection] = useState<'asc' | 'desc'>('desc')

  // Accordion state
  const [openItems, setOpenItems] = useState<string[]>([])

  // Editing state
  const [editingSubPortfolio, setEditingSubPortfolio] = useState<string | null>(null)

  useEffect(() => {
    fetchData()
  }, [refreshTrigger])

  useEffect(() => {
    // Set open items to all sub-portfolio IDs when data changes
    if (data?.subPortfolios) {
      setOpenItems(data.subPortfolios.map(sp => sp.id))
    }
  }, [data])

  useEffect(() => {
    if (lens === 'total') {
      setAvailableValues([])
      setSelectedValues([])
      return
    }

    const fetchValues = async () => {
      setValuesLoading(true)
      const res = await fetch('/api/dashboard/values', {
        method: 'POST',
        body: JSON.stringify({ lens }),
      })
      if (!res.ok) throw new Error('Failed to fetch values')
      const data = await res.json()
      const vals = data.values || []
      setAvailableValues(vals)
      setSelectedValues(vals.map((item: any) => item.value))
      setValuesLoading(false)
    }
    fetchValues()
  }, [lens])

  const fetchData = async () => {
    setLoading(true)
    try {
      const res = await fetch('/api/rebalancing')
      if (!res.ok) throw new Error('Failed to fetch rebalancing data')
      const rebalancingData = await res.json()
      setData(rebalancingData)
      validateAllocations(rebalancingData)
    } catch (error) {
      console.error('Error fetching rebalancing data:', error)
    } finally {
      setLoading(false)
    }
  }

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
        await recalculateTaxData(affectedAllocations)
      }
    } catch (error) {
      console.error('Error updating sub-portfolio target:', error)
    }
  }

  const updateAssetTarget = async (assetId: string, subPortfolioId: string, target: number) => {
    try {
      const res = await fetch('/api/rebalancing/asset-target', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ asset_id: assetId, sub_portfolio_id: subPortfolioId, target_percentage: target })
      })
      if (!res.ok) throw new Error('Failed to update target')

      // Update local state instead of triggering full refresh
      setData(prevData => {
        if (!prevData) return prevData

        // Update asset targets
        const updatedAssetTargets = prevData.assetTargets.some(at =>
          at.asset_id === assetId && at.sub_portfolio_id === subPortfolioId
        )
          ? prevData.assetTargets.map(at =>
              at.asset_id === assetId && at.sub_portfolio_id === subPortfolioId
                ? { ...at, target_percentage: target }
                : at
            )
          : [...prevData.assetTargets, { asset_id: assetId, sub_portfolio_id: subPortfolioId, target_percentage: target }]

        // Recalculate drift for affected assets
        const updatedAllocations = prevData.currentAllocations.map(allocation => {
          if (allocation.asset_id === assetId && allocation.sub_portfolio_id === subPortfolioId) {
            // Recalculate drift using the same logic as the API
            const assetTarget = target
            const driftPercentage = assetTarget > 0 ? ((allocation.sub_portfolio_percentage - assetTarget) / assetTarget) * 100 : 0
            const driftDollar = (driftPercentage / 100) * prevData.totalValue

            // Recalculate action and amount
            const subPortfolio = prevData.subPortfolios.find(sp => sp.id === subPortfolioId)
            let action: 'buy' | 'sell' | 'hold' = 'hold'
            let amount = 0

            if (subPortfolio) {
              const upsideThreshold = subPortfolio.upside_threshold
              const downsideThreshold = subPortfolio.downside_threshold
              const bandMode = subPortfolio.band_mode

              const relativeUpsideThreshold = assetTarget > 0 ? (upsideThreshold / assetTarget) * 100 : upsideThreshold
              const relativeDownsideThreshold = assetTarget > 0 ? (downsideThreshold / assetTarget) * 100 : downsideThreshold

              if (Math.abs(driftPercentage) > relativeDownsideThreshold || Math.abs(driftPercentage) > relativeUpsideThreshold) {
                if (driftPercentage > 0) {
                  action = 'sell'
                  amount = bandMode
                    ? (driftPercentage - relativeUpsideThreshold) / 100 * prevData.totalValue
                    : driftDollar
                } else {
                  action = 'buy'
                  amount = bandMode
                    ? (relativeDownsideThreshold + driftPercentage) / 100 * prevData.totalValue
                    : Math.abs(driftDollar)
                }
              }
            }

            // Recalculate implied overall target
            const subPortfolioTarget = subPortfolio?.target_allocation || 0
            const impliedOverallTarget = (subPortfolioTarget * assetTarget) / 100

            return {
              ...allocation,
              sub_portfolio_target_percentage: target,
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
      
      // Recalculate tax data for the updated allocation
      const updatedAllocation = data?.currentAllocations.find(a => a.asset_id === assetId && a.sub_portfolio_id === subPortfolioId)
      if (updatedAllocation) {
        await recalculateTaxData([updatedAllocation])
      }
    } catch (error) {
      console.error('Error updating asset target:', error)
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
              if (Math.abs(driftPercentage) > relativeDownsideThreshold || Math.abs(driftPercentage) > relativeUpsideThreshold) {
                if (driftPercentage > 0) {
                  action = 'sell'
                  amount = bandMode
                    ? (driftPercentage - relativeUpsideThreshold) / 100 * prevData.totalValue
                    : driftDollar
                } else {
                  action = 'buy'
                  amount = bandMode
                    ? (relativeDownsideThreshold + driftPercentage) / 100 * prevData.totalValue
                    : Math.abs(driftDollar)
                }
              }
            } else if (bandModeChanged) {
              // Only band mode changed: preserve action, recompute amount according to new bandMode
              if (allocation.action === 'sell') {
                amount = bandMode ? (driftPercentage - relativeUpsideThreshold) / 100 * prevData.totalValue : driftDollar
              } else if (allocation.action === 'buy') {
                amount = bandMode ? (relativeDownsideThreshold + driftPercentage) / 100 * prevData.totalValue : Math.abs(driftDollar)
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

  const totalPortfolioDrift = data.totalValue > 0 
    ? data.currentAllocations.reduce((sum, item) => {
        const weight = item.current_value / data.totalValue
        return sum + (Math.abs(item.drift_percentage) * weight)
      }, 0)
    : 0

  return (
    <TooltipProvider>
      <div className="space-y-8">
        <div className="text-center text-red-600 font-semibold text-lg bg-red-50 p-4 rounded-md border border-red-200">
          Under Construction
        </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-1 md:grid-cols-5 gap-4">
        <div className="bg-card p-4 rounded-lg border">
          <h3 className="font-semibold text-sm text-muted-foreground">Total Portfolio Value</h3>
          <p className="text-2xl font-bold">{formatUSD(data.totalValue)}</p>
        </div>
        <div className="bg-card p-4 rounded-lg border">
          <h3 className="font-semibold text-sm text-muted-foreground">Cash Needed/Generated</h3>
          <p className={cn("text-2xl font-bold", data.cashNeeded > 0 ? "text-red-600" : "text-green-600")}>
            {formatUSD(Math.abs(data.cashNeeded))}
          </p>
        </div>
        <div className="bg-card p-4 rounded-lg border">
          <h3 className="font-semibold text-sm text-muted-foreground">Total Portfolio Drift</h3>
          <p className="text-2xl font-bold">
            {totalPortfolioDrift.toFixed(2)}%
          </p>
        </div>
        <div className="bg-card p-4 rounded-lg border">
          <h3 className="font-semibold text-sm text-muted-foreground">Rebalance Alert</h3>
          <p className="text-2xl font-bold flex items-center">
            {data.currentAllocations.some(item => item.action !== 'hold') ? (
              <><AlertTriangle className="h-6 w-6 text-yellow-500 mr-2" /> Needed</>
            ) : (
              'No Action Required'
            )}
          </p>
        </div>
        <div className="bg-card p-4 rounded-lg border">
          <h3 className="font-semibold text-sm text-muted-foreground">Last Price Update</h3>
          <p className="text-sm">{data.lastPriceUpdate ? new Date(data.lastPriceUpdate).toLocaleString() : 'Never'}</p>
        </div>
      </div>

      {/* Controls */}
      <div className="flex flex-wrap gap-4 items-end">
        <div>
          <Label className="text-sm font-medium">View Lens</Label>
          <Select value={lens} onValueChange={setLens}>
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

        <div className="flex items-center gap-2">
          <Switch
            checked={aggregate}
            onCheckedChange={setAggregate}
          />
          <Label className="text-sm font-medium">Aggregate</Label>
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
                    <CommandEmpty>No items found.</CommandEmpty>
                    <CommandGroup>
                      {availableValues.map((item) => (
                        <CommandItem
                          key={item.value}
                          onSelect={() => {
                            if (selectedValues.includes(item.value)) {
                              setSelectedValues(selectedValues.filter(v => v !== item.value))
                            } else {
                              setSelectedValues([...selectedValues, item.value])
                            }
                          }}
                        >
                          <Checkbox
                            checked={selectedValues.includes(item.value)}
                            className="mr-2"
                          />
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

        <div className="flex gap-2">
          <Button onClick={handleRefreshPrices} disabled={refreshing} variant="outline">
            <RefreshCw className={cn("h-4 w-4 mr-2", refreshing && "animate-spin")} />
            Refresh Prices
          </Button>
          <Button onClick={handleExport} variant="outline">
            <Download className="h-4 w-4 mr-2" />
            Export CSV
          </Button>
        </div>
      </div>

      {refreshMessage && (
        <div className="p-4 bg-muted rounded-lg">
          <p className="text-sm">{refreshMessage}</p>
        </div>
      )}

      {/* Visualizations */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
        <div>
          <h3 className="text-lg font-semibold mb-4">Current Allocations</h3>
          <ResponsiveContainer width="100%" height={300}>
            <PieChart>
              <Pie
                data={pieData}
                cx="50%"
                cy="50%"
                labelLine={false}
                label={({ name, percent }) => `${name}: ${((percent || 0) * 100).toFixed(1)}%`}
                outerRadius={80}
                fill="#8884d8"
                dataKey="value"
              >
                {pieData.map((entry, index) => (
                  <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                ))}
              </Pie>
              <RechartsTooltip formatter={(value) => formatUSD(Number(value) || 0)} />
            </PieChart>
          </ResponsiveContainer>
        </div>

        <div>
          <h3 className="text-lg font-semibold mb-4">Target Allocations</h3>
          <ResponsiveContainer width="100%" height={300}>
            <PieChart>
              <Pie
                data={targetPieData}
                cx="50%"
                cy="50%"
                labelLine={false}
                label={({ name, percent }) => `${name}: ${((percent || 0) * 100).toFixed(1)}%`}
                outerRadius={80}
                fill="#8884d8"
                dataKey="value"
              >
                {targetPieData.map((entry, index) => (
                  <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                ))}
              </Pie>
              <RechartsTooltip formatter={(value) => `${Number(value || 0).toFixed(1)}%`} />
            </PieChart>
          </ResponsiveContainer>
        </div>
      </div>



      {/* Accordion Table */}
      <Accordion type="multiple" value={openItems} onValueChange={setOpenItems}>
        {Array.from(groupedAllocations.entries()).map(([subPortfolioId, allocations]) => {
          const subPortfolio = data.subPortfolios.find(sp => sp.id === subPortfolioId)
          const subPortfolioName = subPortfolio?.name || 'Unassigned'
          const subPortfolioTarget = subPortfolio?.target_allocation || 0
          const currentSubValue = allocations.reduce((sum, item) => sum + item.current_value, 0)
          const currentSubPercentage = data.totalValue > 0 ? (currentSubValue / data.totalValue) * 100 : 0

          return (
            <AccordionItem key={subPortfolioId} value={subPortfolioId}>
              <AccordionTrigger className="bg-black text-white font-semibold px-4 py-2 hover:bg-gray-800 [&>svg]:text-white [&>svg]:stroke-2 [&>svg]:w-5 [&>svg]:h-5">
                <div className="flex justify-between items-center w-full mr-4">
                  <span className="font-semibold">{subPortfolioName}</span>
                  <div className="flex gap-4 text-sm">
                    <span>Current: {currentSubPercentage.toFixed(2)}%</span>
                    <span>Target: {subPortfolioTarget.toFixed(2)}%</span>
                    <span className={cn(
                      subPortfolioTarget > 0 ? ((currentSubPercentage - subPortfolioTarget) / subPortfolioTarget) * 100 > 0 ? "text-green-600" :
                      ((currentSubPercentage - subPortfolioTarget) / subPortfolioTarget) * 100 < 0 ? "text-red-600" : "text-green-600" : "text-green-600"
                    )}>
                      Drift: {subPortfolioTarget > 0 ? (((currentSubPercentage - subPortfolioTarget) / subPortfolioTarget) * 100).toFixed(2) : '0.00'}%
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
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <Input
                              type="number"
                              step="0.1"
                              defaultValue={subPortfolioTarget}
                              onBlur={(e) => {
                                const newValue = parseFloat(e.target.value) || 0
                                if (newValue !== subPortfolioTarget) {
                                  updateSubPortfolioTarget(subPortfolioId, newValue)
                                }
                              }}
                              className={cn(
                                "w-24",
                                validationErrors.subPortfolios[subPortfolioId] && "border-red-500 focus:border-red-500"
                              )}
                            />
                          </TooltipTrigger>
                          {validationErrors.subPortfolios[subPortfolioId] && (
                            <TooltipContent>
                              <p className="text-red-600 font-medium">{validationErrors.subPortfolios[subPortfolioId]}</p>
                            </TooltipContent>
                          )}
                        </Tooltip>
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
                  <div className="w-full pb-6">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead className="min-w-0 break-words">Asset</TableHead>
                          <SortableTableHead column="current_value" className="text-right min-w-0 break-words">Current Value</SortableTableHead>
                          <SortableTableHead column="current_percentage" className="text-right min-w-0 break-words">Current % (Sub)</SortableTableHead>
                          <SortableTableHead column="sub_portfolio_target_percentage" className="text-right min-w-0 break-words">Target % (Sub)</SortableTableHead>
                          <SortableTableHead column="implied_overall_target" className="text-right min-w-0 break-words">Implied Overall Target %</SortableTableHead>
                          <SortableTableHead column="drift_percentage" className="text-right min-w-0 break-words">Drift %</SortableTableHead>
                          <TableHead className="min-w-0 break-words">Action</TableHead>
                          <SortableTableHead column="amount" className="text-right min-w-0 break-words">Recommended Transaction Amount</SortableTableHead>
                          <SortableTableHead column="tax_impact" className="text-right min-w-0 break-words">Tax Impact</SortableTableHead>
                          <TableHead className="min-w-0 break-words">Recommended Accounts</TableHead>
                          <TableHead className="min-w-0 break-words">Tax Notes</TableHead>
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
                                  <TableCell className="min-w-0 break-words">
                                    <div>
                                      <div className="font-bold">{item.ticker}</div>
                                      <div className="text-sm text-muted-foreground">{item.name}</div>
                                    </div>
                                  </TableCell>
                                  <TableCell className="text-right min-w-0 break-words">{formatUSD(item.current_value)}</TableCell>
                                  <TableCell className="text-right min-w-0 break-words">{item.sub_portfolio_percentage.toFixed(2)}%</TableCell>
                                  <TableCell className="text-right">
                                    <Tooltip>
                                      <TooltipTrigger asChild>
                                        <Input
                                          type="number"
                                          step="0.1"
                                          defaultValue={item.sub_portfolio_target_percentage || item.sub_portfolio_percentage}
                                          onBlur={(e) => {
                                            const newValue = parseFloat(e.target.value) || 0
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
                                  </TableCell>
                                  <TableCell className="text-right min-w-0 break-words">{item.implied_overall_target.toFixed(2)}%</TableCell>
                                  <TableCell className={cn(
                                    "text-right font-medium min-w-0 break-words",
                                    item.drift_percentage > 0 ? "text-green-600" : item.drift_percentage < 0 ? "text-red-600" : "text-green-600"
                                  )}>
                                    {item.drift_percentage > 0 ? '+' : ''}{item.drift_percentage.toFixed(2)}%
                                  </TableCell>
                                  <TableCell className={cn(
                                    "font-bold min-w-0 break-words",
                                    item.action === 'buy' ? "text-green-600" :
                                    item.action === 'sell' ? "text-red-600" : "text-black"
                                  )}>
                                    {item.action.toUpperCase()}
                                  </TableCell>
                                  <TableCell className="text-right min-w-0 break-words">
                                    {item.action === 'sell' ? '-' : ''}{formatUSD(item.amount)}
                                  </TableCell>
                                  <TableCell className="text-right min-w-0 break-words">
                                    {item.tax_impact > 0 ? (
                                      <span className="text-red-600 font-medium">
                                        -{formatUSD(item.tax_impact)}
                                      </span>
                                    ) : (
                                      <span className="text-green-600">{formatUSD(0)}</span>
                                    )}
                                  </TableCell>
                                  <TableCell className="text-sm min-w-0 break-words">
                                    {item.recommended_accounts.length > 0 ? (
                                      <div className="space-y-1">
                                        {item.recommended_accounts.slice(0, 2).map((acc: any, idx: number) => (
                                          <div key={idx} className="text-xs">
                                            <span className="font-medium">{acc.name}</span>
                                            <span className="text-muted-foreground"> ({acc.type})</span>
                                          </div>
                                        ))}
                                        {item.recommended_accounts.length > 2 && (
                                          <div className="text-xs text-muted-foreground">
                                            +{item.recommended_accounts.length - 2} more
                                          </div>
                                        )}
                                      </div>
                                    ) : (
                                      '-'
                                    )}
                                  </TableCell>
                                  <TableCell className="text-sm min-w-0 break-words">{item.tax_notes}</TableCell>
                                </TableRow>
                              ))}
                              
                              {/* Total Row */}
                              <TableRow className="bg-gray-100 font-semibold">
                                <TableCell className="font-bold min-w-0 break-words">TOTAL</TableCell>
                                <TableCell className="text-right font-bold min-w-0 break-words">{formatUSD(totals.current_value)}</TableCell>
                                <TableCell className="text-right font-bold min-w-0 break-words">{totals.current_percentage.toFixed(2)}%</TableCell>
                                <TableCell className="text-right font-bold min-w-0 break-words">{totals.target_percentage.toFixed(2)}%</TableCell>
                                <TableCell className="text-right font-bold min-w-0 break-words">{totals.implied_overall_target.toFixed(2)}%</TableCell>
                                <TableCell className="text-right font-bold min-w-0 break-words">{totals.drift_percentage.toFixed(2)}%</TableCell>
                                <TableCell className="text-center font-bold min-w-0 break-words">-</TableCell>
                                <TableCell className="text-center font-bold min-w-0 break-words">-</TableCell>
                                <TableCell className="text-right font-bold min-w-0 break-words">
                                  {totals.tax_impact > 0 ? `-${formatUSD(totals.tax_impact)}` : formatUSD(totals.tax_impact)}
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

                  {/* Reinvestment Suggestions for Sell Actions */}
                  {allocations.some(item => item.action === 'sell' && item.reinvestment_suggestions.length > 0) && (
                    <div className="mt-6 p-4 bg-blue-50 rounded-lg border border-blue-200">
                      <h4 className="font-semibold text-blue-900 mb-3">💡 Smart Reinvestment Suggestions</h4>
                      <p className="text-sm text-blue-700 mb-4">
                        Based on assets that are underweight in their targets, here's how to reinvest sale proceeds:
                      </p>
                      <div className="space-y-3">
                        {allocations
                          .filter(item => item.action === 'sell')
                          .flatMap(item => item.reinvestment_suggestions)
                          .slice(0, 5) // Show top 5 suggestions
                          .map((suggestion, idx2) => (
                            <div key={idx2} className="flex items-center justify-between p-3 bg-white rounded border">
                              <div className="flex items-center gap-3">
                                <div className="font-medium">{suggestion.ticker}</div>
                                <div className="text-sm text-muted-foreground">{suggestion.name}</div>
                                <div className="text-xs px-2 py-1 bg-blue-100 text-blue-800 rounded">
                                  {suggestion.reason}
                                </div>
                              </div>
                              <div className="text-right">
                                <div className="font-medium">{formatUSD(suggestion.suggested_amount)}</div>
                                <div className="text-sm text-muted-foreground">
                                  ~{suggestion.suggested_shares.toFixed(0)} shares
                                </div>
                              </div>
                            </div>
                          ))}
                      </div>
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