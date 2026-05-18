import { createClient as createServiceClient } from '@supabase/supabase-js'

// Service-role Supabase client. Bypasses RLS — use ONLY in server contexts
// (route handlers, server actions, cron) where the data being written is
// non-user-scoped (e.g. price quotes) or where authorization has already
// been verified upstream.
//
// Never import this from a client component; the service-role key must
// never reach the browser bundle.
export function createServiceRoleClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url) throw new Error('NEXT_PUBLIC_SUPABASE_URL is not set')
  if (!key) throw new Error('SUPABASE_SERVICE_ROLE_KEY is not set')

  return createServiceClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  })
}
