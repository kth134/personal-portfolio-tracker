import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import { Suspense } from 'react'
import ActivityTabs from './ActivityTabs'

export default async function ActivityPage() {
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

  return (
    <main className="p-8">
      <h1 className="text-3xl font-bold mb-8">Activity</h1>
      <Suspense fallback={<div className="p-8">Loading...</div>}>
        <ActivityTabs initialTransactions={transactions || []} initialTaxLots={taxLots || []} />
      </Suspense>
    </main>
  )
}