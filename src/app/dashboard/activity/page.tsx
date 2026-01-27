import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import { Suspense } from 'react'
import ActivityTabs from './ActivityTabs'

export default async function ActivityPage({
  searchParams,
}: {
  searchParams: { [key: string]: string | string[] | undefined }
}) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/')
  const page = Math.max(1, parseInt(searchParams.page as string) || 1)
  const tab = (searchParams.tab as string) || undefined

  // If caller requested the `transactions` tab via the activity route,
  // redirect to the canonical `/dashboard/transactions` route so server-side
  // pagination and fallbacks run consistently.
  if (tab === 'transactions') {
    redirect(`/dashboard/transactions?page=${page}`)
  }
  const pageSize = 100
  const from = (page - 1) * pageSize
  const to = from + pageSize - 1

  const { data: transactions, count: transactionsCount } = await supabase
    .from('transactions')
    .select(`
      *,
      account:accounts (name, type),
      asset:assets (ticker, name)
    `, { count: 'exact' })
    .eq('user_id', user.id)
    .order('date', { ascending: false })

  const { data: taxLots, count: taxLotsCount } = await supabase
    .from('tax_lots')
    .select(`
      *,
      account:accounts (id, name),
      asset:assets (id, ticker, name),
      account_id,
      asset_id
    `, { count: 'exact' })
    .eq('user_id', user.id)
    .order('purchase_date', { ascending: false })

  return (
    <main className="p-8">
      <h1 className="text-3xl font-bold mb-8">Activity</h1>
      <Suspense fallback={<div className="p-8">Loading...</div>}>
        <ActivityTabs 
          initialTransactions={transactions || []} 
          initialTaxLots={taxLots || []}
          transactionsTotal={transactionsCount || 0}
          taxLotsTotal={taxLotsCount || 0}
          currentPage={page}
          pageSize={pageSize}
        />
      </Suspense>
    </main>
  )
}