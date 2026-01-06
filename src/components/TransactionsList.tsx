'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { supabaseClient } from '@/lib/supabase/client'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from '@/components/ui/command'
import { Calendar } from '@/components/ui/calendar'
import { CalendarIcon, Check, ChevronsUpDown, Edit2, Trash2, ArrowUpDown } from 'lucide-react'
import { cn } from '@/lib/utils'
import { format, parseISO } from 'date-fns'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from '@/components/ui/alert-dialog'

type Account = { id: string; name: string; type: string }
type Asset = { id: string; ticker: string; name?: string }

type Transaction = {
  id: string
  date: string
  type: 'Buy' | 'Sell' | 'Dividend'
  quantity?: number
  price_per_unit?: number
  amount?: number
  fees?: number
  realized_gain?: number
  notes?: string
  account_id: string
  asset_id: string
  account: { name: string; type?: string } | null
  asset: { ticker: string; name?: string } | null
}

type TransactionsListProps = {
  initialTransactions: Transaction[]
}

export default function TransactionsList({ initialTransactions }: TransactionsListProps) {
  const router = useRouter()
  const [transactions, setTransactions] = useState(initialTransactions)
  const [displayTransactions, setDisplayTransactions] = useState(initialTransactions)
  const [open, setOpen] = useState(false)
  const [editingTx, setEditingTx] = useState<Transaction | null>(null)
  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null)

  // Search & sort
  const [search, setSearch] = useState('')
  const [sortKey, setSortKey] = useState<keyof Transaction | 'account_name' | 'asset_ticker'>('date')
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc')

  // Form state
  const [accounts, setAccounts] = useState<Account[]>([])
  const [assets, setAssets] = useState<Asset[]>([])
  const [selectedAccount, setSelectedAccount] = useState<Account | null>(null)
  const [selectedAsset, setSelectedAsset] = useState<Asset | null>(null)
  const [type, setType] = useState<'Buy' | 'Sell' | 'Dividend'>('Buy')
  const [date, setDate] = useState<Date | undefined>(undefined)
  const [quantity, setQuantity] = useState('')
  const [price, setPrice] = useState('')
  const [dividendAmount, setDividendAmount] = useState('')
  const [fees, setFees] = useState('')
  const [notes, setNotes] = useState('')

  // Fetch accounts & assets
  useEffect(() => {
    const fetchData = async () => {
      const { data: accs } = await supabaseClient.from('accounts').select('id, name, type')
      const { data: asts } = await supabaseClient.from('assets').select('id, ticker, name')
      setAccounts(accs || [])
      setAssets(asts || [])
    }
    fetchData()
  }, [])

  // Search + sort effect
  useEffect(() => {
    let list = [...transactions]

    if (search) {
      const low = search.toLowerCase()
      list = list.filter(tx =>
        tx.asset?.ticker.toLowerCase().includes(low) ||
        tx.account?.name.toLowerCase().includes(low) ||
        tx.notes?.toLowerCase().includes(low) ||
        tx.type.toLowerCase().includes(low)
      )
    }

    list.sort((a, b) => {
      let aVal: any
      let bVal: any

      if (sortKey === 'account_name') {
        aVal = a.account?.name ?? ''
        bVal = b.account?.name ?? ''
      } else if (sortKey === 'asset_ticker') {
        aVal = a.asset?.ticker ?? ''
        bVal = b.asset?.ticker ?? ''
      } else {
        aVal = a[sortKey as keyof Transaction] ?? ''
        bVal = b[sortKey as keyof Transaction] ?? ''
      }

      if (typeof aVal === 'string') aVal = aVal.toLowerCase()
      if (typeof bVal === 'string') bVal = bVal.toLowerCase()
      if (aVal < bVal) return sortDir === 'asc' ? -1 : 1
      if (aVal > bVal) return sortDir === 'asc' ? 1 : -1
      return 0
    })

    setDisplayTransactions(list)
  }, [transactions, search, sortKey, sortDir])

  const toggleSort = (key: typeof sortKey) => {
    if (sortKey === key) {
      setSortDir(sortDir === 'asc' ? 'desc' : 'asc')
    } else {
      setSortKey(key)
      setSortDir('desc')
    }
  }

  const resetForm = () => {
    setSelectedAccount(null)
    setSelectedAsset(null)
    setType('Buy')
    setDate(undefined)
    setQuantity('')
    setPrice('')
    setDividendAmount('')
    setFees('')
    setNotes('')
    setEditingTx(null)
  }

  const openEdit = (tx: Transaction) => {
    setEditingTx(tx)
    setSelectedAccount({ id: tx.account_id, name: tx.account?.name || '', type: tx.account?.type || '' } as Account)
    setSelectedAsset({ id: tx.asset_id, ticker: tx.asset?.ticker || '', name: tx.asset?.name } as Asset)
    setType(tx.type as 'Buy' | 'Sell' | 'Dividend')
    setDate(parseISO(tx.date))
    setQuantity(tx.quantity?.toString() || '')
    setPrice(tx.price_per_unit?.toString() || '')
    setDividendAmount(tx.amount?.toString() || '')
    setFees(tx.fees?.toString() || '')
    setNotes(tx.notes || '')
    setOpen(true)
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!selectedAccount || !selectedAsset || !type || !date) {
      alert('Please fill all required fields')
      return
    }

    let qty: number | null = null
    let prc: number | null = null
    let amt: number = 0
    let fs = Number(fees || 0)

    if (type === 'Dividend') {
      amt = Number(dividendAmount)
      if (isNaN(amt) || amt <= 0) {
        alert('Please enter a positive dividend amount')
        return
      }
    } else {
      qty = Number(quantity)
      prc = Number(price)
      if (isNaN(qty) || qty <= 0 || isNaN(prc) || prc <= 0) {
        alert('Quantity and price must be positive for Buy/Sell')
        return
      }
      const gross = qty * prc
      const total = type === 'Buy' ? gross + fs : gross - fs
      amt = type === 'Buy' ? -total : total
    }

    try {
      let updatedTx

      const txData = {
        account_id: selectedAccount.id,
        asset_id: selectedAsset.id,
        date: format(date, 'yyyy-MM-dd'),
        type,
        quantity: qty,
        price_per_unit: prc,
        amount: amt,
        fees: fs || null,
        notes: notes || null,
        realized_gain: type === 'Sell' ? null : editingTx?.realized_gain ?? null,
      }

      if (editingTx) {
        const { data, error } = await supabaseClient
          .from('transactions')
          .update(txData)
          .eq('id', editingTx.id)
          .select(`
            *,
            account:accounts (name, type),
            asset:assets (ticker, name)
          `)
          .single()
        if (error) throw error
        updatedTx = data
      } else {
        const { data, error } = await supabaseClient
          .from('transactions')
          .insert(txData)
          .select(`
            *,
            account:accounts (name, type),
            asset:assets (ticker, name)
          `)
          .single()
        if (error) throw error
        updatedTx = data
      }

      if (type === 'Buy') {
        const basis_per_unit = Math.abs(amt) / qty!
        await supabaseClient.from('tax_lots').insert({
          account_id: selectedAccount.id,
          asset_id: selectedAsset.id,
          purchase_date: format(date, 'yyyy-MM-dd'),
          quantity: qty!,
          cost_basis_per_unit: basis_per_unit,
          remaining_quantity: qty!,
        })
      } else if (type === 'Sell') {
        const { data: lots, error: lotsErr } = await supabaseClient
          .from('tax_lots')
          .select('*')
          .eq('account_id', selectedAccount.id)
          .eq('asset_id', selectedAsset.id)
          .gt('remaining_quantity', 0)
          .order('purchase_date', { ascending: true })

        if (lotsErr) throw lotsErr
        if (!lots || lots.length === 0) throw new Error('No open lots to sell from')

        let remaining = qty!
        let basis_sold = 0

        for (const lot of lots) {
          if (remaining <= 0) break
          const deplete = Math.min(remaining, lot.remaining_quantity)
          basis_sold += deplete * lot.cost_basis_per_unit
          remaining -= deplete

          if (lot.remaining_quantity - deplete > 0) {
            await supabaseClient
              .from('tax_lots')
              .update({ remaining_quantity: lot.remaining_quantity - deplete })
              .eq('id', lot.id)
          } else {
            await supabaseClient.from('tax_lots').delete().eq('id', lot.id)
          }
        }

        if (remaining > 0) throw new Error('Insufficient shares in open lots')

        const proceeds = qty! * prc! - fs
        const realized_gain = proceeds - basis_sold

        const { data: updated, error: updateErr } = await supabaseClient
          .from('transactions')
          .update({ realized_gain })
          .eq('id', updatedTx.id)
          .select(`
            *,
            account:accounts (name, type),
            asset:assets (ticker, name)
          `)
          .single()

        if (updateErr) throw updateErr
        updatedTx = updated
      }

      // Refetch for full sync (lots/gains/Holdings)
      router.refresh()

      // Optimistic local update
      if (editingTx) {
        setTransactions(transactions.map(t => t.id === updatedTx.id ? updatedTx : t))
      } else {
        setTransactions([updatedTx, ...transactions])
      }

      setOpen(false)
      resetForm()
    } catch (err: any) {
      console.error(err)
      alert('Error: ' + err.message + '. Editing/deleting sells may require manual lot fixes in Tax Lots page.')
    }
  }

  const handleDelete = async () => {
    if (!deleteConfirmId) return
    try {
      await supabaseClient.from('transactions').delete().eq('id', deleteConfirmId)
      setTransactions(transactions.filter(t => t.id !== deleteConfirmId))
      router.refresh() // Sync lots/Holdings
      setDeleteConfirmId(null)
    } catch (err) {
      alert('Delete failed. Manual lot fix in Tax Lots page recommended.')
    }
  }

  return (
    <main className="p-8">
      <div className="flex justify-between items-center mb-8">
        <h1 className="text-3xl font-bold">Transactions</h1>
        <div className="flex gap-4 items-center">
          <Input
            placeholder="Search..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-64"
          />
          <Dialog open={open} onOpenChange={(isOpen) => {
            setOpen(isOpen)
            if (!isOpen) resetForm()
          }}>
            <DialogTrigger asChild>
              <Button>{editingTx ? 'Edit' : 'Add'} Transaction</Button>
            </DialogTrigger>
            <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
              <DialogHeader>
                <DialogTitle>{editingTx ? 'Edit' : 'Add'} Transaction</DialogTitle>
              </DialogHeader>
              <form onSubmit={handleSubmit} className="space-y-6">
                {/* Full form as in your original (Account, Asset, Type, Date, conditional fields, Notes) */}
                {/* ... (copy your existing form JSX here - unchanged) */}
              </form>
            </DialogContent>
          </Dialog>
        </div>
      </div>

      {displayTransactions.length > 0 ? (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead onClick={() => toggleSort('date')} className="cursor-pointer">
                Date <ArrowUpDown className="inline h-4 w-4" />
              </TableHead>
              <TableHead onClick={() => toggleSort('account_name')} className="cursor-pointer">
                Account <ArrowUpDown className="inline h-4 w-4" />
              </TableHead>
              <TableHead onClick={() => toggleSort('asset_ticker')} className="cursor-pointer">
                Asset <ArrowUpDown className="inline h-4 w-4" />
              </TableHead>
              <TableHead onClick={() => toggleSort('type')} className="cursor-pointer">
                Type <ArrowUpDown className="inline h-4 w-4" />
              </TableHead>
              <TableHead className="text-right cursor-pointer" onClick={() => toggleSort('quantity')}>
                Quantity <ArrowUpDown className="inline h-4 w-4" />
              </TableHead>
              <TableHead className="text-right cursor-pointer" onClick={() => toggleSort('price_per_unit')}>
                Price/Unit <ArrowUpDown className="inline h-4 w-4" />
              </TableHead>
              <TableHead className="text-right cursor-pointer" onClick={() => toggleSort('amount')}>
                Amount <ArrowUpDown className="inline h-4 w-4" />
              </TableHead>
              <TableHead className="text-right cursor-pointer" onClick={() => toggleSort('fees')}>
                Fees <ArrowUpDown className="inline h-4 w-4" />
              </TableHead>
              <TableHead className="text-right cursor-pointer" onClick={() => toggleSort('realized_gain')}>
                Realized Gain/Loss <ArrowUpDown className="inline h-4 w-4" />
              </TableHead>
              <TableHead>Notes</TableHead>
              <TableHead>Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {displayTransactions.map((tx) => (
              <TableRow key={tx.id}>
                <TableCell>{tx.date}</TableCell>
                <TableCell>{tx.account?.name || '-'}</TableCell>
                <TableCell>
                  {tx.asset?.ticker || '-'}
                  {tx.asset?.name && ` - ${tx.asset.name}`}
                </TableCell>
                <TableCell>{tx.type}</TableCell>
                <TableCell className="text-right">
                  {tx.quantity != null ? Number(tx.quantity).toFixed(8) : '-'}
                </TableCell>
                <TableCell className="text-right">
                  {tx.price_per_unit != null ? `$${Number(tx.price_per_unit).toFixed(2)}` : '-'}
                </TableCell>
                <TableCell className="text-right">
                  {tx.amount != null ? `$${Number(tx.amount).toFixed(5)}` : '-'}
                </TableCell>
                <TableCell className="text-right">
                  {tx.fees != null ? `$${Number(tx.fees).toFixed(5)}` : '-'}
                </TableCell>
                <TableCell className={cn(
                  "text-right font-medium",
                  (tx.realized_gain ?? 0) > 0 ? 'text-green-600' : (tx.realized_gain ?? 0) < 0 ? 'text-red-600' : ''
                )}>
                  {tx.realized_gain != null ? `$${Number(tx.realized_gain).toFixed(5)}` : '-'}
                </TableCell>
                <TableCell>{tx.notes || '-'}</TableCell>
                <TableCell className="flex gap-2">
                  <Button variant="ghost" size="sm" onClick={() => openEdit(tx)}>
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
                        <AlertDialogTitle>Delete Transaction?</AlertDialogTitle>
                        <AlertDialogDescription>
                          This may affect FIFO gains on later sells. Use Tax Lots page to fix manually.
                        </AlertDialogDescription>
                      </AlertDialogHeader>
                      <AlertDialogFooter>
                        <AlertDialogCancel>Cancel</AlertDialogCancel>
                        <AlertDialogAction onClick={() => setDeleteConfirmId(tx.id)}>Delete</AlertDialogAction>
                      </AlertDialogFooter>
                    </AlertDialogContent>
                  </AlertDialog>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      ) : (
        <p className="text-muted-foreground">No transactions yet. Add one to get started!</p>
      )}

      {/* Delete confirm */}
      <AlertDialog open={!!deleteConfirmId} onOpenChange={(o) => !o && setDeleteConfirmId(null)}>
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