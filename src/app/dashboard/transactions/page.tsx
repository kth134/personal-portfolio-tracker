import { createClient } from '@/lib/supabase/server'
import { fetchAllUserTransactionsServer } from '@/lib/finance'
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

  // If the total set is reasonably small, fetch all server-side and slice.
  // This ensures deterministic results and avoids range/proxy caps for moderate sizes.
  const SERVER_FETCH_THRESHOLD = 5000
  if ((transactionsCount || 0) > 0 && (transactionsCount || 0) <= SERVER_FETCH_THRESHOLD) {
    const all = await fetchAllUserTransactionsServer(supabase, user.id)
    const transactions = (all || []).slice(from, from + pageSize)
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

  let transactions = (batchTransactions || []).slice(from - batchFrom, from - batchFrom + pageSize)

  // Fallback: if the batch query returned no rows (some proxies cap ranges),
  // perform a deterministic keyset traversal in reasonably-sized chunks to
  // reach the requested offset without loading all rows into memory.
    if ((!batchTransactions || batchTransactions.length === 0) && (transactionsCount || 0) > 0) {
      // Short-term deterministic fallback: if the requested `from` offset
      // is beyond what the range returned, fetch the remaining rows by
      // selecting the oldest `remaining` rows (ascending) then reverse
      // into descending order for the UI. This avoids large-offset/range
      // behavior differences in proxies/PostgREST for the last page.
      try {
        const total = transactionsCount || 0
        const remaining = Math.max(0, total - from)
        if (remaining > 0) {
          const { data: remainingRows, error: remErr } = await supabase
            .from('transactions')
            .select(`
              *,
              account:accounts (name, type),
              asset:assets (ticker, name)
            `)
            .eq('user_id', user.id)
            .order('date', { ascending: true })
            .order('id', { ascending: true })
            .limit(remaining)

          if (remErr) {
            console.warn('ascending-remaining fallback error', remErr)
          } else if (remainingRows && remainingRows.length > 0) {
            // reverse to descending so UI ordering matches normal pages
            const rev = remainingRows.reverse()
            transactions = rev.slice(0, pageSize)
            console.log(`transactions fallback: used ascending-remaining fetch (remaining=${remaining}, returned=${transactions.length}) for page=${page}`)
          }
        }
      } catch (e) {
        console.warn('transactions ascending fallback threw', e)
      }

      // If the ascending remaining fetch produced rows, skip the keyset traversal.
      if (transactions && transactions.length > 0) {
        // proceed to tax lots fetch and return
      } else {
        // proceed with existing keyset traversal below
      }
      const chunk = 200 // traverse in 200-row keyset chunks
    let skipped = 0
    let cursorDate: string | null = null
    let cursorId: string | null = null
    let reached = false

    // helper to build keyset-filtered query
    const buildChunkQuery = (q: any) => {
      q = q.limit(chunk)
      if (cursorDate && cursorId) {
        // Use PostgREST OR filter to get rows with date < cursorDate OR (date = cursorDate AND id < cursorId)
        // Format: or(date.lt.<cursorDate>,and(date.eq.<cursorDate>,id.lt.<cursorId>))
        const filter = `or(date.lt.${cursorDate},and(date.eq.${cursorDate},id.lt.${cursorId}))`
        q = q.or(filter)
      }
      return q
    }

    while (!reached) {
      let q = supabase
        .from('transactions')
        .select(`
          id,
          date
        `)
        .eq('user_id', user.id)
        .order('date', { ascending: false })
        .order('id', { ascending: false })

      q = buildChunkQuery(q)

      const { data: chunkRows, error: chunkErr } = await q
      if (chunkErr) {
        console.error('keyset traversal error', chunkErr)
        break
      }

      if (!chunkRows || chunkRows.length === 0) break

      // If skipping this chunk would still be before desired offset, advance cursor
      if (skipped + chunkRows.length <= from) {
        skipped += chunkRows.length
        const last = chunkRows[chunkRows.length - 1]
        cursorDate = last.date
        cursorId = last.id
        continue
      }

      // We've reached the chunk that contains the first row of the desired page.
      // Use the cursor to fetch the page-sized set starting at the appropriate position.
      // Build filter to fetch rows older than current cursor (if set), then slice locally.
      const needToSkipInChunk = Math.max(0, from - skipped)

      // Fetch the full chunk (including the portion we may need to slice out)
      // but include requested fields for display
      let q2 = supabase
        .from('transactions')
        .select(`
          *,
          account:accounts (name, type),
          asset:assets (ticker, name)
        `)
        .eq('user_id', user.id)
        .order('date', { ascending: false })
        .order('id', { ascending: false })

      if (cursorDate && cursorId) {
        const filter = `or(date.lt.${cursorDate},and(date.eq.${cursorDate},id.lt.${cursorId}))`
        q2 = q2.or(filter)
      }

      q2 = q2.limit(chunk)
      const { data: pageChunk, error: pageChunkErr } = await q2
      if (pageChunkErr) {
        console.error('keyset page fetch error', pageChunkErr)
        break
      }

      const sliceStart = needToSkipInChunk
      const sliceEnd = sliceStart + pageSize
      transactions = (pageChunk || []).slice(sliceStart, sliceEnd)
      reached = true
    }

    // As a final safety, if traversal failed to produce rows, fallback to full server fetch
    if ((!transactions || transactions.length === 0) && (transactionsCount || 0) > 0) {
      const all = await fetchAllUserTransactionsServer(supabase, user.id)
      transactions = (all || []).slice(from, from + pageSize)
    }
  }

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