import { supabaseServer } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import TransactionsList from '../../../components/TransactionsList'

export default async function TransactionsPage() {
  const supabase = await supabaseServer()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/')

  const { data: transactions } = await supabase
    .from('transactions')
    .select(`
      *,
      account:accounts (name, type),
      asset:assets (ticker, name)
    `)
    .eq('user_id', user.id)
    .order('date', { ascending: false })

  return <TransactionsList initialTransactions={transactions || []} />
}