import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import { Tabs } from '@/components/ui/tabs'
import AccountsList from '@/components/AccountsList'
import PortfolioTabNavigation from '@/components/PortfolioTabs'

export default async function AccountsPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/')

  const { data: accounts } = await supabase.from('accounts').select('*').eq('user_id', user.id)

  return (
    <main className="p-8">
      <h1 className="text-3xl font-bold mb-8">Portfolio Construction</h1>
      <Tabs value="accounts">
        <PortfolioTabNavigation />
        <div className="mt-6">
          <AccountsList initialAccounts={accounts || []} />
        </div>
      </Tabs>
    </main>
  )
}