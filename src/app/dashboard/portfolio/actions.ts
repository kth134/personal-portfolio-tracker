'use server'

import { createClient } from '@/lib/supabase/server'
import { revalidatePath } from 'next/cache'

export async function refreshAssetPrices() {
  const supabase = await createClient()

  // Step 1: Get unique tickers from active holdings (same as before)
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

  // Step 2: Call the centralized /api/fetch-prices route
  try {
    const response = await fetch(`${process.env.NEXT_PUBLIC_SUPABASE_URL}/api/fetch-prices`, {
      method: 'GET',
      headers: {
        // Forward auth cookie if needed (Supabase server client handles it via cookies)
        'Cookie': '', // Not strictly needed since createClient() in route uses cookies from request
      },
      cache: 'no-store', // Ensure fresh response
    })

    if (!response.ok) {
      const errorText = await response.text()
      console.error(`Price refresh API failed: ${response.status} ${errorText}`)
      return { success: false, message: `Failed to refresh prices: ${response.statusText}` }
    }

    const result = await response.json()

    if (!result.success) {
      console.error('Price refresh returned error:', result.error)
      return { success: false, message: result.error || 'Unknown error from price fetch' }
    }

    // Success from API route
    revalidatePath('/dashboard/portfolio')

    return {
      success: true,
      message: result.inserted
        ? `Refreshed prices for ${result.inserted.crypto + result.inserted.stocks} assets.`
        : 'Prices refreshed successfully (no new inserts needed).',
    }
  } catch (error) {
    console.error('Error calling price refresh API:', error)
    return { success: false, message: 'Failed to refresh prices due to an internal error.' }
  }
}