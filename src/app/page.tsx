import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import LoginForm from '@/components/LoginForm'
import Image from 'next/image'

export default async function Home() {
  const supabase = await createClient()
  const { data: { session } } = await supabase.auth.getSession()
  if (session) redirect('/dashboard')

  return (
    <main className="flex min-h-screen flex-col items-center justify-center p-8">
      <div className="flex flex-col items-center mb-8">
        <Image
          src="/small-logo.png"
          alt="RAIN Logo"
          width={360}
          height={120}
          unoptimized
        />
      </div>
      <LoginForm />
    </main>
  )
}