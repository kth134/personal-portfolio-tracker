import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import { Tabs } from '@/components/ui/tabs'
import AssetsList from '@/components/AssetsList'
import PortfolioTabNavigation from '@/components/PortfolioTabs'
import { DashboardPageShell } from '@/components/dashboard-shell'

export default async function AssetsPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/')

  const { data: assets } = await supabase.from('assets').select('*').eq('user_id', user.id)

  return (
    <DashboardPageShell
      eyebrow="Construction"
      title="Assets"
      description="Manage the asset master list, classification tags, and sub-portfolio assignments used throughout the portfolio."
    >
      <Tabs value="assets" className="dashboard-tabs">
        <PortfolioTabNavigation />
        <div>
          <AssetsList initialAssets={assets || []} />
        </div>
      </Tabs>
    </DashboardPageShell>
  )
}