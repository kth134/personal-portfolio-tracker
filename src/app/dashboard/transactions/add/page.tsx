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
import { Calendar } from '@/components/ui/calendar' // Assume shadcn calendar installed
import { CalendarIcon, Check, ChevronsUpDown } from 'lucide-react'
import { cn } from '@/lib/utils'
import { format } from 'date-fns'

type Account = { id: string; name: string; type: string }
type Asset = { id: string; ticker: string; name?: string }

export default function AddTransactionPage() {
  const router = useRouter()

  const [accounts, setAccounts] = useState<Account[]>([])
  const [assets, setAssets] = useState<Asset[]>([])
  const [selectedAccount, setSelectedAccount] = useState<Account | null>(null)
  const [selectedAsset, setSelectedAsset] = useState<Asset | null>(null)
  const [type, setType] = useState<'Buy' | 'Sell'>()
  const [date, setDate] = useState<Date>()
  const [quantity, setQuantity] = useState('')
  const [price, setPrice] = useState('')
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

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!selectedAccount || !selectedAsset || !type || !date || !quantity || !price) {
      alert('Please fill all required fields')
      return
    }

    const qty = Number(quantity)
    const prc = Number(price)
    const fs = Number(fees || 0)
    const gross = qty * prc
    const total = type === 'Buy' ? gross + fs : gross - fs
    const amount = type === 'Buy' ? -total : total // Signed cash flow

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
          amount,
          fees: fs || null,
          notes: notes || null,
          realized_gain: null, // Temp; updated on sell below
        })
        .select()
        .single()

      if (txErr) throw txErr

      if (type === 'Buy') {
        const basis_per_unit = total / qty
        const { error: lotErr } = await supabaseClient.from('tax_lots').insert({
          account_id: selectedAccount.id,
          asset_id: selectedAsset.id,
          purchase_date: format(date, 'yyyy-MM-dd'),
          quantity: qty,
          cost_basis_per_unit: basis_per_unit,
          remaining_quantity: qty,
        })
        if (lotErr) throw lotErr
      } else if (type === 'Sell') {
        // FIFO depletion
        const { data: lots, error: lotsErr } = await supabaseClient
          .from('tax_lots')
          .select('*')
          .eq('account_id', selectedAccount.id)
          .eq('asset_id', selectedAsset.id)
          .gt('remaining_quantity', 0)
          .order('purchase_date', { ascending: true })

        if (lotsErr) throw lotsErr
        if (!lots || lots.length === 0) throw new Error('No open lots to sell from')

        let remaining = qty
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

        const proceeds = gross - fs
        const realized_gain = proceeds - basis_sold

        // Update tx with gain
        const { error: updateErr } = await supabaseClient
          .from('transactions')
          .update({ realized_gain })
          .eq('id', tx.id)

        if (updateErr) throw updateErr
      }

      router.push('/dashboard/transactions') // Or wherever your list is
    } catch (err: any) {
      console.error(err)
      alert('Error: ' + err.message)
    }
  }

  return (
    <main className="p-8 max-w-2xl mx-auto">
      <h1 className="text-3xl font-bold mb-8">Add Transaction</h1>
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
          <Select onValueChange={(v) => setType(v as 'Buy' | 'Sell')} required>
            <SelectTrigger><SelectValue placeholder="Select type" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="Buy">Buy</SelectItem>
              <SelectItem value="Sell">Sell</SelectItem>
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

        {/* Quantity, Price, Fees */}
        <div className="grid grid-cols-3 gap-4">
          <div>
            <Label>Quantity *</Label>
            <Input type="number" step="any" value={quantity} onChange={(e) => setQuantity(e.target.value)} required />
          </div>
          <div>
            <Label>Price per Unit *</Label>
            <Input type="number" step="any" value={price} onChange={(e) => setPrice(e.target.value)} required />
          </div>
          <div>
            <Label>Fees</Label>
            <Input type="number" step="any" value={fees} onChange={(e) => setFees(e.target.value)} />
          </div>
        </div>

        {/* Notes */}
        <div>
          <Label>Notes</Label>
          <Input value={notes} onChange={(e) => setNotes(e.target.value)} />
        </div>

        <Button type="submit" className="w-full">Save Transaction</Button>
      </form>
    </main>
  )
}