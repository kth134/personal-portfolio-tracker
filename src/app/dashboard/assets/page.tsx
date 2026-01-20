import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import { Tabs } from '@/components/ui/tabs'
import AssetsList from '@/components/AssetsList'
import PortfolioTabNavigation from '@/components/PortfolioTabs'

export default async function AssetsPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/')

  const { data: assets } = await supabase.from('assets').select('*').eq('user_id', user.id)

  return (
    <main className="p-8">
      <h1 className="text-3xl font-bold mb-8">Portfolio</h1>
      <Tabs value="assets">
        <PortfolioTabNavigation />
        <div className="mt-6">
          <AssetsList initialAssets={assets || []} />
        </div>
      </Tabs>
    </main>
  )
}