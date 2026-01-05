import { supabaseClient } from '@/lib/supabase/client'
import { redirect } from 'next/navigation'
import Link from 'next/link'
import LoginForm from '@/components/LoginForm'
import { Button } from '@/components/ui/button'

export default async function Home() {
  const { data: { session } } = await supabaseClient.auth.getSession()
  if (session) redirect('/dashboard')
  return (
    <main className="flex min-h-screen flex-col items-center justify-center bg-gray-900 text-white p-8">
      <h1 className="text-4xl font-bold mb-12">Personal Portfolio Tracker</h1>
      <LoginForm />
      <Link href="/dashboard/transactions">
        <Button variant="secondary" className="w-full h-32 text-xl">Manage Transactions</Button>
      </Link>
      <p className="mt-8 text-sm text-gray-400">Sign up or log in to get started.</p>
    </main>
  )
}