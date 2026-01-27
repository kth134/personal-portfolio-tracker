import { createClient } from '@/lib/supabase/server'
import { fetchAllUserTransactionsServer } from '@/lib/finance'
import { redirect } from 'next/navigation'
import TransactionManagement from '../../../components/TransactionManagement'

export default async function TransactionManagementPage({
  searchParams,
}: {
  searchParams: { [key: string]: string | string[] | undefined }
}) {
  redirect('/dashboard/activity?tab=transactions')
}