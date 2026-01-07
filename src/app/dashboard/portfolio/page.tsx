import { supabaseServer } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from '@/components/ui/accordion'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Label } from '@/components/ui/label'
import { cn } from '@/lib/utils'
import { useState } from 'react'
import AccountsList from '@/components/AccountsList'
import AssetsList from '@/components/AssetsList'
import HoldingsView from '@/components/HoldingsView'

// Reuse types, but extend AssetDetail with sub_portfolio and account_id on TaxLot
type AssetDetail = {
  ticker: string
  name: string | null
  asset_subtype: string | null
  sub_portfolio: string | null
}
type TaxLot = {
  asset_id: string
  account_id: string // Add for account grouping
  remaining_quantity: number
  cost_basis_per_unit: number
  asset: AssetDetail
}
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

async function getAssetPrice(ticker: string, assetSubtype: string | null): Promise<number> {
  // TODO: Implement actual price fetching logic (e.g., from an API)
  // For now, return a placeholder price
  return 0
}

export default async function PortfolioPage() {
  const supabase = await supabaseServer()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/')

  // Fetch with account_id and sub_portfolio
  const [lotsRes, accountsRes, assetsRes, cashRes] = await Promise.all([
    supabase.from('tax_lots').select(`asset_id, account_id, remaining_quantity, cost_basis_per_unit, asset:assets (ticker, name, asset_subtype, sub_portfolio)`).gt('remaining_quantity', 0).eq('user_id', user.id),
    supabase.from('accounts').select('*').eq('user_id', user.id),
    supabase.from('assets').select('*').eq('user_id', user.id),
    supabase.from('transactions').select('amount').eq('user_id', user.id).eq('type', 'Cash')
  ])

  const lots = lotsRes.data as TaxLot[] | null
  const initialAccounts = accountsRes.data || []
  const initialAssets = assetsRes.data || []
  const cashBalance = cashRes.data?.reduce((sum, tx) => sum + Number(tx.amount || 0), 0) || 0

  // Process flat holdings (for asset-centric)
  const holdingsMap = new Map<string, Holding>()
  let investedTotalBasis = 0
  let investedCurrentValue = 0
  if (lots) {
    for (const lot of lots) {
      const key = lot.asset_id
      const qty = Number(lot.remaining_quantity)
      const basisPer = Number(lot.cost_basis_per_unit)
      const basisThisLot = qty * basisPer
      investedTotalBasis += basisThisLot

      const assetDetail = lot.asset
      const currentPrice = await getAssetPrice(assetDetail.ticker, assetDetail.asset_subtype)
      const valueThisLot = qty * currentPrice

      if (holdingsMap.has(key)) {
        const existing = holdingsMap.get(key)!
        existing.total_quantity += qty
        existing.total_basis += basisThisLot
        existing.current_value = (existing.current_value || 0) + valueThisLot
      } else {
        holdingsMap.set(key, {
          asset_id: key,
          ticker: assetDetail.ticker,
          name: assetDetail.name,
          total_quantity: qty,
          total_basis: basisThisLot,
          current_price: currentPrice,
          current_value: valueThisLot,
        })
      }
      investedCurrentValue += valueThisLot
    }
  }
  const investedHoldings: Holding[] = Array.from(holdingsMap.values()).map(h => ({
    ...h,
    unrealized_gain: (h.current_value || 0) - h.total_basis,
  }))
  const grandTotalBasis = investedTotalBasis + cashBalance
  const grandTotalValue = investedCurrentValue + cashBalance
  const overallUnrealized = grandTotalValue - grandTotalBasis

  // Precompute grouped data for client
  const accountMap = new Map(initialAccounts.map(a => [a.id, a.name]))
  const groupedByAccount: GroupedHolding[] = []
  const groupedBySubPortfolio: GroupedHolding[] = []
  if (lots) {
    const accHoldings = new Map<string, { holdings: Map<string, Holding>, total_basis: number, total_value: number }>()
    const subHoldings = new Map<string, { holdings: Map<string, Holding>, total_basis: number, total_value: number }>()
    for (const lot of lots) {
      const assetKey = lot.asset_id
      const accKey = accountMap.get(lot.account_id) || 'Unknown'
      const subKey = lot.asset.sub_portfolio || 'Untagged'
      const qty = Number(lot.remaining_quantity)
      const basisThis = qty * Number(lot.cost_basis_per_unit)
      const valueThis = qty * (investedHoldings.find(h => h.asset_id === assetKey)?.current_price || 0)

      // Group by account
      if (!accHoldings.has(accKey)) accHoldings.set(accKey, { holdings: new Map(), total_basis: 0, total_value: 0 })
      const accGroup = accHoldings.get(accKey)!
      if (!accGroup.holdings.has(assetKey)) {
        accGroup.holdings.set(assetKey, {
          asset_id: assetKey,
          ticker: lot.asset.ticker,
          name: lot.asset.name,
          total_quantity: 0,
          total_basis: 0,
          current_value: 0,
          unrealized_gain: 0,
        })
      }
      const accAsset = accGroup.holdings.get(assetKey)!
      accAsset.total_quantity += qty
      accAsset.total_basis += basisThis
      accAsset.current_value! += valueThis
      accAsset.unrealized_gain = accAsset.current_value! - accAsset.total_basis
      accGroup.total_basis += basisThis
      accGroup.total_value += valueThis

      // Group by sub-portfolio (similar)
      if (!subHoldings.has(subKey)) subHoldings.set(subKey, { holdings: new Map(), total_basis: 0, total_value: 0 })
      const subGroup = subHoldings.get(subKey)!
      if (!subGroup.holdings.has(assetKey)) {
        subGroup.holdings.set(assetKey, { ...accAsset }) // Copy structure
      }
      const subAsset = subGroup.holdings.get(assetKey)!
      subAsset.total_quantity += qty
      subAsset.total_basis += basisThis
      subAsset.current_value! += valueThis
      subAsset.unrealized_gain = subAsset.current_value! - subAsset.total_basis
      subGroup.total_basis += basisThis
      subGroup.total_value += valueThis
    }

    // Convert to arrays
    groupedByAccount.push(...Array.from(accHoldings, ([key, g]) => ({
      key,
      holdings: Array.from(g.holdings.values()),
      total_basis: g.total_basis,
      total_value: g.total_value,
      unrealized_gain: g.total_value - g.total_basis
    })))
    groupedBySubPortfolio.push(...Array.from(subHoldings, ([key, g]) => ({
      key,
      holdings: Array.from(g.holdings.values()),
      total_basis: g.total_basis,
      total_value: g.total_value,
      unrealized_gain: g.total_value - g.total_basis
    })))
  }

  // Client component
  function HoldingsView({ flatHoldings, groupedAccounts, groupedSubs, cash }: { flatHoldings: Holding[], groupedAccounts: GroupedHolding[], groupedSubs: GroupedHolding[], cash: number }) {
    const [viewBy, setViewBy] = useState<'asset' | 'account' | 'subportfolio'>('asset')

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
              <Accordion type="multiple">
                {(viewBy === 'account' ? groupedAccounts : groupedSubs).map(group => (
                  <AccordionItem key={group.key} value={group.key}>
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
                ))}
              </Accordion>
            )}
            {/* Cash and totals rows - copy from before */}
            <TableRow className="font-bold bg-muted/50">
              <TableCell>Cash Balance</TableCell>
              {/* ... */}
            </TableRow>
            <TableRow className="font-bold text-lg">
              <TableCell>Portfolio Total</TableCell>
              {/* ... */}
            </TableRow>
          </TableBody>
        </Table>
      </div>
    )
  }

  return (
    <main className="p-8">
      <h1 className="text-3xl font-bold mb-8">Portfolio</h1>
      <Tabs defaultValue="holdings">
        {/* Same as before */}
        <TabsContent value="holdings">
          <HoldingsView flatHoldings={investedHoldings} groupedAccounts={groupedByAccount} groupedSubs={groupedBySubPortfolio} cash={cashBalance} />
        </TabsContent>
        {/* Accounts and Assets tabs unchanged */}
      </Tabs>
    </main>
  )
}