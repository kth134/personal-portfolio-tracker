'use client'

import { useState, useEffect } from 'react'
import { supabaseClient } from '@/lib/supabase/client'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog'
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from '@/components/ui/command'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Check, ChevronsUpDown } from 'lucide-react'
import { cn } from '@/lib/utils'

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

  // Dynamic options
  const [assetClasses, setAssetClasses] = useState<string[]>([])
  const [subPortfolios, setSubPortfolios] = useState<string[]>([])
  const [assetClassPopoverOpen, setAssetClassPopoverOpen] = useState(false)
  const [subPortfolioPopoverOpen, setSubPortfolioPopoverOpen] = useState(false)

  // Fetch unique existing asset classes and sub-portfolios on mount
  useEffect(() => {
    const fetchOptions = async () => {
      const { data } = await supabaseClient.from('assets').select('asset_class, sub_portfolio')
      const uniqueClasses = [...new Set(data?.map((a: any) => a.asset_class).filter(Boolean))] as string[]
      const uniqueSubPortfolios = [...new Set(data?.map((a: any) => a.sub_portfolio).filter(Boolean))] as string[]
      setAssetClasses(uniqueClasses)
      setSubPortfolios(uniqueSubPortfolios)
    }
    fetchOptions()
  }, [])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    const { data, error } = await supabaseClient.from('assets').insert({ ...form }).select()
    if (!error && data) {
      setAssets([...assets, data[0]])
      // Refresh lists if new values added
      if (form.asset_class && !assetClasses.includes(form.asset_class)) {
        setAssetClasses([...assetClasses, form.asset_class])
      }
      if (form.sub_portfolio && !subPortfolios.includes(form.sub_portfolio)) {
        setSubPortfolios([...subPortfolios, form.sub_portfolio])
      }
      setOpen(false)
      setForm({ ticker: '', name: '', asset_class: '', sub_portfolio: '', notes: '' })
    } else {
      console.error(error)
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
            <div>
              <Label>Ticker (unique)</Label>
              <Input value={form.ticker} onChange={e => setForm({...form, ticker: e.target.value.toUpperCase()})} required />
            </div>
            <div>
              <Label>Name</Label>
              <Input value={form.name} onChange={e => setForm({...form, name: e.target.value})} />
            </div>
            <div>
              <Label>Asset Class</Label>
              <Popover open={assetClassPopoverOpen} onOpenChange={setAssetClassPopoverOpen}>
                <PopoverTrigger asChild>
                  <Button variant="outline" role="combobox" className="w-full justify-between">
                    {form.asset_class || "Select or add asset class"}
                    <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-full p-0">
                  <Command>
                    <CommandInput 
                      placeholder="Search or add asset class..." 
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' && e.currentTarget.value.trim()) {
                          const newClass = e.currentTarget.value.trim()
                          if (!assetClasses.includes(newClass)) {
                            setAssetClasses([...assetClasses, newClass])
                          }
                          setForm({ ...form, asset_class: newClass })
                          setAssetClassPopoverOpen(false)
                        }
                      }}
                    />
                    <CommandList>
                      <CommandEmpty>
                        {assetClasses.length === 0 ? "Type to create new" : "No match — press Enter to create"}
                      </CommandEmpty>
                      <CommandGroup>
                        {assetClasses.map(cls => (
                          <CommandItem 
                            key={cls} 
                            onSelect={() => {
                              setForm({ ...form, asset_class: cls })
                              setAssetClassPopoverOpen(false)
                            }}
                          >
                            <Check className={cn("mr-2 h-4 w-4", form.asset_class === cls ? "opacity-100" : "opacity-0")} />
                            {cls}
                          </CommandItem>
                        ))}
                      </CommandGroup>
                    </CommandList>
                  </Command>
                </PopoverContent>
              </Popover>
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
              <TableCell>{asset.name || '-'}</TableCell>
              <TableCell>{asset.asset_class}</TableCell>
              <TableCell>{asset.sub_portfolio}</TableCell>
              <TableCell>{asset.notes || '-'}</TableCell>
              <TableCell>
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