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
    account:accounts (id, name),
    asset:assets (id, ticker, name),
    account_id,
    asset_id
  `)
  .eq('user_id', user.id)
  .order('purchase_date', { ascending: false })  // Better default: newest first

  return <TaxLotsList initialTaxLots={taxLots || []} />
}