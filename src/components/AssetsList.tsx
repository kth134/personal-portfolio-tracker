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

type Asset = { 
  id: string; 
  ticker: string; 
  name?: string; 
  sub_portfolio_id: string | null; 
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
    sub_portfolio_id: '', 
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

  // Search & mass actions
  const [search, setSearch] = useState('')
  const [selectedAssets, setSelectedAssets] = useState<string[]>([])
  const [bulkEditOpen, setBulkEditOpen] = useState(false)
  const [bulkForm, setBulkForm] = useState({
    asset_type: '',
    asset_subtype: '',
    geography: '',
    factor_tag: '',
    size_tag: '',
    notes: ''
  })

  // Sub-portfolios: id-name pairs
  const [subPortfolios, setSubPortfolios] = useState<{ id: string; name: string }[]>([])
  const [subMap, setSubMap] = useState<Map<string, string>>(new Map())
  const [subPortfolioPopoverOpen, setSubPortfolioPopoverOpen] = useState(false)

  // Fetch sub-portfolios on mount
  useEffect(() => {
    const fetchOptions = async () => {
      const supabase = createClient()
      const { data } = await supabase.from('sub_portfolios').select('id, name')
      if (data) {
        setSubPortfolios(data)
        const newMap = new Map<string, string>()
        data.forEach((sp: any) => newMap.set(sp.id, sp.name))
        setSubMap(newMap)
      }
    }
    fetchOptions()
  }, [])

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
    let aVal = a[sortColumn] ?? ''
    let bVal = b[sortColumn] ?? ''
    if (sortColumn === 'sub_portfolio_id') {
      aVal = subMap.get(a.sub_portfolio_id || '') || ''
      bVal = subMap.get(b.sub_portfolio_id || '') || ''
    }
    if (typeof aVal === 'string' && typeof bVal === 'string') {
      return sortDirection === 'asc' ? aVal.localeCompare(bVal) : bVal.localeCompare(aVal)
    }
    if (aVal < bVal) return sortDirection === 'asc' ? -1 : 1
    if (aVal > bVal) return sortDirection === 'asc' ? 1 : -1
    return 0
  }).filter(asset => {
    if (!search) return true
    const low = search.toLowerCase()
    return (
      asset.ticker.toLowerCase().includes(low) ||
      (asset.name || '').toLowerCase().includes(low) ||
      subMap.get(asset.sub_portfolio_id || '')?.toLowerCase().includes(low) ||
      (asset.asset_type || '').toLowerCase().includes(low) ||
      (asset.asset_subtype || '').toLowerCase().includes(low) ||
      (asset.geography || '').toLowerCase().includes(low) ||
      (asset.factor_tag || '').toLowerCase().includes(low) ||
      (asset.size_tag || '').toLowerCase().includes(low) ||
      (asset.notes || '').toLowerCase().includes(low)
    )
  })

  const selectAll = sortedAssets.length > 0 && selectedAssets.length === sortedAssets.length

  const handleSelectAsset = (id: string, checked: boolean) => {
    if (checked) {
      setSelectedAssets(prev => [...prev, id])
    } else {
      setSelectedAssets(prev => prev.filter(assetId => assetId !== id))
    }
  }

  const handleSelectAll = (checked: boolean) => {
    if (checked) {
      setSelectedAssets(sortedAssets.map(asset => asset.id))
    } else {
      setSelectedAssets([])
    }
  }

  const handleBulkDelete = async () => {
    if (selectedAssets.length === 0) return
    if (!confirm(`Delete ${selectedAssets.length} assets? This cannot be undone.`)) return

    const supabase = createClient()
    try {
      await supabase.from('assets').delete().in('id', selectedAssets)
      setAssets(assets.filter(a => !selectedAssets.includes(a.id)))
      setSelectedAssets([])
    } catch (err: any) {
      alert('Bulk delete failed: ' + err.message)
    }
  }

  const handleBulkEdit = () => {
    if (selectedAssets.length === 0) return
    setBulkEditOpen(true)
  }

  const handleBulkEditSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (selectedAssets.length === 0) return

    const supabase = createClient()
    const updateData: any = {}
    if (bulkForm.asset_type) updateData.asset_type = bulkForm.asset_type
    if (bulkForm.asset_subtype) updateData.asset_subtype = bulkForm.asset_subtype
    if (bulkForm.geography) updateData.geography = bulkForm.geography
    if (bulkForm.factor_tag) updateData.factor_tag = bulkForm.factor_tag
    if (bulkForm.size_tag) updateData.size_tag = bulkForm.size_tag
    if (bulkForm.notes) updateData.notes = bulkForm.notes

    if (Object.keys(updateData).length === 0) {
      alert('Please select at least one field to update')
      return
    }

    try {
      await supabase.from('assets').update(updateData).in('id', selectedAssets)
      // Update local state
      setAssets(assets.map(asset => 
        selectedAssets.includes(asset.id) ? { ...asset, ...updateData } : asset
      ))
      setBulkEditOpen(false)
      setBulkForm({ asset_type: '', asset_subtype: '', geography: '', factor_tag: '', size_tag: '', notes: '' })
      setSelectedAssets([])
    } catch (err: any) {
      alert('Bulk edit failed: ' + err.message)
    }
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    const supabase = createClient()
    let data, error
    if (editingAsset) {
      ({ data, error } = await supabase.from('assets').update({ ...form }).eq('id', editingAsset.id).select())
    } else {
      ({ data, error } = await supabase.from('assets').insert({ ...form }).select())
    }
    if (!error && data) {
      // Refetch assets to update list
      const { data: refreshedAssets } = await supabase.from('assets').select('*')
      if (refreshedAssets) {
        setAssets(refreshedAssets)
      }
      // No need to refresh sub_portfolios here; handled in create flow
      setOpen(false)
      setEditingAsset(null)
      setForm({ 
        ticker: '', 
        name: '', 
        sub_portfolio_id: '', 
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
    const supabase = createClient()
    await supabase.from('assets').delete().eq('id', id)
    setAssets(assets.filter(a => a.id !== id))
  }

  const handleEdit = (asset: Asset) => {
    setForm({
      ticker: asset.ticker,
      name: asset.name || '',
      sub_portfolio_id: asset.sub_portfolio_id || '',
      notes: asset.notes || '',
      asset_type: asset.asset_type || '',
      asset_subtype: asset.asset_subtype || '',
      geography: asset.geography || '',
      factor_tag: asset.factor_tag || '',
      size_tag: asset.size_tag || ''
    })
    setEditingAsset(asset)
    setOpen(true)
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
                    {subMap.get(form.sub_portfolio_id) || "Select or add sub-portfolio"}
                    <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-full p-0">
                  <Command>
                    <CommandInput 
                      placeholder="Search or add sub-portfolio..." 
                      onKeyDown={async (e) => {
                        if (e.key === 'Enter' && e.currentTarget.value.trim()) {
                          const supabase = createClient()
                          const newName = e.currentTarget.value.trim()
                          const { data, error } = await supabase.from('sub_portfolios').insert({ name: newName }).select('id, name')
                          if (!error && data) {
                            const newSp = data[0]
                            setSubPortfolios([...subPortfolios, newSp])
                            setSubMap(new Map(subMap).set(newSp.id, newSp.name))
                            setForm({ ...form, sub_portfolio_id: newSp.id })
                          }
                          setSubPortfolioPopoverOpen(false)
                        }
                      }}
                    />
                    <CommandList>
                      <CommandEmpty>
                        {subPortfolios.length === 0 ? "Type to create new" : "No match — press Enter to create"}
                      </CommandEmpty>
                      <CommandGroup>
                        {subPortfolios.map(sp => (
                          <CommandItem 
                            key={sp.id} 
                            onSelect={() => {
                              setForm({ ...form, sub_portfolio_id: sp.id })
                              setSubPortfolioPopoverOpen(false)
                            }}
                          >
                            <Check className={cn("mr-2 h-4 w-4", form.sub_portfolio_id === sp.id ? "opacity-100" : "opacity-0")} />
                            {sp.name}
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

      <Dialog open={bulkEditOpen} onOpenChange={setBulkEditOpen}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Bulk Edit {selectedAssets.length} Assets</DialogTitle>
          </DialogHeader>
          <form onSubmit={handleBulkEditSubmit} className="space-y-4">
            <div>
              <Label>Asset Type (leave empty to keep current)</Label>
              <Select value={bulkForm.asset_type} onValueChange={v => setBulkForm({...bulkForm, asset_type: v})}>
                <SelectTrigger>
                  <SelectValue placeholder="Update asset type for all selected" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="Equity">Equity</SelectItem>
                  <SelectItem value="Commodities">Commodities</SelectItem>
                  <SelectItem value="Fixed Income">Fixed Income</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div>
              <Label>Asset Sub-Type (leave empty to keep current)</Label>
              <Select value={bulkForm.asset_subtype} onValueChange={v => setBulkForm({...bulkForm, asset_subtype: v})}>
                <SelectTrigger>
                  <SelectValue placeholder="Update sub-type for all selected" />
                </SelectTrigger>
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
              <Label>Geography (leave empty to keep current)</Label>
              <Select value={bulkForm.geography} onValueChange={v => setBulkForm({...bulkForm, geography: v})}>
                <SelectTrigger>
                  <SelectValue placeholder="Update geography for all selected" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="Global">Global</SelectItem>
                  <SelectItem value="US">US</SelectItem>
                  <SelectItem value="International Emerging Markets">International Emerging Markets</SelectItem>
                  <SelectItem value="International Developed Markets">International Developed Markets</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div>
              <Label>Factor Tag (leave empty to keep current)</Label>
              <Select value={bulkForm.factor_tag} onValueChange={v => setBulkForm({...bulkForm, factor_tag: v})}>
                <SelectTrigger>
                  <SelectValue placeholder="Update factor for all selected" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="Value">Value</SelectItem>
                  <SelectItem value="Blend">Blend</SelectItem>
                  <SelectItem value="Growth">Growth</SelectItem>
                  <SelectItem value="Momentum">Momentum</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div>
              <Label>Size Tag (leave empty to keep current)</Label>
              <Select value={bulkForm.size_tag} onValueChange={v => setBulkForm({...bulkForm, size_tag: v})}>
                <SelectTrigger>
                  <SelectValue placeholder="Update size for all selected" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="Large">Large</SelectItem>
                  <SelectItem value="Mid">Mid</SelectItem>
                  <SelectItem value="Small">Small</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div>
              <Label>Notes (leave empty to keep current)</Label>
              <Input 
                value={bulkForm.notes} 
                onChange={e => setBulkForm({...bulkForm, notes: e.target.value})} 
                placeholder="Update notes for all selected"
              />
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
          placeholder="Search assets..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="w-64"
        />

        {selectedAssets.length > 0 && (
          <div className="flex gap-2 items-center">
            <span className="text-sm text-muted-foreground">
              {selectedAssets.length} selected
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

      <div className="-mx-4 overflow-x-auto px-4 overscroll-x-contain sm:mx-0 sm:px-0">
        <Table className="min-w-[1320px] table-fixed">
        <colgroup>
          <col className="w-12" />
          <col className="w-[7%]" />
          <col className="w-[15%]" />
          <col className="w-[14%]" />
          <col className="w-[9%]" />
          <col className="w-[10%]" />
          <col className="w-[10%]" />
          <col className="w-[9%]" />
          <col className="w-[8%]" />
          <col className="w-[10%]" />
          <col className="w-[8%]" />
        </colgroup>
        <TableHeader>
          <TableRow>
            <TableHead className="px-3">
              <Checkbox
                checked={selectAll}
                onCheckedChange={handleSelectAll}
              />
            </TableHead>
            <TableHead className="cursor-pointer px-3" onClick={() => handleSort('ticker')}>
              Ticker <ArrowUpDown className="ml-2 h-4 w-4 inline" />
            </TableHead>
            <TableHead className="cursor-pointer px-3" onClick={() => handleSort('name')}>
              Name <ArrowUpDown className="ml-2 h-4 w-4 inline" />
            </TableHead>
            <TableHead className="cursor-pointer px-3" onClick={() => handleSort('sub_portfolio_id')}>
              Sub-Portfolio <ArrowUpDown className="ml-2 h-4 w-4 inline" />
            </TableHead>
            <TableHead className="cursor-pointer px-3" onClick={() => handleSort('asset_type')}>
              Asset Type <ArrowUpDown className="ml-2 h-4 w-4 inline" />
            </TableHead>
            <TableHead className="cursor-pointer px-3" onClick={() => handleSort('asset_subtype')}>
              Sub-Type <ArrowUpDown className="ml-2 h-4 w-4 inline" />
            </TableHead>
            <TableHead className="cursor-pointer px-3" onClick={() => handleSort('geography')}>
              Geography <ArrowUpDown className="ml-2 h-4 w-4 inline" />
            </TableHead>
            <TableHead className="cursor-pointer px-3" onClick={() => handleSort('factor_tag')}>
              Factor <ArrowUpDown className="ml-2 h-4 w-4 inline" />
            </TableHead>
            <TableHead className="cursor-pointer px-3" onClick={() => handleSort('size_tag')}>
              Size <ArrowUpDown className="ml-2 h-4 w-4 inline" />
            </TableHead>
            <TableHead className="cursor-pointer px-3" onClick={() => handleSort('notes')}>
              Notes <ArrowUpDown className="ml-2 h-4 w-4 inline" />
            </TableHead>
            <TableHead className="px-3 text-right">Actions</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {sortedAssets.map(asset => (
            <TableRow key={asset.id}>
              <TableCell className="px-3">
                <Checkbox
                  checked={selectedAssets.includes(asset.id)}
                  onCheckedChange={(checked) => handleSelectAsset(asset.id, checked as boolean)}
                />
              </TableCell>
              <TableCell className="px-3 whitespace-nowrap">{asset.ticker}</TableCell>
              <TableCell className="px-3">
                <span className="block truncate" title={asset.name || '-'}>{asset.name || '-'}</span>
              </TableCell>
              <TableCell className="px-3">
                <span className="block truncate" title={subMap.get(asset.sub_portfolio_id || '') || '-'}>{subMap.get(asset.sub_portfolio_id || '') || '-'}</span>
              </TableCell>
              <TableCell className="px-3 whitespace-nowrap">{asset.asset_type || '-'}</TableCell>
              <TableCell className="px-3 whitespace-nowrap">{asset.asset_subtype || '-'}</TableCell>
              <TableCell className="px-3 whitespace-nowrap">{asset.geography || '-'}</TableCell>
              <TableCell className="px-3 whitespace-nowrap">{asset.factor_tag || '-'}</TableCell>
              <TableCell className="px-3 whitespace-nowrap">{asset.size_tag || '-'}</TableCell>
              <TableCell className="px-3">
                <span className="block truncate" title={asset.notes || '-'}>{asset.notes || '-'}</span>
              </TableCell>
              <TableCell className="px-3">
                <div className="flex flex-wrap items-center justify-end gap-2">
                <Button variant="outline" className="text-blue-600 border-blue-600 hover:bg-blue-50 h-8 px-3 text-xs whitespace-nowrap" onClick={() => handleEdit(asset)}>
                  Edit
                </Button>
                <Button variant="outline" className="text-red-600 border-red-600 hover:bg-red-50 h-8 px-3 text-xs whitespace-nowrap" onClick={() => handleDelete(asset.id)}>
                  Delete
                </Button>
                </div>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
      </div>
    </>
  )
}