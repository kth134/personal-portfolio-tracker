import { supabaseServer } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import TaxLotsList from '@/components/TaxLotsList'
import { formatUSD } from '@/lib/formatters';


export default async function TaxLotsPage() {
  const supabase = await supabaseServer()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/')

  const { data: taxLots } = await supabase
    .from('tax_lots')
    .select(`
      *,
      account:accounts (name),
      asset:assets (ticker, name)
    `)
    .eq('user_id', user.id)
    .order('purchase_date', { ascending: true })

  return <TaxLotsList initialTaxLots={taxLots || []} />
}