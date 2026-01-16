'use client'

import { useState, useEffect } from 'react'
import { createClient } from '@/lib/supabase/client'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from '@/components/ui/command'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Checkbox } from '@/components/ui/checkbox'
import { Check, ChevronsUpDown, ArrowUpDown } from 'lucide-react'
import { cn } from '@/lib/utils'

type Account = { id: string; name: string; type: string; institution?: string; tax_status?: string }

export default function AccountsList({ initialAccounts }: { initialAccounts: Account[] }) {
  const [accounts, setAccounts] = useState(initialAccounts)
  const [open, setOpen] = useState(false)
  const [editingAccount, setEditingAccount] = useState<Account | null>(null)
  const [form, setForm] = useState({ name: '', type: '', institution: '', tax_status: '' })

  // Sorting states
  const [sortColumn, setSortColumn] = useState<keyof Account | null>(null)
  const [sortDirection, setSortDirection] = useState<'asc' | 'desc'>('asc')

  // Search & mass actions
  const [search, setSearch] = useState('')
  const [selectedAccounts, setSelectedAccounts] = useState<string[]>([])
  const [selectAll, setSelectAll] = useState(false)
  const [bulkEditOpen, setBulkEditOpen] = useState(false)
  const [bulkForm, setBulkForm] = useState({
    type: '',
    tax_status: ''
  })

  // Dynamic options
  const [institutions, setInstitutions] = useState<string[]>([])
  const [popoverOpen, setPopoverOpen] = useState(false)

  // Fetch unique existing institutions on mount
  useEffect(() => {
    const fetchInstitutions = async () => {
      const supabase = createClient()
      const { data } = await supabase.from('accounts').select('institution')
      const unique = [...new Set(data?.map((a: any) => a.institution).filter(Boolean))] as string[]
      setInstitutions(unique)
    }
    fetchInstitutions()
  }, [])

  // Set form values when editing
  useEffect(() => {
    if (editingAccount) {
      setForm({
        name: editingAccount.name,
        type: editingAccount.type,
        institution: editingAccount.institution || '',
        tax_status: editingAccount.tax_status || ''
      })
      setOpen(true)
    }
  }, [editingAccount])

  const handleSort = (column: keyof Account) => {
    if (sortColumn === column) {
      setSortDirection(sortDirection === 'asc' ? 'desc' : 'asc')
    } else {
      setSortColumn(column)
      setSortDirection('asc')
    }
  }

  const sortedAccounts = [...accounts].sort((a, b) => {
    if (!sortColumn) return 0
    const aVal = a[sortColumn] ?? ''
    const bVal = b[sortColumn] ?? ''
    if (typeof aVal === 'string' && typeof bVal === 'string') {
      return sortDirection === 'asc' ? aVal.localeCompare(bVal) : bVal.localeCompare(aVal)
    }
    if (aVal < bVal) return sortDirection === 'asc' ? -1 : 1
    if (aVal > bVal) return sortDirection === 'asc' ? 1 : -1
    return 0
  }).filter(account => {
    if (!search) return true
    const low = search.toLowerCase()
    return (
      account.name.toLowerCase().includes(low) ||
      account.type.toLowerCase().includes(low) ||
      (account.institution || '').toLowerCase().includes(low) ||
      (account.tax_status || '').toLowerCase().includes(low)
    )
  })

  // Update select all
  useEffect(() => {
    const allSelected = sortedAccounts.length > 0 && selectedAccounts.length === sortedAccounts.length
    setSelectAll(allSelected)
  }, [selectedAccounts, sortedAccounts])

  const handleSelectAccount = (id: string, checked: boolean) => {
    if (checked) {
      setSelectedAccounts(prev => [...prev, id])
    } else {
      setSelectedAccounts(prev => prev.filter(accId => accId !== id))
    }
  }

  const handleSelectAll = (checked: boolean) => {
    if (checked) {
      setSelectedAccounts(sortedAccounts.map(acc => acc.id))
    } else {
      setSelectedAccounts([])
    }
    setSelectAll(checked)
  }

  const handleBulkDelete = async () => {
    if (selectedAccounts.length === 0) return
    if (!confirm(`Delete ${selectedAccounts.length} accounts? This cannot be undone.`)) return

    const supabase = createClient()
    try {
      await supabase.from('accounts').delete().in('id', selectedAccounts)
      setAccounts(accounts.filter(a => !selectedAccounts.includes(a.id)))
      setSelectedAccounts([])
      setSelectAll(false)
    } catch (err: any) {
      alert('Bulk delete failed: ' + err.message)
    }
  }

  const handleBulkEdit = () => {
    if (selectedAccounts.length === 0) return
    setBulkEditOpen(true)
  }

  const handleBulkEditSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (selectedAccounts.length === 0) return

    const supabase = createClient()
    const updateData: any = {}
    if (bulkForm.type) updateData.type = bulkForm.type
    if (bulkForm.tax_status) updateData.tax_status = bulkForm.tax_status

    if (Object.keys(updateData).length === 0) {
      alert('Please select at least one field to update')
      return
    }

    try {
      await supabase.from('accounts').update(updateData).in('id', selectedAccounts)
      // Update local state
      setAccounts(accounts.map(acc => 
        selectedAccounts.includes(acc.id) ? { ...acc, ...updateData } : acc
      ))
      setBulkEditOpen(false)
      setBulkForm({ type: '', tax_status: '' })
      setSelectedAccounts([])
      setSelectAll(false)
    } catch (err: any) {
      alert('Bulk edit failed: ' + err.message)
    }
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    const supabase = createClient()
    let data, error
    if (editingAccount) {
      ({ data, error } = await supabase.from('accounts').update({ ...form }).eq('id', editingAccount.id).select())
    } else {
      ({ data, error } = await supabase.from('accounts').insert({ ...form }).select())
    }
    if (!error && data) {
      if (editingAccount) {
        setAccounts(accounts.map(a => a.id === editingAccount.id ? data[0] : a))
      } else {
        setAccounts([...accounts, data[0]])
      }
      // Refresh institutions if new one added
      if (form.institution && !institutions.includes(form.institution)) {
        setInstitutions([...institutions, form.institution])
      }
      setOpen(false)
      setEditingAccount(null)
      setForm({ name: '', type: '', institution: '', tax_status: '' })
    } else {
      console.error(error)
    }
  }

  const handleDelete = async (id: string) => {
    const supabase = createClient()
    await supabase.from('accounts').delete().eq('id', id)
    setAccounts(accounts.filter(a => a.id !== id))
  }

  const handleEdit = (account: Account) => {
    setEditingAccount(account)
  }

  return (
    <>
      <Dialog open={open} onOpenChange={(isOpen) => {
        setOpen(isOpen)
        if (!isOpen) setEditingAccount(null)
      }}>
        <DialogTrigger asChild>
          <Button className="mb-4">Add Account</Button>
        </DialogTrigger>
        <DialogContent>
          <DialogHeader><DialogTitle>{editingAccount ? 'Edit Account' : 'Add Account'}</DialogTitle></DialogHeader>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <Label>Name</Label>
              <Input value={form.name} onChange={e => setForm({...form, name: e.target.value})} required />
            </div>
            <div>
              <Label>Type</Label>
              <Select value={form.type} onValueChange={v => setForm({...form, type: v})} required>
                <SelectTrigger><SelectValue placeholder="Select type" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="Roth IRA">Roth IRA</SelectItem>
                  <SelectItem value="Traditional IRA">Traditional IRA</SelectItem>
                  <SelectItem value="401k">401k</SelectItem>
                  <SelectItem value="Brokerage">Brokerage</SelectItem>
                  <SelectItem value="HSA">HSA</SelectItem>
                  <SelectItem value="Cold Storage">Cold Storage</SelectItem>
                  {/* Add more common types as needed */}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Institution</Label>
              <Popover open={popoverOpen} onOpenChange={setPopoverOpen}>
                <PopoverTrigger asChild>
                  <Button variant="outline" role="combobox" className="w-full justify-between">
                    {form.institution || "Select or add institution"}
                    <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-full p-0">
                  <Command>
                    <CommandInput 
                      placeholder="Search or add institution..." 
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' && e.currentTarget.value.trim()) {
                          const newInst = e.currentTarget.value.trim()
                          if (!institutions.includes(newInst)) {
                            setInstitutions([...institutions, newInst])
                          }
                          setForm({ ...form, institution: newInst })
                          setPopoverOpen(false)
                        }
                      }}
                    />
                    <CommandList>
                      <CommandEmpty>
                        {institutions.length === 0 ? "Type to create new" : "No match — press Enter to create"}
                      </CommandEmpty>
                      <CommandGroup>
                        {institutions.map(inst => (
                          <CommandItem 
                            key={inst} 
                            onSelect={() => {
                              setForm({ ...form, institution: inst })
                              setPopoverOpen(false)
                            }}
                          >
                            <Check className={cn("mr-2 h-4 w-4", form.institution === inst ? "opacity-100" : "opacity-0")} />
                            {inst}
                          </CommandItem>
                        ))}
                      </CommandGroup>
                    </CommandList>
                  </Command>
                </PopoverContent>
              </Popover>
            </div>
            <div>
              <Label>Tax Status</Label>
              <Select value={form.tax_status} onValueChange={v => setForm({...form, tax_status: v})}>
                <SelectTrigger><SelectValue placeholder="Select status" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="Tax-Advantaged">Tax-Advantaged</SelectItem>
                  <SelectItem value="Taxable">Taxable</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <Button type="submit">Save</Button>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog open={bulkEditOpen} onOpenChange={setBulkEditOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Bulk Edit {selectedAccounts.length} Accounts</DialogTitle>
          </DialogHeader>
          <form onSubmit={handleBulkEditSubmit} className="space-y-4">
            <div>
              <Label>Type (leave empty to keep current)</Label>
              <Select value={bulkForm.type} onValueChange={v => setBulkForm({...bulkForm, type: v})}>
                <SelectTrigger>
                  <SelectValue placeholder="Update type for all selected" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="Roth IRA">Roth IRA</SelectItem>
                  <SelectItem value="Traditional IRA">Traditional IRA</SelectItem>
                  <SelectItem value="401k">401k</SelectItem>
                  <SelectItem value="Brokerage">Brokerage</SelectItem>
                  <SelectItem value="HSA">HSA</SelectItem>
                  <SelectItem value="Cold Storage">Cold Storage</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Tax Status (leave empty to keep current)</Label>
              <Select value={bulkForm.tax_status} onValueChange={v => setBulkForm({...bulkForm, tax_status: v})}>
                <SelectTrigger>
                  <SelectValue placeholder="Update tax status for all selected" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="Tax-Advantaged">Tax-Advantaged</SelectItem>
                  <SelectItem value="Taxable">Taxable</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="flex gap-2">
              <Button type="submit">Update Selected</Button>
              <Button type="button" variant="outline" onClick={() => setBulkEditOpen(false)}>Cancel</Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>

      <div className="flex gap-4 items-center mb-4">
        <Input
          placeholder="Search accounts..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="w-64"
        />

        {selectedAccounts.length > 0 && (
          <div className="flex gap-2 items-center">
            <span className="text-sm text-muted-foreground">
              {selectedAccounts.length} selected
            </span>
            <Button variant="outline" size="sm" onClick={handleBulkEdit}>
              Edit Selected
            </Button>
            <Button variant="destructive" size="sm" onClick={handleBulkDelete}>
              Delete Selected
            </Button>
          </div>
        )}
      </div>

      <div className="overflow-x-auto">
        <Table>
        <TableHeader>
          <TableRow>
            <TableHead>
              <Checkbox
                checked={selectAll}
                onCheckedChange={handleSelectAll}
              />
            </TableHead>
            <TableHead className="cursor-pointer" onClick={() => handleSort('name')}>
              Name <ArrowUpDown className="ml-2 h-4 w-4 inline" />
            </TableHead>
            <TableHead className="cursor-pointer" onClick={() => handleSort('type')}>
              Type <ArrowUpDown className="ml-2 h-4 w-4 inline" />
            </TableHead>
            <TableHead className="cursor-pointer" onClick={() => handleSort('institution')}>
              Institution <ArrowUpDown className="ml-2 h-4 w-4 inline" />
            </TableHead>
            <TableHead className="cursor-pointer" onClick={() => handleSort('tax_status')}>
              Tax Status <ArrowUpDown className="ml-2 h-4 w-4 inline" />
            </TableHead>
            <TableHead>Actions</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {sortedAccounts.map(acc => (
            <TableRow key={acc.id}>
              <TableCell>
                <Checkbox
                  checked={selectedAccounts.includes(acc.id)}
                  onCheckedChange={(checked) => handleSelectAccount(acc.id, checked as boolean)}
                />
              </TableCell>
              <TableCell className="break-words whitespace-normal max-w-xs">{acc.name}</TableCell>
              <TableCell>{acc.type}</TableCell>
              <TableCell className="break-words whitespace-normal max-w-xs">{acc.institution || '-'}</TableCell>
              <TableCell>{acc.tax_status || '-'}</TableCell>
              <TableCell className="space-x-2">
                <Button variant="outline" className="text-blue-600 border-blue-600 hover:bg-blue-50 h-8 px-3 text-xs" onClick={() => handleEdit(acc)}>
                  Edit
                </Button>
                <Button variant="outline" className="text-red-600 border-red-600 hover:bg-red-50 h-8 px-3 text-xs" onClick={() => handleDelete(acc.id)}>
                  Delete
                </Button>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
      </div>
    </>
  )
}