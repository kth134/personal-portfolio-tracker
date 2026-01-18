'use client'

import { useState, useEffect } from 'react'
import { createClient } from '@/lib/supabase/client'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { formatUSD } from '@/lib/formatters';

import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from '@/components/ui/command'
import { Calendar } from '@/components/ui/calendar'
import { Checkbox } from '@/components/ui/checkbox'
import { CalendarIcon, Check, ChevronsUpDown, Edit2, Trash2, ArrowUpDown } from 'lucide-react'
import { cn } from '@/lib/utils'
import { format, parseISO } from 'date-fns'
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from '@/components/ui/alert-dialog'

type Account = { id: string; name: string; type: string }
type Asset = { id: string; ticker: string; name?: string }

type TaxLot = {
  id: string
  purchase_date: string
  quantity: number
  cost_basis_per_unit: number
  remaining_quantity: number
  account_id: string | null
  asset_id: string | null
  account: { id: string; name: string } | null
  asset: { id: string; ticker: string; name?: string } | null
}

type TaxLotsListProps = {
  initialTaxLots: TaxLot[]
}

export default function TaxLotsList({ initialTaxLots }: TaxLotsListProps) {
  const [taxLots, setTaxLots] = useState(initialTaxLots)
  const [open, setOpen] = useState(false)
  const [editingLot, setEditingLot] = useState<TaxLot | null>(null)
  const [deleteId, setDeleteId] = useState<string | null>(null)

  // Form state
  const [accounts, setAccounts] = useState<Account[]>([])
  const [assets, setAssets] = useState<Asset[]>([])
  const [selectedAccount, setSelectedAccount] = useState<Account | null>(null)
  const [selectedAsset, setSelectedAsset] = useState<Asset | null>(null)
  const [purchaseDate, setPurchaseDate] = useState<Date | undefined>(undefined)
  const [quantity, setQuantity] = useState('')
  const [basisPerUnit, setBasisPerUnit] = useState('')
  const [remainingQuantity, setRemainingQuantity] = useState('')
  type SortKey = 'account' | 'asset' | 'date' | 'origQty' | 'basisUnit' | 'remainQty' | 'totalBasis'
  const [sortKey, setSortKey] = useState<SortKey>('remainQty')
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc')

  // Search & mass actions
  const [search, setSearch] = useState('')
  const [selectedLots, setSelectedLots] = useState<string[]>([])
  const [selectAll, setSelectAll] = useState(false)
  // Fetch accounts & assets
  useEffect(() => {
    const fetchData = async () => {
      const supabase = createClient()
      const { data: accs } = await supabase.from('accounts').select('id, name, type')
      const { data: asts } = await supabase.from('assets').select('id, ticker, name')
      setAccounts(accs || [])
      setAssets(asts || [])
    }
    fetchData()
  }, [])

  const resetForm = () => {
    setSelectedAccount(null)
    setSelectedAsset(null)
    setPurchaseDate(undefined)
    setQuantity('')
    setBasisPerUnit('')
    setRemainingQuantity('')
    setEditingLot(null)
  }

 const openEdit = (lot: TaxLot) => {
  setEditingLot(lot)
  // Prepopulate account and asset using the IDs
  if (lot.account) setSelectedAccount({ id: lot.account.id, name: lot.account.name, type: '' })
  if (lot.asset) setSelectedAsset({ id: lot.asset.id, ticker: lot.asset.ticker, name: lot.asset.name })
  setPurchaseDate(parseISO(lot.purchase_date))
  setQuantity(lot.quantity.toString())
  setBasisPerUnit(lot.cost_basis_per_unit.toString())
  setRemainingQuantity(lot.remaining_quantity.toString())
  setOpen(true)
}

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    const supabase = createClient()
    if (!selectedAccount || !selectedAsset || !purchaseDate || !quantity || !basisPerUnit || !remainingQuantity) {
      alert('Please fill all fields')
      return
    }

    const qty = Number(quantity)
    const basis = Number(basisPerUnit)
    const remaining = Number(remainingQuantity)

    if (qty <= 0 || basis <= 0 || remaining < 0 || remaining > qty) {
      alert('Invalid values: Quantity/basis positive, remaining 0-quantity')
      return
    }

    try {
      const lotData = {
        account_id: selectedAccount.id,
        asset_id: selectedAsset.id,
        purchase_date: format(purchaseDate, 'yyyy-MM-dd'),
        quantity: qty,
        cost_basis_per_unit: basis,
        remaining_quantity: remaining,
      }

      if (editingLot) {
        const { error } = await supabase
          .from('tax_lots')
          .update(lotData)
          .eq('id', editingLot.id)
        if (error) throw error
      } else {
        const { error } = await supabase
          .from('tax_lots')
          .insert(lotData)
        if (error) throw error
      }

      // Refetch for accuracy
      const { data: refreshed } = await supabase
        .from('tax_lots')
        .select(`
          *,
          account:accounts (name),
          asset:assets (ticker, name)
        `)

      setTaxLots(refreshed || [])
      setOpen(false)
      resetForm()
    } catch (err: any) {
      alert('Error: ' + err.message)
    }
  }

  const handleDelete = async () => {
    if (!deleteId) return
    const supabase = createClient()
    try {
      await supabase.from('tax_lots').delete().eq('id', deleteId)
      setTaxLots(taxLots.filter(l => l.id !== deleteId))
      setDeleteId(null)
    } catch (err) {
      alert('Delete failed')
    }
  }
