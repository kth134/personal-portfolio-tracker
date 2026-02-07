import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import { Suspense } from 'react';
import StrategyTabs from './StrategyTabs';

export default async function StrategyPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/')

  const { data: initialSubPortfolios } = await supabase
    .from('sub_portfolios')
    .select('*')
    .eq('user_id', user.id)

  const { data: initialAccounts } = await supabase
    .from('accounts')
    .select('*')
    .eq('user_id', user.id)

  const { data: initialAssets } = await supabase
    .from('assets')
    .select('*')
    .eq('user_id', user.id)

  return (
    <main className="p-8">
      <h1 className="text-3xl font-bold mb-8">Portfolio Construction</h1>
      <Suspense fallback={<div className="p-8">Loading...</div>}>
        <StrategyTabs initialSubPortfolios={initialSubPortfolios || []} initialAccounts={initialAccounts || []} initialAssets={initialAssets || []} />
      </Suspense>
    </main>
  );
}