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
  const debug = (searchParams.debug as string) === '1'

  const pageSize = 100
  const from = (page - 1) * pageSize
  const to = from + pageSize - 1

  let transactions: any[] = []
  let transactionsCount = 0
  let diagnostics = ''

  if (tab === 'transactions') {
    // Fetch all transactions for client-side pagination
    const { data, count, error } = await supabase
      .from('transactions')
      .select(`
        *,
        account:accounts (name, type),
        asset:assets (ticker, name)
      `, { count: 'exact' })
      .eq('user_id', user.id)
      .order('date', { ascending: false })
      .limit(2000) // Ensure we get all, since total ~1093

    if (error) {
      diagnostics += `Error fetching all transactions: ${error.message}\n`
    } else {
      transactions = data || []
      transactionsCount = count || 0
      diagnostics += `Fetched all transactions: ${transactions.length} items\n`
    }
  }

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
      {debug && diagnostics && (
        <div className="mb-4 p-4 bg-yellow-100 border border-yellow-400 text-yellow-700 rounded">
          <strong>Diagnostics:</strong><br />
          <pre>{diagnostics}</pre>
        </div>
      )}
      <h1 className="text-3xl font-bold mb-8">Activity</h1>
      <Suspense fallback={<div className="p-8">Loading...</div>}>
        <ActivityTabs 
          initialTransactions={transactions} 
          initialTaxLots={taxLots || []}
          transactionsTotal={transactionsCount}
          taxLotsTotal={taxLotsCount || 0}
          currentPage={page}
          pageSize={pageSize}
          diagnostics={debug ? diagnostics : undefined}
        />
      </Suspense>
    </main>
  )
}