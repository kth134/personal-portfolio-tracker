'use client'

import { createBrowserClient } from '@supabase/ssr'

// This is the correct client for **browser/client components** (login form, dashboard, etc.)
// It handles auth in the browser, including signInWithPassword, signOut, etc.
// Do NOT use createServerClient here — that's for server actions/route handlers/middleware.
export function createClient() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  )
}