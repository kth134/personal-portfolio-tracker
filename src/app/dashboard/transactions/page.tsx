import { supabaseServer } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import Link from 'next/link'
import { Button } from '@/components/ui/button'

export default async function TransactionsPage() {
  const supabase = await supabaseServer()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/')

  // Placeholder fetch (expand with real query later)
  const { data: transactions } = await supabase.from('transactions').select('*').eq('user_id', user.id).order('date', { ascending: false }).limit(20)

  return (
    <main className="p-8">
      <div className="flex justify-between items-center mb-8">
        <h1 className="text-3xl font-bold">Transactions</h1>
        <Link href="/dashboard/transactions/add">
          <Button>Add Transaction</Button>
        </Link>
      </div>
      {transactions && transactions.length > 0 ? (
        <pre className="bg-gray-100 p-4 rounded">{JSON.stringify(transactions, null, 2)}</pre>  // Temp display
      ) : (
        <p>No transactions yet. Add one!</p>
      )}
    </main>
  )
}