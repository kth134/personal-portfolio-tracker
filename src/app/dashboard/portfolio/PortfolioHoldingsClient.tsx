"use client"

import React, { useState } from 'react'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Accordion, AccordionItem, AccordionTrigger, AccordionContent } from '@/components/ui/accordion'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Label } from '@/components/ui/label'
import { Button } from '@/components/ui/button'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'
import { refreshAssetPrices } from './actions'
import { cn } from '@/lib/utils'
import { formatUSD } from '@/lib/formatters';

// Reuse types from page.tsx (or move to a shared types file)
type SortKey = 'ticker' | 'quantity' | 'avgBasis' | 'totalBasis' | 'currPrice' | 'currValue' | 'unrealGain'

type Holding = {
  asset_id: string
  ticker: string
  name: string | null
  total_quantity: number
  total_basis: number
  current_price?: number
  current_value?: number
  unrealized_gain: number
}

type GroupedHolding = {
  key: string // account name or sub_portfolio
  holdings: Holding[]
  total_basis: number
  total_value: number
  unrealized_gain: number
}

type PortfolioHoldingsClientProps = {
  groupedAccounts: GroupedHolding[]
  groupedSubs: GroupedHolding[]
  cash: number
  grandTotalBasis: number
  grandTotalValue: number
  overallUnrealized: number
}

