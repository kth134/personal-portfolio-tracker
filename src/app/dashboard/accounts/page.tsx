import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import { Tabs } from '@/components/ui/tabs'
import AccountsList from '@/components/AccountsList'
import PortfolioTabNavigation from '@/components/PortfolioTabs'
import { DashboardPageShell } from '@/components/dashboard-shell'

export default async function AccountsPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/')

  const { data: accounts } = await supabase.from('accounts').select('*').eq('user_id', user.id)

  return (
    <DashboardPageShell
      eyebrow="Construction"
      title="Accounts"
      description="Manage account inventory with the same elevated cards and table layout used throughout the dashboard experience."
    >
      <Tabs value="accounts" className="dashboard-tabs">
        <PortfolioTabNavigation />
        <div>
          <AccountsList initialAccounts={accounts || []} />
        </div>
      </Tabs>
    </DashboardPageShell>
  )
}