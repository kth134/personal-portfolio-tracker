import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'  // ← new server client

export async function GET(request: Request) {
  const requestUrl = new URL(request.url)
  const code = requestUrl.searchParams.get('code')

  if (code) {
    const supabase = await createClient()
    await supabase.auth.exchangeCodeForSession(code)
  }

  // Redirect to dashboard (or wherever makes sense)
  return NextResponse.redirect(`${requestUrl.origin}/dashboard`)
}