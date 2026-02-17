// src/proxy.ts
import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
import { createServerClient } from '@supabase/ssr'

export async function proxy(request: NextRequest) {
  // Only protect API routes
  if (!request.nextUrl.pathname.startsWith('/api/')) {
    return NextResponse.next()
  }

  // Create response object early so we can modify cookies
  const response = NextResponse.next()

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll()
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value, options }) => {
            response.cookies.set(name, value, options)
          })
        },
      },
    }
  )

  // This auto-refreshes the session if needed
  const { data: { user }, error } = await supabase.auth.getUser()

  if (error || !user) {
    console.log('[Proxy] Auth failed:', error?.message || 'No user found')
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  console.log('[Proxy] Auth success for user ID:', user.id)

  // ── Existing rate limiting ──
  const clientIP =
    request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ||
    request.headers.get('x-real-ip') ||
    'unknown'
  const now = Date.now()
  const windowMs = 15 * 60 * 1000 // 15 minutes
  const maxRequests = 100

  const rateLimitStore = (global as any).rateLimitStore || ((global as any).rateLimitStore = new Map())
  const key = `${clientIP}-${Math.floor(now / windowMs)}`
  const current = rateLimitStore.get(key) || 0

  if (current >= maxRequests) {
    return NextResponse.json({ error: 'Too many requests' }, { status: 429 })
  }

  rateLimitStore.set(key, current + 1)

  if (Math.random() < 0.01) {
    for (const [k] of rateLimitStore.entries()) {
      if (parseInt(k.split('-')[1]) * windowMs < now - windowMs) {
        rateLimitStore.delete(k)
      }
    }
  }

  // Return the response WITH updated cookies
  return response
}

export const config = {
  matcher: ['/api/:path*'],
}
