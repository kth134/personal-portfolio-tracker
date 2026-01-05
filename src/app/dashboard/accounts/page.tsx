import { supabaseServer } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import AccountsList from '@/components/AccountsList'

export default async function AccountsPage() {
  const supabase = await supabaseServer()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/')

  const { data: accounts } = await supabase.from('accounts').select('*').eq('user_id', user.id)

  return (
    <main className="p-8">
      <h1 className="text-3xl font-bold mb-8">Accounts</h1>
      <AccountsList initialAccounts={accounts || []} />
    </main>
  )
}