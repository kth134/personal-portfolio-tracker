import { supabaseServer } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import Link from 'next/link'
import { Button } from '@/components/ui/button'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'

export default async function TransactionsPage() {
  const supabase = await supabaseServer()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/')

  // Fetch transactions with joined account name and asset ticker/name
  const { data: transactions } = await supabase
    .from('transactions')
    .select(`
      *,
      account:accounts (name, type),
      asset:assets (ticker, name)
    `)
    .eq('user_id', user.id)
    .order('date', { ascending: false })
    // Remove limit for full history (add pagination later if needed)

  return (
    <main className="p-8">
      <div className="flex justify-between items-center mb-8">
        <h1 className="text-3xl font-bold">Transactions</h1>
        <Link href="/dashboard/transactions/add">
          <Button>Add Transaction</Button>
        </Link>
      </div>

      {transactions && transactions.length > 0 ? (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Date</TableHead>
              <TableHead>Account</TableHead>
              <TableHead>Asset</TableHead>
              <TableHead>Type</TableHead>
              <TableHead className="text-right">Quantity</TableHead>
              <TableHead className="text-right">Price/Unit</TableHead>
              <TableHead className="text-right">Amount</TableHead>
              <TableHead className="text-right">Fees</TableHead>
              <TableHead className="text-right">Realized Gain/Loss</TableHead>
              <TableHead>Notes</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {transactions.map((tx: any) => (
              <TableRow key={tx.id}>
                <TableCell>{tx.date}</TableCell>
                <TableCell>{tx.account?.name || '-'}</TableCell>
                <TableCell>
                  {tx.asset?.ticker || '-'}
                  {tx.asset?.name && ` - ${tx.asset.name}`}
                </TableCell>
                <TableCell>{tx.type}</TableCell>
                <TableCell className="text-right">
                  {tx.quantity ? Number(tx.quantity).toFixed(4) : '-'}
                </TableCell>
                <TableCell className="text-right">
                  {tx.price_per_unit ? `$${Number(tx.price_per_unit).toFixed(2)}` : '-'}
                </TableCell>
                <TableCell className="text-right">
                  {tx.amount ? `$${Number(tx.amount).toFixed(2)}` : '-'}
                </TableCell>
                <TableCell className="text-right">
                  {tx.fees ? `$${Number(tx.fees).toFixed(2)}` : '-'}
                </TableCell>
                <TableCell className={
                  [
                    "text-right font-medium",
                    tx.realized_gain > 0 ? 'text-green-600' : tx.realized_gain < 0 ? 'text-red-600' : ''
                  ].filter(Boolean).join(' ')
                }>
                  {tx.realized_gain != null ? `$${Number(tx.realized_gain).toFixed(2)}` : '-'}
                </TableCell>
                <TableCell>{tx.notes || '-'}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      ) : (
        <p className="text-muted-foreground">No transactions yet. Add one to get started!</p>
      )}
    </main>
  )
}