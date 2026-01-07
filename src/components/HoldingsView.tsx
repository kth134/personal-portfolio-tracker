'use client'

import { useState } from 'react'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from '@/components/ui/accordion'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Label } from '@/components/ui/label'
import { cn } from '@/lib/utils'

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
  key: string
  holdings: Holding[]
  total_basis: number
  total_value: number
  unrealized_gain: number
}

type Props = {
  flatHoldings: Holding[]
  groupedAccounts: GroupedHolding[]
  groupedSubs: GroupedHolding[]
  cash: number
}

export default function HoldingsView({ flatHoldings, groupedAccounts, groupedSubs, cash }: Props) {
  const [viewBy, setViewBy] = useState<'asset' | 'account' | 'subportfolio'>('asset')

  const renderTable = (holding: Holding) => (
    <TableRow key={holding.asset_id}>
      <TableCell className="font-medium">{holding.ticker} {holding.name && `- ${holding.name}`}</TableCell>
      <TableCell className="text-right">{holding.total_quantity.toFixed(8)}</TableCell>
      <TableCell className="text-right">${(holding.total_basis / holding.total_quantity || 0).toFixed(2)}</TableCell>
      <TableCell className="text-right">${holding.total_basis.toFixed(2)}</TableCell>
      <TableCell className="text-right">${(holding.current_price || 0).toFixed(2)}</TableCell>
      <TableCell className="text-right">${(holding.current_value || 0).toFixed(2)}</TableCell>
      <TableCell className={cn("text-right", (holding.unrealized_gain || 0) > 0 ? "text-green-600" : "text-red-600")}>
        ${(holding.unrealized_gain || 0).toFixed(2)}
      </TableCell>
    </TableRow>
  )

  return (
    <div>
      <div className="mb-4 flex items-center gap-2">
        <Label>Group by:</Label>
        <Select value={viewBy} onValueChange={(v: typeof viewBy) => setViewBy(v)}>
          <SelectTrigger className="w-[180px]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="asset">Asset (Flat)</SelectItem>
            <SelectItem value="account">Account</SelectItem>
            <SelectItem value="subportfolio">Sub-Portfolio</SelectItem>
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
          {viewBy === 'asset' ? (
            flatHoldings.map(renderTable)
          ) : (
            (viewBy === 'account' ? groupedAccounts : groupedSubs).map(group => (
              <TableRow key={group.key}>
                <TableCell colSpan={7}>
                  <Accordion type="multiple">
                    <AccordionItem value={group.key}>
                      <AccordionTrigger className="font-bold">
                        {group.key} - Value: ${group.total_value.toFixed(2)} (Gain: ${group.unrealized_gain.toFixed(2)})
                      </AccordionTrigger>
                      <AccordionContent>
                        <Table>
                          <TableBody>
                            {group.holdings.map(renderTable)}
                          </TableBody>
                        </Table>
                      </AccordionContent>
                    </AccordionItem>
                  </Accordion>
                </TableCell>
              </TableRow>
            ))
          )}
          <TableRow className="font-bold bg-muted/50">
            <TableCell>Cash Balance</TableCell>
            <TableCell colSpan={4}></TableCell>
            <TableCell className="text-right">${cash.toFixed(2)}</TableCell>
            <TableCell className="text-right">$0.00</TableCell>
          </TableRow>
        </TableBody>
      </Table>
    </div>
  )
}