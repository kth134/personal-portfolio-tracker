import { supabaseClient } from '@/lib/supabase/client'
import { redirect } from 'next/navigation'
import LoginForm from '@/components/LoginForm'

export default async function Home() {
  const { data: { session } } = await supabaseClient.auth.getSession()
  if (session) redirect('/dashboard')

  return (
    <main className="flex min-h-screen flex-col items-center justify-center p-8">
      <h1 className="text-4xl font-bold mb-8">Portfolio Tracker</h1>
      <LoginForm />
    </main>
  )
}