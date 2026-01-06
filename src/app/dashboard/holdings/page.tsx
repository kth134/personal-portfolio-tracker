import { supabaseServer } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'

type AssetDetail = {
  ticker: string
  name: string | null
}

type TaxLot = {
  asset_id: string
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
}

export default async function HoldingsPage() {
  const supabase = await supabaseServer()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/')

  // Fetch open tax lots for invested holdings
  const { data: lots } = await supabase
    .from('tax_lots')
    .select(`
      asset_id,
      remaining_quantity,
      cost_basis_per_unit,
      asset:assets (ticker, name)
    `)
    .gt('remaining_quantity', 0)
    .eq('user_id', user.id) as { data: TaxLot[] | null }

  // Client-side aggregation for invested holdings
  const holdingsMap = new Map<string, Holding>()

  let investedTotalBasis = 0

  if (lots) {
    for (const lot of lots) {
      const key = lot.asset_id
      const qty = Number(lot.remaining_quantity)
      const basisPer = Number(lot.cost_basis_per_unit)
      const basisThisLot = qty * basisPer

      investedTotalBasis += basisThisLot

      const assetDetail = lot.asset

      if (holdingsMap.has(key)) {
        const existing = holdingsMap.get(key)!
        existing.total_quantity += qty
        existing.total_basis += basisThisLot
      } else {
        holdingsMap.set(key, {
          asset_id: key,
          ticker: assetDetail.ticker,
          name: assetDetail.name,
          total_quantity: qty,
          total_basis: basisThisLot
        })
      }
    }
  }

  const investedHoldings: Holding[] = Array.from(holdingsMap.values())

  // Fetch total cash balance from transaction amounts
  const { data: cashData } = await supabase
    .from('transactions')
    .select('amount')
    .eq('user_id', user.id)

  const cashBalance = cashData?.reduce((sum, tx) => sum + Number(tx.amount || 0), 0) || 0

  const grandTotal = investedTotalBasis + cashBalance

  return (
    <main className="p-8">
      <h1 className="text-3xl font-bold mb-8">Current Holdings & Cash</h1>

      {investedHoldings.length > 0 || cashBalance !== 0 ? (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Asset</TableHead>
              <TableHead className="text-right">Quantity</TableHead>
              <TableHead className="text-right">Avg Cost Basis</TableHead>
              <TableHead className="text-right">Total Cost Basis</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {/* Invested assets */}
            {investedHoldings.map((h) => {
              const avgBasis = h.total_quantity > 0 ? h.total_basis / h.total_quantity : 0
              return (
                <TableRow key={h.asset_id}>
                  <TableCell className="font-medium">
                    {h.ticker} {h.name && `- ${h.name}`}
                  </TableCell>
                  <TableCell className="text-right">{h.total_quantity.toFixed(8)}</TableCell>
                  <TableCell className="text-right">${avgBasis.toFixed(2)}</TableCell>
                  <TableCell className="text-right">${h.total_basis.toFixed(2)}</TableCell>
                </TableRow>
              )
            })}

            {/* Cash row */}
            <TableRow className="font-bold bg-muted/50">
              <TableCell>Cash Balance</TableCell>
              <TableCell className="text-right">-</TableCell>
              <TableCell className="text-right">-</TableCell>
              <TableCell className="text-right">${cashBalance.toFixed(2)}</TableCell>
            </TableRow>

            {/* Grand total */}
            <TableRow className="font-bold text-lg">
              <TableCell>Total Portfolio Basis</TableCell>
              <TableCell className="text-right">-</TableCell>
              <TableCell className="text-right">-</TableCell>
              <TableCell className="text-right">${grandTotal.toFixed(2)}</TableCell>
            </TableRow>
          </TableBody>
        </Table>
      ) : (
        <p className="text-muted-foreground">No holdings or cash yet—add some transactions!</p>
      )}
    </main>
  )
}