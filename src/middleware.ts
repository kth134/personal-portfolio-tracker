// src/middleware.ts
import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { createServerClient } from '@supabase/ssr';

export async function middleware(request: NextRequest) {
  // Only apply to API routes
  if (!request.nextUrl.pathname.startsWith('/api/')) {
    return NextResponse.next();
  }

  let response = NextResponse.next();

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value, options }) => {
            response.cookies.set(name, value, options);
          });
        },
      },
    }
  );

  // Refresh session if needed & get user
  const {
    data: { user },
    error,
  } = await supabase.auth.getUser();

  if (error || !user) {
    console.log('[Middleware] Auth failed:', error?.message || 'No user');
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  console.log('[Middleware] Auth success for user:', user.id);

  // Your existing rate limiting (unchanged)
  const clientIP =
    request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ||
    request.headers.get('x-real-ip') ||
    'unknown';
  const now = Date.now();
  const windowMs = 15 * 60 * 1000; // 15 minutes
  const maxRequests = 100;

  const rateLimitStore = (global as any).rateLimitStore || ((global as any).rateLimitStore = new Map());
  const key = `${clientIP}-${Math.floor(now / windowMs)}`;
  const current = rateLimitStore.get(key) || 0;

  if (current >= maxRequests) {
    return NextResponse.json({ error: 'Too many requests' }, { status: 429 });
  }

  rateLimitStore.set(key, current + 1);

  // Clean up old entries (unchanged)
  if (Math.random() < 0.01) {
    for (const [k, v] of rateLimitStore.entries()) {
      if (parseInt(k.split('-')[1]) * windowMs < now - windowMs) {
        rateLimitStore.delete(k);
      }
    }
  }

  // Important: Return the response with updated cookies
  return response;
}

export const config = {
  matcher: ['/api/:path*'],
};