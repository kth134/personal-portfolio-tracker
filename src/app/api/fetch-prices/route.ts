import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { refreshPrices } from '@/lib/price-service'

// GET /api/fetch-prices
//
// Two callers:
//   - Vercel daily cron — must send `Authorization: Bearer ${CRON_SECRET}`.
//     Refreshes every distinct ticker across all users (userId = null).
//   - Authenticated browser request — refreshes only the calling user's
//     tickers.
//
// The proxy.ts middleware passes cron requests through without an auth
// check; everything else must have a Supabase session.
export async function GET(request: NextRequest) {
  try {
    const cronSecret = process.env.CRON_SECRET
    const authHeader = request.headers.get('authorization')
    const isCronCall = !!cronSecret && authHeader === `Bearer ${cronSecret}`

    let userId: string | null = null
    if (!isCronCall) {
      const supabase = await createClient()
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) {
        return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 })
      }
      userId = user.id
    }

    const result = await refreshPrices(userId)
    return NextResponse.json(result)
  } catch (error) {
    console.error('Price fetch error:', error)
    return NextResponse.json(
      { success: false, error: (error as Error).message },
      { status: 500 },
    )
  }
}

export async function POST(request: NextRequest) {
  return GET(request)
}
