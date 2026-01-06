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
  asset: AssetDetail // Explicitly type the joined asset as single object
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

  // Fetch all open tax lots with asset details
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

  // Client-side aggregation
  const holdingsMap = new Map<string, Holding>()

  if (lots) {
    for (const lot of lots) {
      const key = lot.asset_id
      const qty = Number(lot.remaining_quantity)
      const basisPer = Number(lot.cost_basis_per_unit)
      const basisThisLot = qty * basisPer

      const assetDetail = lot.asset // Typed as single object

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

  const holdings: Holding[] = Array.from(holdingsMap.values())

  return (
    <main className="p-8">
      <h1 className="text-3xl font-bold mb-8">Current Holdings</h1>

      {holdings.length > 0 ? (
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
            {holdings.map((h) => {
              const avgBasis = h.total_quantity > 0 ? h.total_basis / h.total_quantity : 0
              return (
                <TableRow key={h.asset_id}>
                  <TableCell className="font-medium">
                    {h.ticker} {h.name && `- ${h.name}`}
                  </TableCell>
                  <TableCell className="text-right">{h.total_quantity.toFixed(4)}</TableCell>
                  <TableCell className="text-right">${avgBasis.toFixed(2)}</TableCell>
                  <TableCell className="text-right">${h.total_basis.toFixed(2)}</TableCell>
                </TableRow>
              )
            })}
          </TableBody>
        </Table>
      ) : (
        <p className="text-muted-foreground">No open holdings yet—add some buy transactions!</p>
      )}
    </main>
  )
}