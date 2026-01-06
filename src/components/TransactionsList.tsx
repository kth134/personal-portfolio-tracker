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
import { CalendarIcon, Check, ChevronsUpDown } from 'lucide-react'
import { cn } from '@/lib/utils'
import { format } from 'date-fns'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'

type Account = { id: string; name: string; type: string }
type Asset = { id: string; ticker: string; name?: string }

type Transaction = {
  id: string
  date: string
  type: string
  quantity?: number
  price_per_unit?: number
  amount?: number
  fees?: number
  realized_gain?: number
  notes?: string
  account: { name: string; type?: string } | null
  asset: { ticker: string; name?: string } | null
}

type TransactionsListProps = {
  initialTransactions: Transaction[]
}

export default function TransactionsList({ initialTransactions }: TransactionsListProps) {
  const router = useRouter()
  const [transactions, setTransactions] = useState(initialTransactions)
  const [open, setOpen] = useState(false)

  // Form state
  const [accounts, setAccounts] = useState<Account[]>([])
  const [assets, setAssets] = useState<Asset[]>([])
  const [selectedAccount, setSelectedAccount] = useState<Account | null>(null)
  const [selectedAsset, setSelectedAsset] = useState<Asset | null>(null)
  const [type, setType] = useState<'Buy' | 'Sell' | 'Dividend'>('Buy')
  const [date, setDate] = useState<Date | undefined>(undefined)
  const [quantity, setQuantity] = useState('')
  const [price, setPrice] = useState('')
  const [dividendAmount, setDividendAmount] = useState('') // Manual amount for Dividend
  const [fees, setFees] = useState('')
  const [notes, setNotes] = useState('')

  // Fetch accounts & assets for selects
  useEffect(() => {
    const fetchData = async () => {
      const { data: accs } = await supabaseClient.from('accounts').select('id, name, type')
      const { data: asts } = await supabaseClient.from('assets').select('id, ticker, name')
      setAccounts(accs || [])
      setAssets(asts || [])
    }
    fetchData()
  }, [])

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
      // Buy or Sell
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
      // Insert transaction
      const { data: tx, error: txErr } = await supabaseClient
        .from('transactions')
        .insert({
          account_id: selectedAccount.id,
          asset_id: selectedAsset.id,
          date: format(date, 'yyyy-MM-dd'),
          type,
          quantity: qty,
          price_per_unit: prc,
          amount: amt,
          fees: fs || null,
          notes: notes || null,
          realized_gain: null,
        })
        .select(`
          *,
          account:accounts (name, type),
          asset:assets (ticker, name)
        `)
        .single()

      if (txErr) throw txErr

      let updatedTx = tx

      if (type === 'Buy') {
        const basis_per_unit = Math.abs(amt) / qty!
        const { error: lotErr } = await supabaseClient.from('tax_lots').insert({
          account_id: selectedAccount.id,
          asset_id: selectedAsset.id,
          purchase_date: format(date, 'yyyy-MM-dd'),
          quantity: qty!,
          cost_basis_per_unit: basis_per_unit,
          remaining_quantity: qty!,
        })
        if (lotErr) throw lotErr
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
          .eq('id', tx.id)
          .select(`
            *,
            account:accounts (name, type),
            asset:assets (ticker, name)
          `)
          .single()

        if (updateErr) throw updateErr
        updatedTx = updated
      }
      // Dividend: no lot handling

      // Optimistic update: prepend new transaction
      setTransactions([updatedTx, ...transactions])
      setOpen(false)
      resetForm()
    } catch (err: any) {
      console.error(err)
      alert('Error: ' + err.message)
    }
  }

  return (
    <main className="p-8">
      <div className="flex justify-between items-center mb-8">
        <h1 className="text-3xl font-bold">Transactions</h1>
        <Dialog open={open} onOpenChange={(isOpen) => {
          setOpen(isOpen)
          if (!isOpen) resetForm()
        }}>
          <DialogTrigger asChild>
            <Button>Add Transaction</Button>
          </DialogTrigger>
          <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle>Add Transaction</DialogTitle>
            </DialogHeader>
            <form onSubmit={handleSubmit} className="space-y-6">
              {/* Account Combobox */}
              <div>
                <Label>Account *</Label>
                <Popover>
                  <PopoverTrigger asChild>
                    <Button variant="outline" className="w-full justify-between">
                      {selectedAccount ? `${selectedAccount.name} (${selectedAccount.type})` : 'Select account'}
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
                            <CommandItem
                              key={acc.id}
                              onSelect={() => setSelectedAccount(acc)}
                            >
                              <Check className={cn('mr-2 h-4 w-4', selectedAccount?.id === acc.id ? 'opacity-100' : 'opacity-0')} />
                              {acc.name} ({acc.type})
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
                      {selectedAsset ? `${selectedAsset.ticker} ${selectedAsset.name ? `- ${selectedAsset.name}` : ''}` : 'Select asset'}
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
                            <CommandItem
                              key={ast.id}
                              onSelect={() => setSelectedAsset(ast)}
                            >
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

              {/* Type */}
              <div>
                <Label>Type *</Label>
                <Select onValueChange={(v) => setType(v as 'Buy' | 'Sell' | 'Dividend')} value={type} required>
                  <SelectTrigger><SelectValue placeholder="Select type" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="Buy">Buy</SelectItem>
                    <SelectItem value="Sell">Sell</SelectItem>
                    <SelectItem value="Dividend">Dividend</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              {/* Date */}
              <div>
                <Label>Date *</Label>
                <Popover>
                  <PopoverTrigger asChild>
                    <Button variant="outline" className={cn('w-full justify-start text-left font-normal', !date && 'text-muted-foreground')}>
                      <CalendarIcon className="mr-2 h-4 w-4" />
                      {date ? format(date, 'PPP') : 'Pick a date'}
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent className="w-auto p-0">
                    <Calendar mode="single" selected={date} onSelect={setDate} initialFocus />
                  </PopoverContent>
                </Popover>
              </div>

              {/* Conditional fields based on type */}
              {type === 'Dividend' ? (
                <>
                  <div>
                    <Label>Dividend Amount (positive) *</Label>
                    <Input 
                      type="number" 
                      step="0.00001" 
                      value={dividendAmount} 
                      onChange={(e) => setDividendAmount(e.target.value)} 
                      required 
                    />
                  </div>
                  <div>
                    <Label>Fees (optional)</Label>
                    <Input 
                      type="number" 
                      step="0.00001" 
                      value={fees} 
                      onChange={(e) => setFees(e.target.value)} 
                    />
                  </div>
                </>
              ) : (
                <div className="grid grid-cols-3 gap-4">
                  <div>
                    <Label>Quantity *</Label>
                    <Input 
                      type="number" 
                      step="0.00000001" 
                      value={quantity} 
                      onChange={(e) => setQuantity(e.target.value)} 
                      required 
                    />
                  </div>
                  <div>
                    <Label>Price per Unit *</Label>
                    <Input 
                      type="number" 
                      step="0.00000001" 
                      value={price} 
                      onChange={(e) => setPrice(e.target.value)} 
                      required 
                    />
                  </div>
                  <div>
                    <Label>Fees (optional)</Label>
                    <Input 
                      type="number" 
                      step="0.00001" 
                      value={fees} 
                      onChange={(e) => setFees(e.target.value)} 
                    />
                  </div>
                </div>
              )}

              {/* Notes */}
              <div>
                <Label>Notes</Label>
                <Input value={notes} onChange={(e) => setNotes(e.target.value)} />
              </div>

              <Button type="submit" className="w-full">Save Transaction</Button>
            </form>
          </DialogContent>
        </Dialog>
      </div>

      {/* Transactions Table */}
      {transactions.length > 0 ? (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Date</TableHead>
              <TableHead>Account</TableHead>
              <TableHead>Asset</TableHead>
              <TableHead>Type</TableHead>
              <TableHead className="text-right">Quantity</TableHead>
              <TableHead className="text-right">Price/Unit</TableHead>
              <TableHead className="text-right">Amount</TableHead>
              <TableHead className="text-right">Fees</TableHead>
              <TableHead className="text-right">Realized Gain/Loss</TableHead>
              <TableHead>Notes</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {transactions.map((tx) => (
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
              </TableRow>
            ))}
          </TableBody>
        </Table>
      ) : (
        <p className="text-muted-foreground">No transactions yet. Add one to get started!</p>
      )}
    </main>
  )
}