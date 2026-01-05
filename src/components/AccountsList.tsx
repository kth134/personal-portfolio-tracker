'use client'

import { useState } from 'react'
import { supabaseClient } from '@/lib/supabase/client'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog'

type Account = { id: string; name: string; type: string; institution?: string; tax_status?: string }

export default function AccountsList({ initialAccounts }: { initialAccounts: Account[] }) {
  const [accounts, setAccounts] = useState(initialAccounts)
  const [open, setOpen] = useState(false)
  const [form, setForm] = useState({ name: '', type: '', institution: '', tax_status: '' })

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    const { data, error } = await supabaseClient.from('accounts').insert({ ...form }).select()
    if (!error && data) {
      setAccounts([...accounts, data[0]])
      setOpen(false)
      setForm({ name: '', type: '', institution: '', tax_status: '' })
    }
  }

  // Delete stub (expand later)
  const handleDelete = async (id: string) => {
    await supabaseClient.from('accounts').delete().eq('id', id)
    setAccounts(accounts.filter(a => a.id !== id))
  }

  return (
    <>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogTrigger asChild>
          <Button className="mb-4">Add Account</Button>
        </DialogTrigger>
        <DialogContent>
          <DialogHeader><DialogTitle>Add Account</DialogTitle></DialogHeader>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div><Label>Name</Label><Input value={form.name} onChange={e => setForm({...form, name: e.target.value})} required /></div>
            <div><Label>Type</Label><Input value={form.type} onChange={e => setForm({...form, type: e.target.value})} required /></div>
            <div><Label>Institution</Label><Input value={form.institution} onChange={e => setForm({...form, institution: e.target.value})} /></div>
            <div><Label>Tax Status</Label><Input value={form.tax_status} onChange={e => setForm({...form, tax_status: e.target.value})} /></div>
            <Button type="submit">Save</Button>
          </form>
        </DialogContent>
      </Dialog>

      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Name</TableHead>
            <TableHead>Type</TableHead>
            <TableHead>Institution</TableHead>
            <TableHead>Tax Status</TableHead>
            <TableHead>Actions</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {accounts.map(acc => (
            <TableRow key={acc.id}>
              <TableCell>{acc.name}</TableCell>
              <TableCell>{acc.type}</TableCell>
              <TableCell>{acc.institution}</TableCell>
              <TableCell>{acc.tax_status}</TableCell>
              <TableCell><Button variant={"destructive" as any} className="h-8 px-3 text-xs" onClick={() => handleDelete(acc.id)}>Delete</Button></TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </>
  )
}