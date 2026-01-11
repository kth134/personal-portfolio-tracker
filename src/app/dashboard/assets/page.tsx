import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import AssetsList from '@/components/AssetsList'

export default async function AssetsPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/')

  const { data: assets } = await supabase.from('assets').select('*').eq('user_id', user.id)

  return (
    <main className="p-8">
      <h1 className="text-3xl font-bold mb-8">Assets</h1>
      <AssetsList initialAssets={assets || []} />
    </main>
  )
}