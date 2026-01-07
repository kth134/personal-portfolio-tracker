"use client"

import React, { useState } from 'react'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Accordion, AccordionItem, AccordionTrigger, AccordionContent } from '@/components/ui/accordion'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Label } from '@/components/ui/label'
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
  unrealized_gain?: number
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
  const allGroupKeys = (viewBy === 'account' ? groupedAccounts : groupedSubs).map(g => g.key)
  const renderTable = (holding: Holding) => (
    <TableRow key={holding.asset_id}>
      <TableCell className="font-medium">{holding.ticker} {holding.name && `- ${holding.name}`}</TableCell>
    <TableCell className="text-right">{formatUSD(holding.total_basis / (holding.total_quantity || 1))}</TableCell>      <TableCell className="text-right">{formatUSD(holding.total_basis / (holding.total_quantity || 1))}</TableCell>
      <TableCell className="text-right">{formatUSD(holding.total_basis)}</TableCell>
      <TableCell className="text-right">{formatUSD(holding.current_price || 0)}</TableCell>
      <TableCell className="text-right">{formatUSD(holding.current_value || 0)}</TableCell>
      <TableCell className={cn("text-right", (holding.unrealized_gain ?? 0) > 0 ? "text-green-600" : "text-red-600")}>
        {formatUSD(holding.unrealized_gain ?? 0)}
      </TableCell>
    </TableRow>
  )
const handleSort = (newKey: SortKey) => {
  if (newKey === sortKey) {
    setSortDir(sortDir === 'asc' ? 'desc' : 'asc')
  } else {
    setSortKey(newKey)
    setSortDir('desc') // Default to desc for most (e.g., largest first)
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
return (
  <div>
    <div className="mb-4">
      <Label className="mr-2">Group by:</Label>
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
    <Accordion type="multiple" defaultValue={allGroupKeys} className="w-full">
      {(viewBy === 'account' ? groupedAccounts : groupedSubs).map(group => {
        const sortedHoldings = sortHoldings(group.holdings);
        if (sortedHoldings.length === 0) return null;
        return (
          <AccordionItem key={group.key} value={group.key}>
            <AccordionTrigger className="font-bold bg-muted/50 px-4 py-2">
              {group.key}
            </AccordionTrigger>
            <AccordionContent>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Asset</TableHead>
                    <TableHead className="text-right cursor-pointer" onClick={() => handleSort('quantity')}>Quantity</TableHead>
                    <TableHead className="text-right cursor-pointer" onClick={() => handleSort('avgBasis')}>Avg Basis</TableHead>
                    <TableHead className="text-right cursor-pointer" onClick={() => handleSort('totalBasis')}>Total Basis</TableHead>
                    <TableHead className="text-right cursor-pointer" onClick={() => handleSort('currPrice')}>Curr Price</TableHead>
                    <TableHead className="text-right cursor-pointer" onClick={() => handleSort('currValue')}>Curr Value</TableHead>
                    <TableHead className="text-right cursor-pointer" onClick={() => handleSort('unrealGain')}>Unreal Gain/Loss</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {sortedHoldings.map(renderTable)}
                  <TableRow className="font-bold border-t">
                    <TableCell>Subtotal for {group.key}</TableCell>
                    <TableCell className="text-right">
                      {sortedHoldings.reduce((sum, h) => sum + h.total_quantity, 0).toFixed(8)}
                    </TableCell>
                    <TableCell className="text-right" /> {/* Blank for Avg Basis */}
                    <TableCell className="text-right">{formatUSD(group.total_basis)}</TableCell>
                    <TableCell className="text-right" /> {/* Blank for Curr Price */}
                    <TableCell className="text-right">{formatUSD(group.total_value)}</TableCell>
                    <TableCell className={cn("text-right", group.unrealized_gain > 0 ? "text-green-600" : "text-red-600")}>
                      {formatUSD(group.unrealized_gain)}
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
        <TableRow className="font-bold bg-muted/50">
          <TableCell>Cash Balance</TableCell>
          <TableCell className="text-right" colSpan={3}></TableCell>
          <TableCell className="text-right">{formatUSD(cash)}</TableCell>
          <TableCell className="text-right">{formatUSD(cash)}</TableCell>
          <TableCell className="text-right">$0.00</TableCell>
        </TableRow>
        <TableRow className="font-bold text-lg">
          <TableCell>Portfolio Total</TableCell>
          <TableCell className="text-right" colSpan={3}></TableCell>
          <TableCell className="text-right">{formatUSD(grandTotalBasis)}</TableCell>
          <TableCell className="text-right">{formatUSD(grandTotalValue)}</TableCell>
          <TableCell className={cn("text-right", overallUnrealized > 0 ? "text-green-600" : "text-red-600")}>
           {formatUSD(overallUnrealized)}
          </TableCell>
        </TableRow>
      </TableBody>
    </Table>
  </div>
)
}