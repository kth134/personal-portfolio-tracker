import { supabaseServer } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import Link from 'next/link'
import { Button } from '@/components/ui/button'

export default async function Dashboard() {
  const supabase = await supabaseServer()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/')

  const handleLogout = async () => {
    'use server'
    const supabase = await supabaseServer()
    await supabase.auth.signOut()
    redirect('/')
  }

  return (
    <main className="p-8">
      <div className="flex justify-between items-center mb-8">
        <h1 className="text-3xl font-bold">Dashboard</h1>
        <form action={handleLogout}>
          <Button type="submit" variant="outline">Logout</Button>
        </form>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
        <Link href="/dashboard/accounts">
          <Button variant="secondary" className="w-full h-32 text-xl">Manage Accounts</Button>
        </Link>
        <Link href="/dashboard/assets">
          <Button variant="secondary" className="w-full h-32 text-xl">Manage Assets</Button>
        </Link>
        <Link href="/dashboard/transactions">
          <Button variant="secondary" className="w-full h-32 text-xl">Manage Transactions</Button>
        </Link>
        {/* Add more tiles here as we build (e.g., Holdings, Rebalance) */}
      </div>
    </main>
  )
}