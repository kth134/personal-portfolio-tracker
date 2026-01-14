'use server'

import { createClient } from '@/lib/supabase/server'
import { revalidatePath } from 'next/cache'

export async function refreshAssetPrices() {
  const supabase = await createClient()

  // Step 1: Get unique tickers from active holdings (unchanged)
  const { data: lots } = await supabase
    .from('tax_lots')
    .select('asset:assets(ticker)')
    .gt('remaining_quantity', 0)

  if (!lots || lots.length === 0) {
    return { success: true, message: 'No holdings to refresh prices for.' }
  }

  const uniqueTickers = [...new Set(lots.map((l: any) => (l.asset as any).ticker))] as string[]

  if (uniqueTickers.length === 0) {
    return { success: true, message: 'No tickers found in holdings.' }
  }

  // Step 2: Call the internal /api/fetch-prices route using RELATIVE path
  try {
    const response = await fetch('/api/fetch-prices', {
      method: 'GET',
      cache: 'no-store', // Ensure fresh execution
      // No need for custom headers; Supabase auth cookie is automatically forwarded in server context
    })

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}))
      console.error(`Price refresh API failed: ${response.status} ${JSON.stringify(errorData)}`)
      return {
        success: false,
        message: `Failed to refresh prices: ${response.statusText || 'API error'}`,
      }
    }

    const result = await response.json()

    if (!result.success) {
      console.error('Price refresh returned error:', result.error)
      return { success: false, message: result.error || 'Unknown error from price fetch' }
    }

    // Success → revalidate the portfolio page to show new prices
    revalidatePath('/dashboard/portfolio')

    return {
      success: true,
      message: result.inserted
        ? `Refreshed prices for ${result.inserted.crypto + result.inserted.stocks} assets.`
        : 'Prices refreshed successfully (no new data inserted).',
    }
  } catch (error) {
    console.error('Error during price refresh:', error)
    return { success: false, message: 'Failed to refresh prices due to an internal error.' }
  }
}