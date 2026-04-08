import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import { Suspense } from 'react';
import StrategyTabs from './StrategyTabs';
import { DashboardPageShell } from '@/components/dashboard-shell';

export default async function StrategyPage({
  searchParams,
}: {
  searchParams: { [key: string]: string | string[] | undefined }
}) {
  const tabParam = Array.isArray(searchParams.tab) ? searchParams.tab[0] : searchParams.tab
  if (tabParam === 'rebalancing') {
    redirect('/dashboard/portfolio?tab=rebalancing')
  }

  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/')

  const { data: initialSubPortfolios } = await supabase
    .from('sub_portfolios')
    .select('*')
    .eq('user_id', user.id)

  return (
    <DashboardPageShell
      eyebrow="Construction"
      title="Sub-Portfolios"
      description="Review and edit sub-portfolio configuration in the same polished tile-based frame used across portfolio construction and analytics."
    >
      <Suspense fallback={<div className="p-8">Loading...</div>}>
        <StrategyTabs initialSubPortfolios={initialSubPortfolios || []} />
      </Suspense>
    </DashboardPageShell>
  );
}