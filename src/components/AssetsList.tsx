'use client'

import { useState } from 'react'
import { supabaseClient } from '@/lib/supabase/client'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog'

type Asset = { 
  id: string; 
  ticker: string; 
  name?: string; 
  asset_class: string; 
  sub_portfolio: string; 
  notes?: string 
}

export default function AssetsList({ initialAssets }: { initialAssets: Asset[] }) {
  const [assets, setAssets] = useState(initialAssets)
  const [open, setOpen] = useState(false)
  const [form, setForm] = useState({ ticker: '', name: '', asset_class: '', sub_portfolio: '', notes: '' })

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    const { data, error } = await supabaseClient.from('assets').insert({ ...form }).select()
    if (!error && data) {
      setAssets([...assets, data[0]])
      setOpen(false)
      setForm({ ticker: '', name: '', asset_class: '', sub_portfolio: '', notes: '' })
    } else {
      console.error(error)  // Add toast later
    }
  }

  const handleDelete = async (id: string) => {
    await supabaseClient.from('assets').delete().eq('id', id)
    setAssets(assets.filter(a => a.id !== id))
  }

  return (
    <>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogTrigger asChild>
          <Button className="mb-4">Add Asset</Button>
        </DialogTrigger>
        <DialogContent>
          <DialogHeader><DialogTitle>Add Asset</DialogTitle></DialogHeader>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div><Label>Ticker (unique)</Label><Input value={form.ticker} onChange={e => setForm({...form, ticker: e.target.value.toUpperCase()})} required /></div>
            <div><Label>Name</Label><Input value={form.name} onChange={e => setForm({...form, name: e.target.value})} /></div>
            <div><Label>Asset Class (e.g., Public Equity, Bitcoin)</Label><Input value={form.asset_class} onChange={e => setForm({...form, asset_class: e.target.value})} required /></div>
            <div><Label>Sub-Portfolio (e.g., Globally Diversified)</Label><Input value={form.sub_portfolio} onChange={e => setForm({...form, sub_portfolio: e.target.value})} required /></div>
            <div><Label>Notes</Label><Input value={form.notes} onChange={e => setForm({...form, notes: e.target.value})} /></div>
            <Button type="submit">Save</Button>
          </form>
        </DialogContent>
      </Dialog>

      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Ticker</TableHead>
            <TableHead>Name</TableHead>
            <TableHead>Asset Class</TableHead>
            <TableHead>Sub-Portfolio</TableHead>
            <TableHead>Notes</TableHead>
            <TableHead>Actions</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {assets.map(asset => (
            <TableRow key={asset.id}>
              <TableCell>{asset.ticker}</TableCell>
              <TableCell>{asset.name}</TableCell>
              <TableCell>{asset.asset_class}</TableCell>
              <TableCell>{asset.sub_portfolio}</TableCell>
              <TableCell>{asset.notes}</TableCell>
              <TableCell>
                <Button className="bg-red-600 hover:bg-red-700 text-white text-sm px-2 py-1" onClick={() => handleDelete(asset.id)}>Delete</Button>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </>
  )
}