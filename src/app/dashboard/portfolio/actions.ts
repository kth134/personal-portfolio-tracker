'use server'

import { createClient } from '@/lib/supabase/server'
import { refreshPrices } from '@/lib/price-service'

// Thin wrapper around the shared price-refresh function. Used by the
// `Refresh prices` button on the portfolio dashboard. Cron callers hit
// /api/fetch-prices directly.
export async function refreshAssetPrices() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) throw new Error('Unauthorized')

  const result = await refreshPrices(user.id)

  if (result.inserted.crypto + result.inserted.stocks === 0) {
    return {
      success: true,
      message:
        result.failed.length > 0
          ? `No prices refreshed (${result.failed.length} tickers failed).`
          : 'No assets found; skipping price fetch.',
    }
  }

  return {
    success: true,
    message: `Refreshed ${result.inserted.crypto + result.inserted.stocks} prices${result.failed.length ? ` (${result.failed.length} failed)` : ''}.`,
  }
}
