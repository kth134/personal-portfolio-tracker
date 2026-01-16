import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import LoginForm from '@/components/LoginForm'

export default async function Home() {
  const supabase = await createClient()
  const { data: { session } } = await supabase.auth.getSession()
  if (session) redirect('/dashboard')

  return (
    <main className="flex min-h-screen flex-col items-center justify-center p-8">
      <div className="flex flex-col items-center mb-8">
        <img src="/logo.png" alt="RAIN Logo" className="h-16 mb-4" />
        <h1 className="text-4xl font-bold">RAIN Portfolio Management</h1>
      </div>
      <LoginForm />
    </main>
  )
}