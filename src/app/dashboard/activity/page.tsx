import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import { Suspense } from 'react'
import { fetchAllUserTransactionsServer } from '@/lib/finance'
import ActivityTabs from './ActivityTabs'
import { DashboardPageShell } from '@/components/dashboard-shell'

export default async function ActivityPage({
  searchParams,
}: {
  searchParams: { [key: string]: string | string[] | undefined }
}) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/')
  const page = Math.max(1, parseInt(searchParams.page as string) || 1)
  const tab = (searchParams.tab as string) || 'transactions'
  const debug = (searchParams.debug as string) === '1'

  const pageSize = 100
  const from = (page - 1) * pageSize
  const to = from + pageSize - 1

  let transactions: any[] = []
  let transactionsCount = 0
  let diagnostics = ''

  if (tab === 'transactions') {
    // Fetch all transactions for client-side pagination
    const all = await fetchAllUserTransactionsServer(supabase, user.id)
    transactions = all || []
    transactionsCount = transactions.length
    diagnostics += `Fetched all transactions: ${transactions.length} items\n`
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
    <DashboardPageShell
      eyebrow="Activity"
      title="Transactions And Tax Lots"
      description="Review transaction history, filter activity, and manage tax lots used to track basis and remaining shares."
    >
      {debug && diagnostics && (
        <div className="rounded-[22px] border border-yellow-300 bg-yellow-50 p-4 text-yellow-800 shadow-sm">
          <strong>Diagnostics:</strong><br />
          <pre>{diagnostics}</pre>
        </div>
      )}
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
    </DashboardPageShell>
  )
}