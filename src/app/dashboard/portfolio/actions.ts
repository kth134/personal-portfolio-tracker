'use server'

import { createClient } from '@/lib/supabase/server'
import { revalidatePath } from 'next/cache'
import { headers } from 'next/headers' // ← Add this import

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

  // Step 2: Build absolute URL for internal API route
  const requestHeaders = await headers()
  const host = requestHeaders.get('host') || 'localhost:3000'
  const protocol = process.env.NODE_ENV === 'development' ? 'http' : 'https'
  const apiUrl = `${protocol}://${host}/api/fetch-prices`

  // Step 3: Call the internal API route
  try {
    const response = await fetch(apiUrl, {
      method: 'GET',
      cache: 'no-store',
      headers: {
        // Forward cookies/headers if needed (Supabase auth flows through)
        cookie: requestHeaders.get('cookie') || '',
      },
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

    // Success → revalidate to show updated prices
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