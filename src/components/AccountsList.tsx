'use client'

import { useState, useEffect } from 'react'
import { supabaseClient } from '@/lib/supabase/client'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from '@/components/ui/command'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Check, ChevronsUpDown } from 'lucide-react'
import { cn } from '@/lib/utils'

type Account = { id: string; name: string; type: string; institution?: string; tax_status?: string }

export default function AccountsList({ initialAccounts }: { initialAccounts: Account[] }) {
  const [accounts, setAccounts] = useState(initialAccounts)
  const [open, setOpen] = useState(false)
  const [form, setForm] = useState({ name: '', type: '', institution: '', tax_status: '' })

  // Dynamic options
  const [institutions, setInstitutions] = useState<string[]>([])

  // Fetch unique existing institutions on mount
  useEffect(() => {
    const fetchInstitutions = async () => {
      const { data } = await supabaseClient.from('accounts').select('institution')
      const unique = [...new Set(data?.map((a: any) => a.institution).filter(Boolean))] as string[]
      setInstitutions(unique)
    }
    fetchInstitutions()
  }, [])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    const { data, error } = await supabaseClient.from('accounts').insert({ ...form }).select()
    if (!error && data) {
      setAccounts([...accounts, data[0]])
      // Refresh institutions if new one added
      if (form.institution && !institutions.includes(form.institution)) {
        setInstitutions([...institutions, form.institution])
      }
      setOpen(false)
      setForm({ name: '', type: '', institution: '', tax_status: '' })
    } else {
      console.error(error)
    }
  }

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
            <div>
              <Label>Name</Label>
              <Input value={form.name} onChange={e => setForm({...form, name: e.target.value})} required />
            </div>
            <div>
              <Label>Type</Label>
              <Select onValueChange={v => setForm({...form, type: v})} required>
                <SelectTrigger><SelectValue placeholder="Select type" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="Roth IRA">Roth IRA</SelectItem>
                  <SelectItem value="Traditional IRA">Traditional IRA</SelectItem>
                  <SelectItem value="Taxable">Taxable</SelectItem>
                  <SelectItem value="HSA">HSA</SelectItem>
                  <SelectItem value="Cold Storage">Cold Storage</SelectItem>
                  {/* Add more common types as needed */}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Institution</Label>
              <Popover>
                <PopoverTrigger asChild>
                  <Button variant="outline" role="combobox" className="w-full justify-between">
                    {form.institution || "Select or add institution"}
                    <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-full p-0">
                  <Command>
                    <CommandInput placeholder="Search or add institution..." />
                    <CommandList>
                      <CommandEmpty>No institution found. Type to create.</CommandEmpty>
                      <CommandGroup>
                        {institutions.map(inst => (
                          <CommandItem key={inst} onSelect={() => setForm({...form, institution: inst})}>
                            <Check className={cn("mr-2 h-4 w-4", form.institution === inst ? "opacity-100" : "opacity-0")} />
                            {inst}
                          </CommandItem>
                        ))}
                      </CommandGroup>
                    </CommandList>
                  </Command>
                </PopoverContent>
              </Popover>
              {/* Hidden input to capture new value on submit */}
              <Input type="hidden" value={form.institution} />
            </div>
            <div>
              <Label>Tax Status</Label>
              <Select onValueChange={v => setForm({...form, tax_status: v})}>
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
              <TableCell>{acc.institution || '-'}</TableCell>
              <TableCell>{acc.tax_status || '-'}</TableCell>
              <TableCell>
                <Button variant="outline" className="text-sm text-red-600 border-red-600 hover:bg-red-50" onClick={() => handleDelete(acc.id)}>
                  Delete
                </Button>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </>
  )
}