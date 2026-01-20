import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import { Tabs } from '@/components/ui/tabs'
import SubPortfoliosList from '@/components/SubPortfoliosList'
import PortfolioTabNavigation from '@/components/PortfolioTabs'

export default async function SubPortfoliosPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/')

  const { data: initialSubPortfolios } = await supabase
    .from('sub_portfolios')
    .select('*')
    .eq('user_id', user.id)

  return (
    <main className="p-8">
      <h1 className="text-3xl font-bold mb-8">Portfolio</h1>
      <Tabs value="subportfolios">
        <PortfolioTabNavigation />
        <div className="mt-6">
          <SubPortfoliosList initialSubPortfolios={initialSubPortfolios || []} />
        </div>
      </Tabs>
    </main>
  )
}