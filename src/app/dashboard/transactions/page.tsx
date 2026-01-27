import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import TransactionManagement from '../../../components/TransactionManagement'

export default async function TransactionManagementPage({
  searchParams,
}: {
  searchParams: { [key: string]: string | string[] | undefined }
}) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/')

  const page = Math.max(1, parseInt(searchParams.page as string) || 1)
  const tab = (searchParams.tab as string) || 'transactions'
  const pageSize = 100
  const from = (page - 1) * pageSize
  const to = from + pageSize - 1

  // Get total count separately to avoid range affecting the count
  const { count: transactionsCount } = await supabase
    .from('transactions')
    .select('id', { count: 'exact' })
    .eq('user_id', user.id)
    .limit(0)

  // Fetch the requested page by retrieving the containing 1000-row batch
  // and slicing to the desired page to avoid issues with large-range queries.
  const batchSize = 1000
  const batchIndex = Math.floor(from / batchSize)
  const batchFrom = batchIndex * batchSize
  const batchTo = batchFrom + batchSize - 1

  const { data: batchTransactions, error: batchError } = await supabase
    .from('transactions')
    .select(`
      *,
      account:accounts (name, type),
      asset:assets (ticker, name)
    `)
    .eq('user_id', user.id)
    .order('date', { ascending: false })
    .range(batchFrom, batchTo)

  if (batchError) {
    console.error('transactions page fetch error', batchError)
    throw new Error('Failed to fetch transactions')
  }

  const transactions = (batchTransactions || []).slice(from - batchFrom, from - batchFrom + pageSize)

  // Get total count for tax lots separately
  const { count: taxLotsCount } = await supabase
    .from('tax_lots')
    .select('id', { count: 'exact' })
    .eq('user_id', user.id)
    .limit(0)

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
    .range(from, to)

  return <TransactionManagement 
    initialTransactions={transactions || []} 
    initialTaxLots={taxLots || []}
    transactionsTotal={transactionsCount || 0}
    taxLotsTotal={taxLotsCount || 0}
    currentPage={page}
    pageSize={pageSize}
    currentTab={tab}
  />
}