'use client'

import { useState } from 'react'
import { supabaseClient } from '@/lib/supabase/client'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { useRouter } from 'next/navigation'

export default function AddTransaction({ accounts, assets }: { accounts: any[], assets: any[] }) {
  const [form, setForm] = useState({
    account_id: '', asset_id: '', date: '', type: '', quantity: '', price_per_unit: '', amount: '', fees: '', notes: ''
  })
  const router = useRouter()

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    const { error } = await supabaseClient.from('transactions').insert({ ...form, user_id: (await supabaseClient.auth.getUser()).data.user?.id })
    if (!error) router.push('/dashboard/transactions')
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-8 max-w-lg">
      <h2 className="text-2xl">Add Transaction</h2>
      <div><Label>Date</Label><Input type="date" value={form.date} onChange={e => setForm({...form, date: e.target.value})} required /></div>
      <div><Label>Account</Label>
        <Select onValueChange={v => setForm({...form, account_id: v})}>
          <SelectTrigger><SelectValue placeholder="Select account" /></SelectTrigger>
          <SelectContent>{accounts.map(a => <SelectItem key={a.id} value={a.id}>{a.name}</SelectItem>)}</SelectContent>
        </Select>
      </div>
      <div><Label>Asset</Label>
        <Select onValueChange={v => setForm({...form, asset_id: v})}>
          <SelectTrigger><SelectValue placeholder="Select asset" /></SelectTrigger>
          <SelectContent>{assets.map(a => <SelectItem key={a.id} value={a.id}>{a.ticker}</SelectItem>)}</SelectContent>
        </Select>
      </div>
      <div><Label>Type</Label>
        <Select onValueChange={v => setForm({...form, type: v})}>
          <SelectTrigger><SelectValue placeholder="Buy/Sell/etc" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="Buy">Buy</SelectItem>
            <SelectItem value="Sell">Sell</SelectItem>
            <SelectItem value="Dividend">Dividend</SelectItem>
            <SelectItem value="Fee">Fee</SelectItem>
          </SelectContent>
        </Select>
      </div>
      <div><Label>Quantity</Label><Input type="number" step="any" value={form.quantity} onChange={e => setForm({...form, quantity: e.target.value})} /></div>
      <div><Label>Price per Unit</Label><Input type="number" step="any" value={form.price_per_unit} onChange={e => setForm({...form, price_per_unit: e.target.value})} /></div>
      <div><Label>Amount</Label><Input type="number" step="any" value={form.amount} onChange={e => setForm({...form, amount: e.target.value})} /></div>
      <div><Label>Fees</Label><Input type="number" step="any" value={form.fees} onChange={e => setForm({...form, fees: e.target.value})} /></div>
      <div><Label>Notes</Label><Input value={form.notes} onChange={e => setForm({...form, notes: e.target.value})} /></div>
      <Button type="submit">Save Transaction</Button>
    </form>
  )
}