export default function PortfolioHoldingsClient({
  groupedAccounts,
  groupedSubs,
  cash,
  grandTotalBasis,
  grandTotalValue,
  overallUnrealized,
}: PortfolioHoldingsClientProps) {
  const [viewBy, setViewBy] = useState<'account' | 'subportfolio'>('subportfolio')
  const [sortKey, setSortKey] = useState<SortKey>('currValue')
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc')
  const [refreshing, setRefreshing] = useState(false)
  const [refreshMessage, setRefreshMessage] = useState<string | null>(null)

  const handleRefreshPrices = async () => {
    setRefreshing(true)
    setRefreshMessage(null)
    try {
      const result = await refreshAssetPrices()
      setRefreshMessage(result.message || 'Prices refreshed successfully!')
      // Page will auto-refresh via revalidatePath
    } catch (err) {
      setRefreshMessage('Error refreshing prices. Check console.')
      console.error(err)
    } finally {
      setRefreshing(false)
    }
  }

  const handleSort = (key: SortKey) => {
    if (sortKey === key) {
      setSortDir(sortDir === 'asc' ? 'desc' : 'asc')
    } else {
      setSortKey(key)
      setSortDir('desc')
    }
  }

  const sortHoldings = (holdings: Holding[]) => {
    return [...holdings].sort((a, b) => {
      let va: number | string = 0
      let vb: number | string = 0
      switch (sortKey) {
        case 'ticker':
          va = a.ticker.toLowerCase()
          vb = b.ticker.toLowerCase()
          break
        case 'quantity':
          va = a.total_quantity
          vb = b.total_quantity
          break
        case 'avgBasis':
          va = a.total_basis / (a.total_quantity || 1)
          vb = b.total_basis / (b.total_quantity || 1)
          break
        case 'totalBasis':
          va = a.total_basis
          vb = b.total_basis
          break
        case 'currPrice':
          va = a.current_price || 0
          vb = b.current_price || 0
          break
        case 'currValue':
          va = a.current_value || 0
          vb = b.current_value || 0
          break
        case 'unrealGain':
          va = a.unrealized_gain || 0
          vb = b.unrealized_gain || 0
          break
      }
      if (va < vb) return sortDir === 'asc' ? -1 : 1
      if (va > vb) return sortDir === 'asc' ? 1 : -1
      return 0
    })
  }

  const renderTable = (holding: Holding, isClosed = false) => (
    <TableRow key={holding.asset_id}>
      <TableCell className="w-32 font-medium min-w-0">
        <div className="flex flex-col">
          <span className="font-bold text-sm">{holding.ticker}</span>
          {holding.name && <span className="text-xs text-muted-foreground">{holding.name}</span>}
        </div>
      </TableCell>
      <TableCell className="text-right w-20">
        {holding.asset_id === 'cash' || isClosed ? '-' : holding.total_quantity.toFixed(8)}
      </TableCell>
      <TableCell className="text-right w-20">
        {holding.asset_id === 'cash' || isClosed ? '-' : formatUSD(holding.total_basis / (holding.total_quantity || 1))}
      </TableCell>
      <TableCell className="text-right w-24">{formatUSD(holding.total_basis)}</TableCell>
      <TableCell className="text-right w-20">
        {holding.asset_id === 'cash' || isClosed ? '-' : formatUSD(holding.current_price || 0)}
      </TableCell>
      <TableCell className="text-right w-24">{formatUSD(holding.current_value || 0)}</TableCell>
      <TableCell className={cn("text-right w-28", (holding.unrealized_gain ?? 0) > 0 ? "text-green-600" : "text-red-600")}>
        {formatUSD(holding.unrealized_gain ?? 0)}
      </TableCell>
    </TableRow>
  )

  return (
    <div>
      <div className="mb-4 flex items-center gap-4">
        <div className="flex items-center gap-2">
          <Label>Group by:</Label>
          <Select value={viewBy} onValueChange={(v: typeof viewBy) => setViewBy(v)}>
            <SelectTrigger className="w-[180px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="subportfolio">Sub-Portfolio</SelectItem>
              <SelectItem value="account">Account</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <Button 
          onClick={handleRefreshPrices} 
          disabled={refreshing}
          variant="default"
        >
          {refreshing ? 'Refreshing...' : 'Refresh Asset Prices'}
        </Button>
        {refreshMessage && <span className="text-sm text-green-600">{refreshMessage}</span>}
      </div>
      <Accordion type="multiple" defaultValue={[]} className="w-full">
        {(viewBy === 'account' ? groupedAccounts : groupedSubs).map(group => {
          const sortedHoldings = sortHoldings(group.holdings);
          if (sortedHoldings.length === 0) return null;
          return (
            <AccordionItem key={group.key} value={group.key}>
              <AccordionTrigger className="font-bold bg-muted/50 px-4 py-2">
                {group.key}
                <span className="ml-auto flex space-x-4 text-sm">
                  <span>Total Basis: {formatUSD(group.total_basis)}</span>
                  <span>Total Value: {formatUSD(group.total_value)}</span>
                  <span className={cn(group.unrealized_gain > 0 ? "text-green-600" : "text-red-600")}>
                    Unreal Gain/Loss: {formatUSD(group.unrealized_gain)}
                  </span>
                </span>
              </AccordionTrigger>
              <AccordionContent>
                <div className="overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead className="cursor-pointer min-w-0 w-32 whitespace-nowrap" onClick={() => handleSort('ticker')}>Asset</TableHead>
                        <TableHead className="text-right cursor-pointer w-20 whitespace-nowrap" onClick={() => handleSort('quantity')}>Quantity</TableHead>
                        <TableHead className="text-right cursor-pointer w-20 whitespace-nowrap" onClick={() => handleSort('avgBasis')}>Avg Basis</TableHead>
                        <TableHead className="text-right cursor-pointer w-24 whitespace-nowrap" onClick={() => handleSort('totalBasis')}>Total Basis</TableHead>
                        <TableHead className="text-right cursor-pointer w-20 whitespace-nowrap" onClick={() => handleSort('currPrice')}>Curr Price</TableHead>
                        <TableHead className="text-right cursor-pointer w-24 whitespace-nowrap" onClick={() => handleSort('currValue')}>Curr Value</TableHead>
                        <TableHead className="text-right cursor-pointer w-28 whitespace-nowrap" onClick={() => handleSort('unrealGain')}>Unreal Gain/Loss</TableHead>
                      </TableRow>
                    </TableHeader>
                  <TableBody>
                    {sortedHoldings.map(holding => renderTable(holding, false))}
                    <TableRow className="font-bold border-t">
                      <TableCell className="w-32">Subtotal for {group.key}</TableCell>
                      <TableCell className="text-right w-20" /> {/* Blank for Quantity */}
                      <TableCell className="text-right w-20" /> {/* Blank for Avg Basis */}
                      <TableCell className="text-right w-24">{formatUSD(group.total_basis)}</TableCell>
                      <TableCell className="text-right w-20" /> {/* Blank for Curr Price */}
                      <TableCell className="text-right w-24">{formatUSD(group.total_value)}</TableCell>
                      <TableCell className={cn("text-right w-28", group.unrealized_gain > 0 ? "text-green-600" : "text-red-600")}>
                        {formatUSD(group.unrealized_gain)}
                      </TableCell>
                    </TableRow>
                  </TableBody>
                </Table>
                </div>
              </AccordionContent>
            </AccordionItem>
          );
        })}
      </Accordion>
      {/* Footer for cash and grand total */}
      <div className="overflow-x-auto">
        <Table className="mt-4">
        <TableBody>
          {/* Show aggregated Cash Balance only in Sub-Portfolio view */}
          {viewBy === 'subportfolio' && (
            <TableRow className="font-bold bg-muted/50">
              <TableCell className="w-32">Cash Balance</TableCell>
              <TableCell className="text-right w-20" /> {/* Quantity */}
              <TableCell className="text-right w-20" /> {/* Avg Basis */}
              <TableCell className="text-right w-24">{formatUSD(cash)}</TableCell>
              <TableCell className="text-right w-20" /> {/* Curr Price - blank */}
              <TableCell className="text-right w-24">{formatUSD(cash)}</TableCell> {/* Curr Value */}
              <TableCell className="text-right w-28">$0.00</TableCell> {/* Unreal G/L */}
            </TableRow>
          )}
          <TableRow className="font-bold text-lg">
            <TableCell className="w-32">Portfolio Total</TableCell>
            <TableCell className="text-right w-20" />
            <TableCell className="text-right w-20" />
            <TableCell className="text-right w-24">{formatUSD(grandTotalBasis)}</TableCell>
            <TableCell className="text-right w-20" />
            <TableCell className="text-right w-24">{formatUSD(grandTotalValue)}</TableCell>
            <TableCell className={cn(
              "text-right w-28",
              overallUnrealized > 0 ? "text-green-600" : overallUnrealized < 0 ? "text-red-600" : ""
            )}>
              {formatUSD(overallUnrealized)}
            </TableCell>
          </TableRow>
        </TableBody>
      </Table>
      </div>
    </div>
  )
}