const handleSort = (key: SortKey) => {
  if (key === sortKey) {
    setSortDir(sortDir === 'asc' ? 'desc' : 'asc')
  } else {
    setSortKey(key)
    setSortDir('desc')
  }
}

  const handleSelectLot = (id: string, checked: boolean) => {
    if (checked) {
      setSelectedLots(prev => [...prev, id])
    } else {
      setSelectedLots(prev => prev.filter(lotId => lotId !== id))
    }
  }

  const handleSelectAll = (checked: boolean) => {
    if (checked) {
      setSelectedLots(filteredLots.map(lot => lot.id))
    } else {
      setSelectedLots([])
    }
    setSelectAll(checked)
  }

  const handleBulkDelete = async () => {
    if (selectedLots.length === 0) return
    if (!confirm(`Delete ${selectedLots.length} tax lots? This cannot be undone.`)) return

    const supabase = createClient()
    try {
      await supabase.from('tax_lots').delete().in('id', selectedLots)
      setTaxLots(taxLots.filter(l => !selectedLots.includes(l.id)))
      setSelectedLots([])
      setSelectAll(false)
    } catch (err: any) {
      alert('Bulk delete failed: ' + err.message)
    }
  }

  const filteredLots = [...taxLots].sort((a, b) => {
    let va: any, vb: any
    switch (sortKey) {
      case 'account':
        va = a.account?.name || ''
        vb = b.account?.name || ''
        break
      case 'asset':
        va = a.asset?.ticker || ''
        vb = b.asset?.ticker || ''
        break
      case 'date':
        va = a.purchase_date
        vb = b.purchase_date
        break
      case 'origQty':
        va = a.quantity
        vb = b.quantity
        break
      case 'basisUnit':
        va = a.cost_basis_per_unit
        vb = b.cost_basis_per_unit
        break
      case 'remainQty':
        va = a.remaining_quantity
        vb = b.remaining_quantity
        break
      case 'totalBasis':
        va = a.remaining_quantity * a.cost_basis_per_unit
        vb = b.remaining_quantity * b.cost_basis_per_unit
        break
    }
    if (va < vb) return sortDir === 'asc' ? -1 : 1
    if (va > vb) return sortDir === 'asc' ? 1 : -1
    return 0
  }).filter(lot => {
    if (!search) return true
    const low = search.toLowerCase()
    return (
      lot.account?.name?.toLowerCase().includes(low) ||
      lot.asset?.ticker?.toLowerCase().includes(low) ||
      lot.asset?.name?.toLowerCase().includes(low) ||
      lot.purchase_date.includes(low)
    )
  })

  // Update select all
  useEffect(() => {
    const allSelected = filteredLots.length > 0 && selectedLots.length === filteredLots.length
    setSelectAll(allSelected)
  }, [selectedLots, filteredLots])

  return (
    <main className="container mx-auto py-8">
      <div className="flex justify-between items-center mb-8">
            <h1 className="text-3xl font-bold">Tax Lots</h1>
            <Dialog open={open} onOpenChange={(isOpen) => {
              setOpen(isOpen)
              if (!isOpen) resetForm()
            }}>
          <DialogTrigger asChild>
            <Button>{editingLot ? 'Edit' : 'Add'} Tax Lot</Button>
          </DialogTrigger>
          <DialogContent className="max-w-2xl">
            <DialogHeader>
              <DialogTitle>{editingLot ? 'Edit' : 'Add'} Tax Lot</DialogTitle>
            </DialogHeader>
            <form onSubmit={handleSubmit} className="space-y-6">
              {/* Account Combobox */}
              <div>
                <Label>Account *</Label>
                <Popover>
                  <PopoverTrigger asChild>
                    <Button variant="outline" className="w-full justify-between">
                      {selectedAccount ? selectedAccount.name : 'Select account'}
                      <ChevronsUpDown className="ml-2 h-4 w-4 opacity-50" />
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent className="w-full p-0">
                    <Command>
                      <CommandInput placeholder="Search accounts..." />
                      <CommandList>
                        <CommandEmpty>No account found.</CommandEmpty>
                        <CommandGroup>
                          {accounts.map((acc) => (
                            <CommandItem key={acc.id} onSelect={() => setSelectedAccount(acc)}>
                              <Check className={cn('mr-2 h-4 w-4', selectedAccount?.id === acc.id ? 'opacity-100' : 'opacity-0')} />
                              {acc.name}
                            </CommandItem>
                          ))}
                        </CommandGroup>
                      </CommandList>
                    </Command>
                  </PopoverContent>
                </Popover>
              </div>

              {/* Asset Combobox */}
              <div>
                <Label>Asset *</Label>
                <Popover>
                  <PopoverTrigger asChild>
                    <Button variant="outline" className="w-full justify-between">
                      {selectedAsset ? `${selectedAsset.ticker} ${selectedAsset.name || ''}` : 'Select asset'}
                      <ChevronsUpDown className="ml-2 h-4 w-4 opacity-50" />
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent className="w-full p-0">
                    <Command>
                      <CommandInput placeholder="Search assets..." />
                      <CommandList>
                        <CommandEmpty>No asset found.</CommandEmpty>
                        <CommandGroup>
                          {assets.map((ast) => (
                            <CommandItem key={ast.id} onSelect={() => setSelectedAsset(ast)}>
                              <Check className={cn('mr-2 h-4 w-4', selectedAsset?.id === ast.id ? 'opacity-100' : 'opacity-0')} />
                              {ast.ticker} {ast.name && `- ${ast.name}`}
                            </CommandItem>
                          ))}
                        </CommandGroup>
                      </CommandList>
                    </Command>
                  </PopoverContent>
                </Popover>
              </div>

              {/* Date */}
              <div>
                <Label>Purchase Date *</Label>
                <Popover>
                  <PopoverTrigger asChild>
                    <Button variant="outline" className={cn('w-full justify-start text-left font-normal', !purchaseDate && 'text-muted-foreground')}>
                      <CalendarIcon className="mr-2 h-4 w-4" />
                      {purchaseDate ? format(purchaseDate, 'PPP') : 'Pick a date'}
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent className="w-auto p-0">
                    <Calendar mode="single" selected={purchaseDate} onSelect={setPurchaseDate} initialFocus />
                  </PopoverContent>
                </Popover>
              </div>

              {/* Numbers */}
              <div className="grid grid-cols-3 gap-4">
                <div>
                  <Label>Original Quantity *</Label>
                  <Input type="number" step="0.00000001" value={quantity} onChange={e => setQuantity(e.target.value)} required />
                </div>
                <div>
                  <Label>Basis per Unit *</Label>
                  <Input type="number" step="0.00001" value={basisPerUnit} onChange={e => setBasisPerUnit(e.target.value)} required />
                </div>
                <div>
                  <Label>Remaining Quantity *</Label>
                  <Input type="number" step="0.00000001" value={remainingQuantity} onChange={e => setRemainingQuantity(e.target.value)} required />
                </div>
              </div>

              <Button type="submit" className="w-full">Save Tax Lot</Button>
            </form>
          </DialogContent>
        </Dialog>
      </div>

      <div className="flex gap-4 items-center mb-4">
        <Input
          placeholder="Search tax lots..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="w-64"
        />

        {selectedLots.length > 0 && (
          <div className="flex gap-2 items-center">
            <span className="text-sm text-muted-foreground">
              {selectedLots.length} selected
            </span>
            <Button variant="destructive" size="sm" onClick={handleBulkDelete}>
              Delete Selected
            </Button>
          </div>
        )}
      </div>

      {/* Tax Lots Table */}
      {taxLots.length > 0 ? (
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
              <TableHead className="cursor-pointer" onClick={() => handleSort('account')}>Account <ArrowUpDown className="ml-2 h-4 w-4 inline" /></TableHead>
              <TableHead className="cursor-pointer" onClick={() => handleSort('asset')}>Asset <ArrowUpDown className="ml-2 h-4 w-4 inline" /></TableHead>
              <TableHead className="cursor-pointer" onClick={() => handleSort('date')}>Purchase Date <ArrowUpDown className="ml-2 h-4 w-4 inline" /></TableHead>
              <TableHead className="text-right cursor-pointer" onClick={() => handleSort('origQty')}>Original Qty <ArrowUpDown className="ml-2 h-4 w-4 inline" /></TableHead>
              <TableHead className="text-right cursor-pointer" onClick={() => handleSort('basisUnit')}>Basis/Unit <ArrowUpDown className="ml-2 h-4 w-4 inline" /></TableHead>
              <TableHead className="text-right cursor-pointer" onClick={() => handleSort('remainQty')}>Remaining Qty <ArrowUpDown className="ml-2 h-4 w-4 inline" /></TableHead>
              <TableHead className="cursor-pointer" onClick={() => handleSort('totalBasis')}>Total Remaining Basis <ArrowUpDown className="ml-2 h-4 w-4 inline" /></TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {filteredLots.map((lot) => (
              <TableRow key={lot.id} className={cn(lot.remaining_quantity === 0 && "opacity-60 bg-muted/20")}>
                <TableCell>
                  <Checkbox
                    checked={selectedLots.includes(lot.id)}
                    onCheckedChange={(checked) => handleSelectLot(lot.id, checked as boolean)}
                  />
                </TableCell>
                <TableCell>{lot.account?.name || '-'}</TableCell>
                <TableCell className="w-16 break-words">
                  {lot.asset?.ticker || '-'}
                </TableCell>
                <TableCell>{lot.purchase_date}</TableCell>
                <TableCell className="text-right">{Number(lot.quantity).toFixed(8)}</TableCell>
                <TableCell className="text-right">{formatUSD(Number(lot.cost_basis_per_unit))}</TableCell>
                <TableCell className="text-right">{Number(lot.remaining_quantity).toFixed(8)}</TableCell>
                <TableCell className="text-right">
                  {formatUSD(Number(lot.remaining_quantity) * Number(lot.cost_basis_per_unit))}
                </TableCell>
                <TableCell>
                  <span className={cn(
                    "px-2 py-1 rounded-full text-xs font-medium",
                    lot.remaining_quantity === 0 
                      ? "bg-red-100 text-red-800" 
                      : "bg-green-100 text-green-800"
                  )}>
                    {lot.remaining_quantity === 0 ? "Depleted" : "Active"}
                  </span>
                </TableCell>
                <TableCell className="flex gap-2">
                  <Button variant="ghost" size="sm" onClick={() => openEdit(lot)}>
                    <Edit2 className="h-4 w-4" />
                  </Button>
                  <AlertDialog>
                    <AlertDialogTrigger asChild>
                      <Button variant="ghost" size="sm">
                        <Trash2 className="h-4 w-4 text-red-600" />
                      </Button>
                    </AlertDialogTrigger>
                    <AlertDialogContent>
                      <AlertDialogHeader>
                        <AlertDialogTitle>Delete Tax Lot?</AlertDialogTitle>
                        <AlertDialogDescription>This permanently removes the lot.</AlertDialogDescription>
                      </AlertDialogHeader>
                      <AlertDialogFooter>
                        <AlertDialogCancel>Cancel</AlertDialogCancel>
                        <AlertDialogAction onClick={() => setDeleteId(lot.id)}>Delete</AlertDialogAction>
                      </AlertDialogFooter>
                    </AlertDialogContent>
                  </AlertDialog>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
        </div>
      ) : (
        <p className="text-muted-foreground">No tax lots yet—add buys to create them.</p>
      )}

      {/* Confirm delete */}
      <AlertDialog open={!!deleteId} onOpenChange={(open) => !open && setDeleteId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Confirm Delete</AlertDialogTitle>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleDelete}>Delete</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </main>
  )
}