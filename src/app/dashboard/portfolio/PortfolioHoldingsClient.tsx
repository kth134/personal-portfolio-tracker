"use client"

import React, { useState } from 'react'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from '@/components/ui/accordion'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Label } from '@/components/ui/label'
import { cn } from '@/lib/utils'

// Reuse types from page.tsx (or move to a shared types file)
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

  const renderTable = (holding: Holding) => (
    <TableRow key={holding.asset_id}>
      <TableCell className="font-medium">{holding.ticker} {holding.name && `- ${holding.name}`}</TableCell>
      <TableCell className="text-right">{holding.total_quantity.toFixed(8)}</TableCell>
      <TableCell className="text-right">${(holding.total_basis / holding.total_quantity || 0).toFixed(2)}</TableCell>
      <TableCell className="text-right">${holding.total_basis.toFixed(2)}</TableCell>
      <TableCell className="text-right">${(holding.current_price || 0).toFixed(2)}</TableCell>
      <TableCell className="text-right">${(holding.current_value || 0).toFixed(2)}</TableCell>
      <TableCell className={cn("text-right", (holding.unrealized_gain ?? 0) > 0 ? "text-green-600" : "text-red-600")}>
        ${(holding.unrealized_gain ?? 0).toFixed(2)}
      </TableCell>
    </TableRow>
  )

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
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Asset / Group</TableHead>
          <TableHead className="text-right">Quantity</TableHead>
          <TableHead className="text-right">Avg Basis</TableHead>
          <TableHead className="text-right">Total Basis</TableHead>
          <TableHead className="text-right">Curr Price</TableHead>
          <TableHead className="text-right">Curr Value</TableHead>
          <TableHead className="text-right">Unreal Gain/Loss</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {(viewBy === 'account' ? groupedAccounts : groupedSubs).map(group => (
          <React.Fragment key={group.key}>
            <TableRow className="font-bold bg-muted/50">
              <TableCell colSpan={7}>
                {group.key} - Value: ${group.total_value.toFixed(2)} (Gain: ${group.unrealized_gain.toFixed(2)})
              </TableCell>
            </TableRow>
            {group.holdings.map(renderTable)}
          </React.Fragment>
        ))}
        <TableRow className="font-bold bg-muted/50">
          <TableCell>Cash Balance</TableCell>
          <TableCell className="text-right" colSpan={3}></TableCell>
          <TableCell className="text-right">${cash.toFixed(2)}</TableCell>
          <TableCell className="text-right">${cash.toFixed(2)}</TableCell>
          <TableCell className="text-right">$0.00</TableCell>
        </TableRow>
        <TableRow className="font-bold text-lg">
          <TableCell>Portfolio Total</TableCell>
          <TableCell className="text-right" colSpan={3}></TableCell>
          <TableCell className="text-right">${grandTotalBasis.toFixed(2)}</TableCell>
          <TableCell className="text-right">${grandTotalValue.toFixed(2)}</TableCell>
          <TableCell className={cn("text-right", overallUnrealized > 0 ? "text-green-600" : "text-red-600")}>
            ${overallUnrealized.toFixed(2)}
          </TableCell>
        </TableRow>
      </TableBody>
    </Table>
  </div>
  )
}