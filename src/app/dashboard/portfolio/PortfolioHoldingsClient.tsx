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
type SortKey = 'ticker' | 'quantity' | 'avgBasis' | 'totalBasis' | 'currPrice' | 'currValue' | 'unrealGain' | 'netGain'

type Holding = {
  asset_id: string
  ticker: string
  name: string | null
  total_quantity: number
  total_basis: number
  current_price?: number
  current_value?: number
  unrealized_gain: number
  realized_gain: number
  dividends: number
  interest: number
  fees: number
  net_gain: number
}

type GroupedHolding = {
  key: string // account name or sub_portfolio
  holdings: Holding[]
  total_basis: number
  total_value: number
  unrealized_gain: number
  closed_net_gain: number
  closed_realized: number
  closed_dividends: number
  closed_interest: number
  closed_fees: number
  total_net_gain: number
}

type PortfolioHoldingsClientProps = {
  groupedAccounts: GroupedHolding[]
  groupedSubs: GroupedHolding[]
  cash: number
  grandTotalBasis: number
  grandTotalValue: number
  overallUnrealized: number
  overallNet: number
}

export default function PortfolioHoldingsClient({
  groupedAccounts,
  groupedSubs,
  cash,
  grandTotalBasis,
  grandTotalValue,
  overallUnrealized,
  overallNet,
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
        case 'netGain':
          va = a.net_gain || 0
          vb = b.net_gain || 0
          break
      }
      if (va < vb) return sortDir === 'asc' ? -1 : 1
      if (va > vb) return sortDir === 'asc' ? 1 : -1
      return 0
    })
  }

  const renderTable = (holding: Holding, isClosed = false) => (
    <TableRow key={holding.asset_id}>
      <TableCell className="font-medium">
        {isClosed ? 'Closed Positions' : `${holding.ticker} ${holding.name && `- ${holding.name}`}`}
      </TableCell>
      <TableCell className="text-right">
        {holding.asset_id === 'cash' || isClosed ? '-' : holding.total_quantity.toFixed(8)}
      </TableCell>
      <TableCell className="text-right">
        {holding.asset_id === 'cash' || isClosed ? '-' : formatUSD(holding.total_basis / (holding.total_quantity || 1))}
      </TableCell>
      <TableCell className="text-right">{formatUSD(holding.total_basis)}</TableCell>
      <TableCell className="text-right">
        {holding.asset_id === 'cash' || isClosed ? '-' : formatUSD(holding.current_price || 0)}
      </TableCell>
      <TableCell className="text-right">{formatUSD(holding.current_value || 0)}</TableCell>
      <TableCell className={cn("text-right", (holding.unrealized_gain ?? 0) > 0 ? "text-green-600" : "text-red-600")}>
        {formatUSD(holding.unrealized_gain ?? 0)}
      </TableCell>
      <TableCell className={cn("text-right", (holding.net_gain ?? 0) > 0 ? "text-green-600" : "text-red-600")}>
        <TooltipProvider>
          <Tooltip>
            <TooltipTrigger asChild>
              <span>{formatUSD(holding.net_gain ?? 0)}</span>
            </TooltipTrigger>
            <TooltipContent>
              <p>Unrealized Gain: {formatUSD(holding.unrealized_gain)}</p>
              <p>Realized Gain: {formatUSD(holding.realized_gain)}</p>
              <p>Dividends: {formatUSD(holding.dividends)}</p>
              <p>Interest: {formatUSD(holding.interest)}</p>
              <p>Fees: -{formatUSD(holding.fees)}</p>
            </TooltipContent>
          </Tooltip>
        </TooltipProvider>
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
                  <span className={cn(group.total_net_gain > 0 ? "text-green-600" : "text-red-600")}>
                    Net Gain/Loss: {formatUSD(group.total_net_gain)}
                  </span>
                </span>
              </AccordionTrigger>
              <AccordionContent>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="cursor-pointer" onClick={() => handleSort('ticker')}>Asset</TableHead>
                      <TableHead className="text-right cursor-pointer" onClick={() => handleSort('quantity')}>Quantity</TableHead>
                      <TableHead className="text-right cursor-pointer" onClick={() => handleSort('avgBasis')}>Avg Basis</TableHead>
                      <TableHead className="text-right cursor-pointer" onClick={() => handleSort('totalBasis')}>Total Basis</TableHead>
                      <TableHead className="text-right cursor-pointer" onClick={() => handleSort('currPrice')}>Curr Price</TableHead>
                      <TableHead className="text-right cursor-pointer" onClick={() => handleSort('currValue')}>Curr Value</TableHead>
                      <TableHead className="text-right cursor-pointer" onClick={() => handleSort('unrealGain')}>Unreal Gain/Loss</TableHead>
                      <TableHead className="text-right cursor-pointer" onClick={() => handleSort('netGain')}>Net Gain/Loss</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {sortedHoldings.map(holding => renderTable(holding, false))}
                    {group.closed_net_gain !== 0 && renderTable({
                      asset_id: 'closed',
                      ticker: 'Closed Positions (aggregate)',
                      name: null,
                      total_quantity: 0,
                      total_basis: 0,
                      current_price: 0,
                      current_value: 0,
                      unrealized_gain: 0,
                      realized_gain: group.closed_realized,
                      dividends: group.closed_dividends,
                      interest: group.closed_interest,
                      fees: group.closed_fees,
                      net_gain: group.closed_net_gain,
                    }, true)}
                    <TableRow className="font-bold border-t">
                      <TableCell>Subtotal for {group.key}</TableCell>
                      <TableCell className="text-right" /> {/* Blank for Quantity */}
                      <TableCell className="text-right" /> {/* Blank for Avg Basis */}
                      <TableCell className="text-right">{formatUSD(group.total_basis)}</TableCell>
                      <TableCell className="text-right" /> {/* Blank for Curr Price */}
                      <TableCell className="text-right">{formatUSD(group.total_value)}</TableCell>
                      <TableCell className={cn("text-right", group.unrealized_gain > 0 ? "text-green-600" : "text-red-600")}>
                        {formatUSD(group.unrealized_gain)}
                      </TableCell>
                      <TableCell className={cn("text-right", group.total_net_gain > 0 ? "text-green-600" : "text-red-600")}>
                        {formatUSD(group.total_net_gain)}
                      </TableCell>
                    </TableRow>
                  </TableBody>
                </Table>
              </AccordionContent>
            </AccordionItem>
          );
        })}
      </Accordion>
      {/* Footer for cash and grand total */}
      <Table className="mt-4">
        <TableBody>
          {/* Show aggregated Cash Balance only in Sub-Portfolio view */}
          {viewBy === 'subportfolio' && (
            <TableRow className="font-bold bg-muted/50">
              <TableCell>Cash Balance</TableCell>
              <TableCell className="text-right" /> {/* Quantity */}
              <TableCell className="text-right" /> {/* Avg Basis */}
              <TableCell className="text-right">{formatUSD(cash)}</TableCell>
              <TableCell className="text-right" /> {/* Curr Price - blank */}
              <TableCell className="text-right">{formatUSD(cash)}</TableCell> {/* Curr Value */}
              <TableCell className="text-right">$0.00</TableCell> {/* Unreal G/L */}
              <TableCell className="text-right">$0.00</TableCell> {/* Net G/L */}
            </TableRow>
          )}
          <TableRow className="font-bold text-lg">
            <TableCell>Portfolio Total</TableCell>
            <TableCell className="text-right" />
            <TableCell className="text-right" />
            <TableCell className="text-right">{formatUSD(grandTotalBasis)}</TableCell>
            <TableCell className="text-right" />
            <TableCell className="text-right">{formatUSD(grandTotalValue)}</TableCell>
            <TableCell className={cn(
              "text-right",
              overallUnrealized > 0 ? "text-green-600" : overallUnrealized < 0 ? "text-red-600" : ""
            )}>
              {formatUSD(overallUnrealized)}
            </TableCell>
            <TableCell className={cn(
              "text-right",
              overallNet > 0 ? "text-green-600" : overallNet < 0 ? "text-red-600" : ""
            )}>
              {formatUSD(overallNet)}
            </TableCell>
          </TableRow>
        </TableBody>
      </Table>
    </div>
  )
}