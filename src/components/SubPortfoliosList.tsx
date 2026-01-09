'use client'

import { useState, useEffect } from 'react'
import { supabaseClient } from '@/lib/supabase/client'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { ArrowUpDown } from 'lucide-react'

type SubPortfolio = {
  id: string
  name: string
  target_allocation: number | null
  objective: string | null
  manager: 'self-managed' | 'advisor-managed' | null
  notes: string | null
}

export default function SubPortfoliosList({ initialSubPortfolios }: { initialSubPortfolios: SubPortfolio[] }) {
  const [subPortfolios, setSubPortfolios] = useState(initialSubPortfolios)
  const [open, setOpen] = useState(false)
  const [editingSub, setEditingSub] = useState<SubPortfolio | null>(null)
  const [form, setForm] = useState({
    name: '',
    target_allocation: '',
    objective: '',
    manager: '',
    notes: ''
  })

  // Sorting
  const [sortColumn, setSortColumn] = useState<keyof SubPortfolio | null>(null)
  const [sortDirection, setSortDirection] = useState<'asc' | 'desc'>('asc')

  useEffect(() => {
    if (editingSub) {
      setForm({
        name: editingSub.name,
        target_allocation: editingSub.target_allocation?.toString() || '',
        objective: editingSub.objective || '',
        manager: editingSub.manager || '',
        notes: editingSub.notes || ''
      })
      setOpen(true)
    }
  }, [editingSub])

  const handleSort = (column: keyof SubPortfolio) => {
    if (sortColumn === column) {
      setSortDirection(sortDirection === 'asc' ? 'desc' : 'asc')
    } else {
      setSortColumn(column)
      setSortDirection('asc')
    }
  }

  const sortedSubs = [...subPortfolios].sort((a, b) => {
    if (!sortColumn) return 0
    const aVal = a[sortColumn] ?? ''
    const bVal = b[sortColumn] ?? ''
    if (typeof aVal === 'string' && typeof bVal === 'string') {
      return sortDirection === 'asc' ? aVal.localeCompare(bVal) : bVal.localeCompare(aVal)
    }
    if (aVal < bVal) return sortDirection === 'asc' ? -1 : 1
    if (aVal > bVal) return sortDirection === 'asc' ? 1 : -1
    return 0
  })

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    const allocNum = Number(form.target_allocation)
    if (allocNum < 0 || allocNum > 100) {
      alert('Target allocation must be 0-100')
      return
    }
    let data, error
    const submitData = {
      name: form.name,
      target_allocation: allocNum || null,
      objective: form.objective || null,
      manager: form.manager || null,
      notes: form.notes || null
    }
    if (editingSub) {
      ({ data, error } = await supabaseClient.from('sub_portfolios').update(submitData).eq('id', editingSub.id).select())
    } else {
      ({ data, error } = await supabaseClient.from('sub_portfolios').insert(submitData).select())
    }
    if (!error && data) {
      if (editingSub) {
        setSubPortfolios(subPortfolios.map(s => s.id === editingSub.id ? data[0] : s))
      } else {
        setSubPortfolios([...subPortfolios, data[0]])
      }
      setOpen(false)
      setEditingSub(null)
      setForm({ name: '', target_allocation: '', objective: '', manager: '', notes: '' })
    } else {
      console.error(error)
    }
  }

  const handleDelete = async (id: string) => {
    await supabaseClient.from('sub_portfolios').delete().eq('id', id)
    setSubPortfolios(subPortfolios.filter(s => s.id !== id))
  }

  return (
    <>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogTrigger asChild>
          <Button className="mb-4">Add Sub-Portfolio</Button>
        </DialogTrigger>
        <DialogContent>
          <DialogHeader><DialogTitle>{editingSub ? 'Edit' : 'Add'} Sub-Portfolio</DialogTitle></DialogHeader>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <Label>Name</Label>
              <Input value={form.name} onChange={e => setForm({...form, name: e.target.value})} required />
            </div>
            <div>
              <Label>Target Allocation (%)</Label>
              <Input type="number" min="0" max="100" value={form.target_allocation} onChange={e => setForm({...form, target_allocation: e.target.value})} />
            </div>
            <div>
              <Label>Objective</Label>
              <Input value={form.objective} onChange={e => setForm({...form, objective: e.target.value})} />
            </div>
            <div>
              <Label>Manager</Label>
              <Select value={form.manager} onValueChange={v => setForm({...form, manager: v})}>
                <SelectTrigger><SelectValue placeholder="Select manager" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="self-managed">Self-Managed</SelectItem>
                  <SelectItem value="advisor-managed">Advisor-Managed</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Notes</Label>
              <Input value={form.notes} onChange={e => setForm({...form, notes: e.target.value})} />
            </div>
            <Button type="submit">Save</Button>
          </form>
        </DialogContent>
      </Dialog>

      <Table>
        <TableHeader>
          <TableRow>
            <TableHead onClick={() => handleSort('name')}>Name <ArrowUpDown className="ml-2 h-4 w-4 inline" /></TableHead>
            <TableHead onClick={() => handleSort('target_allocation')}>Target % <ArrowUpDown className="ml-2 h-4 w-4 inline" /></TableHead>
            <TableHead onClick={() => handleSort('objective')}>Objective <ArrowUpDown className="ml-2 h-4 w-4 inline" /></TableHead>
            <TableHead onClick={() => handleSort('manager')}>Manager <ArrowUpDown className="ml-2 h-4 w-4 inline" /></TableHead>
            <TableHead onClick={() => handleSort('notes')}>Notes <ArrowUpDown className="ml-2 h-4 w-4 inline" /></TableHead>
            <TableHead>Actions</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {sortedSubs.map(sub => (
            <TableRow key={sub.id}>
              <TableCell>{sub.name}</TableCell>
              <TableCell>{sub.target_allocation || '-'}</TableCell>
              <TableCell>{sub.objective || '-'}</TableCell>
              <TableCell>{sub.manager || '-'}</TableCell>
              <TableCell>{sub.notes || '-'}</TableCell>
              <TableCell>
                <Button variant="outline" onClick={() => setEditingSub(sub)}>Edit</Button>
                <Button variant="destructive" onClick={() => handleDelete(sub.id)}>Delete</Button>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </>
  )
}