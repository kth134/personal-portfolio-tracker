import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import TransactionManagement from '../../../components/TransactionManagement'

export default async function TransactionManagementPage() {
  const supabase = await createClient()
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

  const { data: taxLots } = await supabase
    .from('tax_lots')
    .select(`
      *,
      account:accounts (id, name),
      asset:assets (id, ticker, name),
      account_id,
      asset_id
    `)
    .eq('user_id', user.id)
    .order('purchase_date', { ascending: false })
    .gt('remaining_quantity', 0)
  return <TransactionManagement initialTransactions={transactions || []} initialTaxLots={taxLots || []} />
}