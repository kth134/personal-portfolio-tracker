"use client"

import React, { useState } from 'react'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from '@/components/ui/accordion'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Label } from '@/components/ui/label'
import { Button } from '@/components/ui/button'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'
import { refreshAssetPrices } from './actions'
import { cn } from '@/lib/utils'
import { formatUSD } from '@/lib/formatters'

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

type ClosedBreakdown = {
  realized: number
  dividends: number
  interest: number
  fees: number
}

type GroupedHolding = {
  key: string
  holdings: Holding[]
  total_basis: number
  total_value: number
  unrealized_gain: number
  closed_net: number
  closed_breakdown: ClosedBreakdown
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
    } catch (err) {
      setRefreshMessage('Error refreshing prices.')
      console.error(err)
    } finally {
      setRefreshing(false)
    }
  }

  const handleSort = (newKey: SortKey) => {
    if (newKey === sortKey) {
      setSortDir(sortDir === 'asc' ? 'desc' : 'asc')
    } else {
      setSortKey(newKey)
      setSortDir('desc')
    }
  }

  const sortHoldings = (holdings: Holding[]) => {
    return [...holdings].sort((a, b) => {
      let va: number | string = 0
      let vb: number | string = 0
      switch (sortKey) {
        case 'ticker': va = a.ticker.toLowerCase(); vb = b.ticker.toLowerCase(); break
        case 'quantity': va = a.total_quantity; vb = b.total_quantity; break
        case 'avgBasis': va = a.total_basis / (a.total_quantity || 1); vb = b.total_basis / (b.total_quantity || 1); break
        case 'totalBasis': va = a.total_basis; vb = b.total_basis; break
        case 'currPrice': va = a.current_price || 0; vb = b.current_price || 0; break
        case 'currValue': va = a.current_value || 0; vb = b.current_value || 0; break
        case 'unrealGain': va = a.unrealized_gain; vb = b.unrealized_gain; break
        case 'netGain': va = a.net_gain; vb = b.net_gain; break
      }
      if (va < vb) return sortDir === 'asc' ? -1 : 1
      if (va > vb) return sortDir === 'asc' ? 1 : -1
      return 0
    })
  }

  const NetGainCell = ({ holding, isClosed = false, unrealForTooltip = 0 }: { holding: Holding; isClosed?: boolean; unrealForTooltip?: number }) => {
    const value = isClosed ? holding.net_gain : holding.net_gain
    const unreal = isClosed ? 0 : (unrealForTooltip || holding.unrealized_gain)

    return (
      <TooltipProvider>
        <Tooltip>
          <TooltipTrigger asChild>
            <span className={cn("cursor-pointer", value > 0 ? "text-green-600" : value < 0 ? "text-red-600" : "")}>
              {formatUSD(value)}
            </span>
          </TooltipTrigger>
          <TooltipContent className="text-sm space-y-1">
            {!isClosed && <p>Unrealized: {formatUSD(unreal)}</p>}
            <p>Realized: {formatUSD(holding.realized_gain)}</p>
            <p>Dividends: {formatUSD(holding.dividends)}</p>
            <p>Interest: {formatUSD(holding.interest)}</p>
            <p>Fees: -{formatUSD(holding.fees)}</p>
            <p className="font-bold">Net: {formatUSD(value)}</p>
          </TooltipContent>
        </Tooltip>
      </TooltipProvider>
    )
  }

  const renderHoldingRow = (holding: Holding, isClosed = false) => (
    <TableRow key={holding.asset_id + (isClosed ? '-closed' : '')}>
      <TableCell>
        <div className="flex flex-col">
          <span className={cn("font-medium", isClosed && "italic")}>
            {isClosed ? 'Closed Positions (aggregate)' : holding.ticker}
          </span>
          {holding.name && !isClosed && <span className="text-sm text-muted-foreground">{holding.name}</span>}
        </div>
      </TableCell>
      <TableCell className="text-right">{holding.asset_id === 'cash' || isClosed ? '-' : holding.total_quantity.toFixed(8)}</TableCell>
      <TableCell className="text-right">{holding.asset_id === 'cash' || isClosed ? '-' : formatUSD(holding.total_basis / (holding.total_quantity || 1))}</TableCell>
      <TableCell className="text-right">{isClosed ? '-' : formatUSD(holding.total_basis)}</TableCell>
      <TableCell className="text-right">{holding.asset_id === 'cash' || isClosed ? '-' : formatUSD(holding.current_price || 0)}</TableCell>
      <TableCell className="text-right">{isClosed ? '$0.00' : formatUSD(holding.current_value || 0)}</TableCell>
      <TableCell className={cn("text-right", holding.unrealized_gain > 0 ? "text-green-600" : "text-red-600")}>
        {isClosed ? '$0.00' : formatUSD(holding.unrealized_gain)}
      </TableCell>
      <TableCell className="text-right">
        <NetGainCell holding={holding} isClosed={isClosed} />
      </TableCell>
    </TableRow>
  )

  const groups = viewBy === 'account' ? groupedAccounts : groupedSubs

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
        <Button onClick={handleRefreshPrices} disabled={refreshing}>
          {refreshing ? 'Refreshing...' : 'Refresh Asset Prices'}
        </Button>
        {refreshMessage && <span className="text-sm text-green-600">{refreshMessage}</span>}
      </div>

      <Accordion type="multiple" defaultValue={groups.map(g => g.key)} className="w-full">
        {groups.map(group => {
          const sortedOpen = sortHoldings(group.holdings)
          const hasClosed = group.closed_net !== 0

          // Virtual closed holding for rendering
          const closedHolding: Holding = {
            asset_id: 'closed',
            ticker: '',
            name: null,
            total_quantity: 0,
            total_basis: 0,
            current_price: 0,
            current_value: 0,
            unrealized_gain: 0,
            realized_gain: group.closed_breakdown.realized,
            dividends: group.closed_breakdown.dividends,
            interest: group.closed_breakdown.interest,
            fees: group.closed_breakdown.fees,
            net_gain: group.closed_net,
          }

          return (
            <AccordionItem key={group.key} value={group.key}>
              <AccordionTrigger className="font-bold bg-muted/50 px-4 py-2">
                {group.key}
                <span className="ml-auto flex space-x-6 text-sm">
                  <span>Total Basis: {formatUSD(group.total_basis)}</span>
                  <span>Total Value: {formatUSD(group.total_value)}</span>
                  <span className={cn(group.unrealized_gain > 0 ? "text-green-600" : "text-red-600")}>
                    Unreal G/L: {formatUSD(group.unrealized_gain)}
                  </span>
                  <span className={cn(group.total_net_gain > 0 ? "text-green-600" : "text-red-600")}>
                    Net G/L: {formatUSD(group.total_net_gain)}
                  </span>
                </span>
              </AccordionTrigger>
              <AccordionContent>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Asset</TableHead>
                      <TableHead className="text-right">Quantity</TableHead>
                      <TableHead className="text-right">Avg Basis</TableHead>
                      <TableHead className="text-right">Current Price</TableHead>
                      <TableHead className="text-right">Market Value</TableHead>
                      <TableHead className="text-right">Unreal G/L</TableHead>
                      <TableHead className="text-right">Net G/L</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {sortedOpen.map(holding => (
                      <React.Fragment key={holding.asset_id}>
                        {renderHoldingRow(holding, false)}
                      </React.Fragment>
                    ))}
                    {hasClosed && renderHoldingRow(closedHolding, true)}
                  </TableBody>
                </Table>
              </AccordionContent>
            </AccordionItem>
          )
        })}
      </Accordion>
    </div>
  )
}