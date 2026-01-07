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
import { Check, ChevronsUpDown, ArrowUpDown } from 'lucide-react'
import { cn } from '@/lib/utils'

type Asset = { 
  id: string; 
  ticker: string; 
  name?: string; 
  sub_portfolio: string; 
  notes?: string;
  asset_type?: string;
  asset_subtype?: string;
  geography?: string;
  factor_tag?: string;
  size_tag?: string;
}

export default function AssetsList({ initialAssets }: { initialAssets: Asset[] }) {
  const [assets, setAssets] = useState(initialAssets)
  const [open, setOpen] = useState(false)
  const [editingAsset, setEditingAsset] = useState<Asset | null>(null)
  const [form, setForm] = useState({ 
    ticker: '', 
    name: '', 
    sub_portfolio: '', 
    notes: '',
    asset_type: '',
    asset_subtype: '',
    geography: '',
    factor_tag: '',
    size_tag: ''
  })

  // Sorting states
  const [sortColumn, setSortColumn] = useState<keyof Asset | null>(null)
  const [sortDirection, setSortDirection] = useState<'asc' | 'desc'>('asc')

  // Keep creatable logic only for sub_portfolio
  const [subPortfolios, setSubPortfolios] = useState<string[]>([])
  const [subPortfolioPopoverOpen, setSubPortfolioPopoverOpen] = useState(false)

  // Fetch unique existing sub-portfolios on mount
  useEffect(() => {
    const fetchOptions = async () => {
      const { data } = await supabaseClient.from('assets').select('sub_portfolio')
      const uniqueSubPortfolios = [...new Set(data?.map((a: any) => a.sub_portfolio).filter(Boolean))] as string[]
      setSubPortfolios(uniqueSubPortfolios)
    }
    fetchOptions()
  }, [])

  // Set form values when editing
  useEffect(() => {
    if (editingAsset) {
      setForm({
        ticker: editingAsset.ticker,
        name: editingAsset.name || '',
        sub_portfolio: editingAsset.sub_portfolio,
        notes: editingAsset.notes || '',
        asset_type: editingAsset.asset_type || '',
        asset_subtype: editingAsset.asset_subtype || '',
        geography: editingAsset.geography || '',
        factor_tag: editingAsset.factor_tag || '',
        size_tag: editingAsset.size_tag || ''
      })
      setOpen(true)
    }
  }, [editingAsset])

  const handleSort = (column: keyof Asset) => {
    if (sortColumn === column) {
      setSortDirection(sortDirection === 'asc' ? 'desc' : 'asc')
    } else {
      setSortColumn(column)
      setSortDirection('asc')
    }
  }

  const sortedAssets = [...assets].sort((a, b) => {
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
    let data, error
    if (editingAsset) {
      ({ data, error } = await supabaseClient.from('assets').update({ ...form }).eq('id', editingAsset.id).select())
    } else {
      ({ data, error } = await supabaseClient.from('assets').insert({ ...form }).select())
    }
    if (!error && data) {
      if (editingAsset) {
        setAssets(assets.map(a => a.id === editingAsset.id ? data[0] : a))
      } else {
        setAssets([...assets, data[0]])
      }
      // Refresh sub_portfolio list if new value added
      if (form.sub_portfolio && !subPortfolios.includes(form.sub_portfolio)) {
        setSubPortfolios([...subPortfolios, form.sub_portfolio])
      }
      setOpen(false)
      setEditingAsset(null)
      setForm({ 
        ticker: '', 
        name: '', 
        sub_portfolio: '', 
        notes: '',
        asset_type: '',
        asset_subtype: '',
        geography: '',
        factor_tag: '',
        size_tag: ''
      })
    } else {
      console.error(error)
    }
  }

  const handleDelete = async (id: string) => {
    await supabaseClient.from('assets').delete().eq('id', id)
    setAssets(assets.filter(a => a.id !== id))
  }

  const handleEdit = (asset: Asset) => {
    setEditingAsset(asset)
  }

  return (
    <>
      <Dialog open={open} onOpenChange={(isOpen) => {
        setOpen(isOpen)
        if (!isOpen) setEditingAsset(null)
      }}>
        <DialogTrigger asChild>
          <Button className="mb-4">Add Asset</Button>
        </DialogTrigger>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader><DialogTitle>{editingAsset ? 'Edit Asset' : 'Add Asset'}</DialogTitle></DialogHeader>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <Label>Ticker (unique)</Label>
              <Input value={form.ticker} onChange={e => setForm({...form, ticker: e.target.value.toUpperCase()})} required />
            </div>
            <div>
              <Label>Name</Label>
              <Input value={form.name} onChange={e => setForm({...form, name: e.target.value})} />
            </div>

            <div>
              <Label>Sub-Portfolio</Label>
              <Popover open={subPortfolioPopoverOpen} onOpenChange={setSubPortfolioPopoverOpen}>
                <PopoverTrigger asChild>
                  <Button variant="outline" role="combobox" className="w-full justify-between">
                    {form.sub_portfolio || "Select or add sub-portfolio"}
                    <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-full p-0">
                  <Command>
                    <CommandInput 
                      placeholder="Search or add sub-portfolio..." 
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' && e.currentTarget.value.trim()) {
                          const newSub = e.currentTarget.value.trim()
                          if (!subPortfolios.includes(newSub)) {
                            setSubPortfolios([...subPortfolios, newSub])
                          }
                          setForm({ ...form, sub_portfolio: newSub })
                          setSubPortfolioPopoverOpen(false)
                        }
                      }}
                    />
                    <CommandList>
                      <CommandEmpty>
                        {subPortfolios.length === 0 ? "Type to create new" : "No match — press Enter to create"}
                      </CommandEmpty>
                      <CommandGroup>
                        {subPortfolios.map(sub => (
                          <CommandItem 
                            key={sub} 
                            onSelect={() => {
                              setForm({ ...form, sub_portfolio: sub })
                              setSubPortfolioPopoverOpen(false)
                            }}
                          >
                            <Check className={cn("mr-2 h-4 w-4", form.sub_portfolio === sub ? "opacity-100" : "opacity-0")} />
                            {sub}
                          </CommandItem>
                        ))}
                      </CommandGroup>
                    </CommandList>
                  </Command>
                </PopoverContent>
              </Popover>
            </div>

            {/* Structured tags - fixed selects */}
            <div>
              <Label>Asset Type</Label>
              <Select value={form.asset_type} onValueChange={v => setForm({...form, asset_type: v})}>
                <SelectTrigger><SelectValue placeholder="Select asset type" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="Equity">Equity</SelectItem>
                  <SelectItem value="Commodities">Commodities</SelectItem>
                  <SelectItem value="Fixed Income">Fixed Income</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div>
              <Label>Asset Sub-Type</Label>
              <Select value={form.asset_subtype} onValueChange={v => setForm({...form, asset_subtype: v})}>
                <SelectTrigger><SelectValue placeholder="Select sub-type" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="Index Fund">Index Fund</SelectItem>
                  <SelectItem value="Public Stock">Public Stock</SelectItem>
                  <SelectItem value="Private Stock">Private Stock</SelectItem>
                  <SelectItem value="Gold">Gold</SelectItem>
                  <SelectItem value="Crypto">Crypto</SelectItem>
                  <SelectItem value="Bond">Bond</SelectItem>
                  <SelectItem value="Preferred Stock">Preferred Stock</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div>
              <Label>Geography</Label>
              <Select value={form.geography} onValueChange={v => setForm({...form, geography: v})}>
                <SelectTrigger><SelectValue placeholder="Select geography" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="Global">Global</SelectItem>
                  <SelectItem value="US">US</SelectItem>
                  <SelectItem value="International Emerging Markets">International Emerging Markets</SelectItem>
                  <SelectItem value="International Developed Markets">International Developed Markets</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div>
              <Label>Factor Tag</Label>
              <Select value={form.factor_tag} onValueChange={v => setForm({...form, factor_tag: v})}>
                <SelectTrigger><SelectValue placeholder="Select factor" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="Value">Value</SelectItem>
                  <SelectItem value="Blend">Blend</SelectItem>
                  <SelectItem value="Growth">Growth</SelectItem>
                  <SelectItem value="Momentum">Momentum</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div>
              <Label>Size Tag</Label>
              <Select value={form.size_tag} onValueChange={v => setForm({...form, size_tag: v})}>
                <SelectTrigger><SelectValue placeholder="Select size" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="Large">Large</SelectItem>
                  <SelectItem value="Mid">Mid</SelectItem>
                  <SelectItem value="Small">Small</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div>
              <Label>Notes</Label>
              <Input value={form.notes} onChange={e => setForm({...form, notes: e.target.value})} />
            </div>
            <Button type="submit" className="w-full">Save</Button>
          </form>
        </DialogContent>
      </Dialog>

      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="cursor-pointer" onClick={() => handleSort('ticker')}>
              Ticker <ArrowUpDown className="ml-2 h-4 w-4 inline" />
            </TableHead>
            <TableHead className="cursor-pointer" onClick={() => handleSort('name')}>
              Name <ArrowUpDown className="ml-2 h-4 w-4 inline" />
            </TableHead>
            <TableHead className="cursor-pointer" onClick={() => handleSort('sub_portfolio')}>
              Sub-Portfolio <ArrowUpDown className="ml-2 h-4 w-4 inline" />
            </TableHead>
            <TableHead className="cursor-pointer" onClick={() => handleSort('asset_type')}>
              Asset Type <ArrowUpDown className="ml-2 h-4 w-4 inline" />
            </TableHead>
            <TableHead className="cursor-pointer" onClick={() => handleSort('asset_subtype')}>
              Sub-Type <ArrowUpDown className="ml-2 h-4 w-4 inline" />
            </TableHead>
            <TableHead className="cursor-pointer" onClick={() => handleSort('geography')}>
              Geography <ArrowUpDown className="ml-2 h-4 w-4 inline" />
            </TableHead>
            <TableHead className="cursor-pointer" onClick={() => handleSort('factor_tag')}>
              Factor <ArrowUpDown className="ml-2 h-4 w-4 inline" />
            </TableHead>
            <TableHead className="cursor-pointer" onClick={() => handleSort('size_tag')}>
              Size <ArrowUpDown className="ml-2 h-4 w-4 inline" />
            </TableHead>
            <TableHead className="cursor-pointer" onClick={() => handleSort('notes')}>
              Notes <ArrowUpDown className="ml-2 h-4 w-4 inline" />
            </TableHead>
            <TableHead>Actions</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {sortedAssets.map(asset => (
            <TableRow key={asset.id}>
              <TableCell>{asset.ticker}</TableCell>
              <TableCell>{asset.name || '-'}</TableCell>
              <TableCell>{asset.sub_portfolio}</TableCell>
              <TableCell>{asset.asset_type || '-'}</TableCell>
              <TableCell>{asset.asset_subtype || '-'}</TableCell>
              <TableCell>{asset.geography || '-'}</TableCell>
              <TableCell>{asset.factor_tag || '-'}</TableCell>
              <TableCell>{asset.size_tag || '-'}</TableCell>
              <TableCell>{asset.notes || '-'}</TableCell>
              <TableCell className="space-x-2">
                <Button variant="outline" className="text-blue-600 border-blue-600 hover:bg-blue-50 h-8 px-3 text-xs" onClick={() => handleEdit(asset)}>
                  Edit
                </Button>
                <Button variant="outline" className="text-red-600 border-red-600 hover:bg-red-50 h-8 px-3 text-xs" onClick={() => handleDelete(asset.id)}>
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