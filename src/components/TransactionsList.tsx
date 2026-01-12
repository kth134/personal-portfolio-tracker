'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from '@/components/ui/command'
import { Calendar } from '@/components/ui/calendar'
import { CalendarIcon, Check, ChevronsUpDown, Edit2, Trash2, ArrowUpDown } from 'lucide-react'
import { cn } from '@/lib/utils'
import { format, parseISO } from 'date-fns'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog'
import { formatUSD } from '@/lib/formatters';
import Papa from 'papaparse';


type Account = { id: string; name: string; type: string }
type Asset = { id: string; ticker: string; name?: string }

type Transaction = {
  id: string
  date: string
  type: 'Buy' | 'Sell' | 'Dividend' | 'Deposit' | 'Withdrawal' | 'Interest'
  quantity?: number | null
  price_per_unit?: number | null
  amount?: number | null
  fees?: number | null
  realized_gain?: number | null
  notes?: string | null
  account_id: string
  asset_id: string
  account: { name: string; type?: string } | null
  asset: { ticker: string; name?: string } | null
  funding_source?: 'cash' | 'external' | null
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
  const [deletingTx, setDeletingTx] = useState<Transaction | null>(null)
  const [isImporting, setIsImporting] = useState(false);
  const [importStatus, setImportStatus] = useState<{
    total: number;
    current: number;
    successes: number;
    failures: number;
    errors: string[];
  } | null>(null);
  // Search & sort
  const [search, setSearch] = useState('')
  const [sortKey, setSortKey] = useState<keyof Transaction | 'account_name' | 'asset_ticker'>('date')
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc')

  // Form state
  const [accounts, setAccounts] = useState<Account[]>([])
  const [assets, setAssets] = useState<Asset[]>([])
  const [selectedAccount, setSelectedAccount] = useState<Account | null>(null)
  const [selectedAsset, setSelectedAsset] = useState<Asset | null>(null)
  const [type, setType] = useState<Transaction['type']>('Buy')
  const [date, setDate] = useState<Date | undefined>(undefined)
  const [quantity, setQuantity] = useState('')
  const [price, setPrice] = useState('')
  const [dividendAmount, setDividendAmount] = useState('')
  const [fees, setFees] = useState('')
  const [notes, setNotes] = useState('')
  const [fundingSource, setFundingSource] = useState<'cash' | 'external'>('cash')

  const isBuyOrSellEdit = !!editingTx && (editingTx.type === 'Buy' || editingTx.type === 'Sell')
  const disableSelects = !!editingTx
  const disableCriticalFields = isBuyOrSellEdit

  // Fetch accounts & assets
  useEffect(() => {
    const fetchData = async () => {
      const supabase = createClient()
      const { data: accs } = await supabase.from('accounts').select('id, name, type').order('name')
      const { data: asts } = await supabase.from('assets').select('id, ticker, name').order('ticker')
      setAccounts(accs || [])
      setAssets(asts || [])
    }
    fetchData()
  }, [])

  // Clear conditional fields when type changes
  useEffect(() => {
    if (['Dividend', 'Interest'].includes(type)) {
      setQuantity('')
      setPrice('')
    } else if (['Buy', 'Sell'].includes(type)) {
      setDividendAmount('')
    } else {
      // For Deposit/Withdrawal: Clear all conditional
      setQuantity('')
      setPrice('')
    }
    if (type !== 'Buy') setFundingSource('cash')  // Reset if not Buy
  }, [type])

  // Search + sort effect
  useEffect(() => {
    let list = [...transactions]

    if (search) {
      const low = search.toLowerCase()
      list = list.filter(tx =>
        tx.asset?.ticker.toLowerCase().includes(low) ||
        tx.asset?.name?.toLowerCase().includes(low) ||
        tx.account?.name.toLowerCase().includes(low) ||
        tx.notes?.toLowerCase().includes(low) ||
        tx.type.toLowerCase().includes(low)
      )
    }

    list.sort((a, b) => {
      const aVal: any = sortKey === 'account_name' ? a.account?.name ?? null :
                     sortKey === 'asset_ticker' ? a.asset?.ticker ?? null :
                     a[sortKey as keyof Transaction] ?? null
      const bVal: any = sortKey === 'account_name' ? b.account?.name ?? null :
                     sortKey === 'asset_ticker' ? b.asset?.ticker ?? null :
                     b[sortKey as keyof Transaction] ?? null

      if (aVal === null) return 1
      if (bVal === null) return -1

      if (typeof aVal === 'number' && typeof bVal === 'number') {
        return sortDir === 'asc' ? aVal - bVal : bVal - aVal
      }

      const aStr = String(aVal).toLowerCase()
      const bStr = String(bVal).toLowerCase()
      return sortDir === 'asc' ? aStr.localeCompare(bStr) : bStr.localeCompare(aStr)
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
    setFundingSource('cash')
    setEditingTx(null)
  }

  const openEdit = (tx: Transaction) => {
    setEditingTx(tx)
    setSelectedAccount(accounts.find(a => a.id === tx.account_id) || null)
    setSelectedAsset(assets.find(a => a.id === tx.asset_id) || null)
    setType(tx.type)
    setDate(parseISO(tx.date))
    setQuantity(tx.type !== 'Dividend' ? (tx.quantity?.toString() || '') : '')
    setPrice(tx.type !== 'Dividend' ? (tx.price_per_unit?.toString() || '') : '')
    setDividendAmount(tx.type === 'Dividend' ? (tx.amount?.toString() || '') : '')
    setFees(tx.fees?.toString() || '')
    setNotes(tx.notes || '')
    setFundingSource(tx.funding_source || 'cash')
    setOpen(true)
  }

  const handleDownloadTemplate = () => {
    // Build dynamic lists
    const accountList = accounts.length > 0
      ? accounts.map(acc => `# - ${acc.name} (${acc.type || 'N/A'})`).join('\n')
      : '# - (No accounts yet—add some in the app first)';

    const assetList = assets.length > 0
      ? assets.map(ast => `# - ${ast.ticker}${ast.name ? ` - ${ast.name}` : ''}`).join('\n')
      : '# - (No assets yet—add some in the app first)';

    const templateContent = `
# Transaction Import CSV Template
# - Date: Required, format YYYY-MM-DD
# - Account: Required, exact account name (case-insensitive). See list below.
# - Asset: Required for Buy/Sell/Dividend (ticker, case-insensitive); blank for others. See list below.
# - Type: Required (Buy, Sell, Dividend, Deposit, Withdrawal, Interest)
# - Quantity: For Buy/Sell (positive number)
# - PricePerUnit: For Buy/Sell (positive number)
# - Amount: For Dividend/Interest/Deposit/Withdrawal (positive; auto-negated for Withdrawal)
# - Fees: Optional (number, defaults to 0)
# - Notes: Optional (string)
# - FundingSource: For Buy only (cash or external; defaults to cash)
# Sort rows oldest to newest for best results (FIFO sells).
# Empty lines skipped. Headers case-insensitive.

# Available Accounts:
${accountList}

# Available Assets:
${assetList}

Date,Account,Asset,Type,Quantity,PricePerUnit,Amount,Fees,Notes,FundingSource
2024-01-17,KH Traditional IRA,FBTC,Buy,4.38604,37.25,,0,Initial buy,external
2025-01-02,AH Roth IRA,FBTC,Sell,31.437,88.47,,0,Partial sell,
2025-03-01,KH Traditional IRA,,Dividend,, ,50.00,0,Quarterly dividend,
2025-04-01,KH Traditional IRA,,Deposit,, ,1000.00,0,Monthly contribution,
    `.trim();

    const blob = new Blob([templateContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = 'transaction-import-template.csv';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };
  
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    const supabase = createClient()
    if (!selectedAccount || !type || !date) {
      alert('Please fill all required fields')
      return
    }
    if (['Buy', 'Sell'].includes(type) && !selectedAsset) {
      alert('Asset required for Buy/Sell')
      return
    }

    let qty: number | null = null
    let prc: number | null = null
    let amt: number = 0
    const fs = Number(fees || 0)

    if (['Dividend', 'Interest', 'Deposit', 'Withdrawal'].includes(type)) {
      amt = Number(dividendAmount)
      if (isNaN(amt) || amt <= 0) {
        alert('Positive amount required')
        return
      }
      if (type === 'Withdrawal') amt = -amt
    } else {
      qty = Number(quantity)
      prc = Number(price)
      if (isNaN(qty) || qty <= 0 || isNaN(prc) || prc <= 0) {
        alert('Positive quantity and price required for Buy/Sell')
        return
      }
      const gross = qty * prc
      amt = type === 'Buy' ? -(gross + fs) : (gross - fs)
    }

    try {
      const txData = {
        account_id: selectedAccount.id,
        asset_id: selectedAsset?.id || null,
        date: format(date, 'yyyy-MM-dd'),
        type,
        quantity: qty,
        price_per_unit: prc,
        amount: amt,
        fees: fs || null,
        notes: notes || null,
        funding_source: type === 'Buy' ? fundingSource : null,
      }

      let updatedTx: Transaction

      if (editingTx) {
        const { data, error } = await supabase
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
        const { data, error } = await supabase
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

        if (type === 'Buy' && qty && prc && selectedAsset) {
          if (fundingSource === 'external') {
            const depositAmt = Math.abs(amt)
            const depositData = {
              account_id: selectedAccount.id,
              asset_id: null,
              date: format(date, 'yyyy-MM-dd'),
              type: 'Deposit' as const,
              amount: depositAmt,
              notes: `Auto-deposit for external buy of ${selectedAsset.ticker || 'asset'}`,
            }
            await supabase.from('transactions').insert(depositData)
          }
          const basis_per_unit = Math.abs(amt) / qty
          await supabase.from('tax_lots').insert({
            account_id: selectedAccount.id,
            asset_id: selectedAsset.id,
            purchase_date: format(date, 'yyyy-MM-dd'),
            quantity: qty,
            cost_basis_per_unit: basis_per_unit,
            remaining_quantity: qty,
          })
        } else if (type === 'Sell' && qty && prc) {
          const { data: lots } = await supabase
            .from('tax_lots')
            .select('*')
            .eq('account_id', selectedAccount.id)
            .eq('asset_id', selectedAsset?.id)
            .gt('remaining_quantity', 0)
            .order('purchase_date', { ascending: true })

          if (!lots || lots.length === 0) throw new Error('No open lots')

          let remaining = qty
          let basis_sold = 0

          for (const lot of lots) {
            if (remaining <= 0) break
            const deplete = Math.min(remaining, lot.remaining_quantity)
            basis_sold += deplete * lot.cost_basis_per_unit
            remaining -= deplete

            if (lot.remaining_quantity - deplete > 0) {
              await supabase
                .from('tax_lots')
                .update({ remaining_quantity: lot.remaining_quantity - deplete })
                .eq('id', lot.id)
            } else {
              await supabase.from('tax_lots').delete().eq('id', lot.id)
            }
          }

          if (remaining > 0) throw new Error('Insufficient shares')

          const proceeds = qty * prc - fs
          const realized_gain = proceeds - basis_sold

          const { data: finalTx } = await supabase
            .from('transactions')
            .update({ realized_gain })
            .eq('id', updatedTx.id)
            .select(`
              *,
              account:accounts (name, type),
              asset:assets (ticker, name)
            `)
            .single()

          updatedTx = finalTx!
        }
      }

      router.refresh()
      if (editingTx) {
        setTransactions(transactions.map(t => t.id === updatedTx.id ? updatedTx : t))
      } else {
        setTransactions([updatedTx, ...transactions])
      }

      setOpen(false)
      resetForm()
    } catch (err: any) {
      console.error(err)
      alert('Error: ' + err.message)
    }
  }

  const processSingleTransaction = async (
  txInput: {
    date: string;
    account_id: string;
    asset_id: string | null;
    type: Transaction['type'];
    quantity?: number;
    price_per_unit?: number;
    amount?: number;
    fees?: number;
    notes?: string;
    funding_source?: 'cash' | 'external';
  }
) => {
  const supabase = createClient();

  let qty: number | null = txInput.quantity ?? null;
  let prc: number | null = txInput.price_per_unit ?? null;
  let amt = txInput.amount ?? 0;
  const fs = txInput.fees ?? 0;

  // Normalize amount sign for Withdrawals
  if (txInput.type === 'Withdrawal') amt = -Math.abs(amt);

  const txData = {
    account_id: txInput.account_id,
    asset_id: txInput.asset_id,
    date: txInput.date,
    type: txInput.type,
    quantity: qty,
    price_per_unit: prc,
    amount: amt,
    fees: fs || null,
    notes: txInput.notes || null,
    funding_source: txInput.type === 'Buy' ? (txInput.funding_source || 'cash') : null,
  };

  // Insert transaction
  const { data: newTx, error: txError } = await supabase
    .from('transactions')
    .insert(txData)
    .select('*')
    .single();

  if (txError) throw txError;

  // Handle Buy logic (tax lot + optional auto-deposit)
  if (txInput.type === 'Buy' && qty && prc && txInput.asset_id) {
    if (txInput.funding_source === 'external') {
      const depositAmt = Math.abs(amt);
      await supabase.from('transactions').insert({
        account_id: txInput.account_id,
        asset_id: null,
        date: txInput.date,
        type: 'Deposit',
        amount: depositAmt,
        notes: `Auto-deposit for external buy of ${txInput.asset_id}`,
      });
    }

    const basis_per_unit = Math.abs(amt) / qty;
    await supabase.from('tax_lots').insert({
      account_id: txInput.account_id,
      asset_id: txInput.asset_id,
      purchase_date: txInput.date,
      quantity: qty,
      cost_basis_per_unit: basis_per_unit,
      remaining_quantity: qty,
    });
  }

  // Handle Sell logic (FIFO depletion + realized gain)
  else if (txInput.type === 'Sell' && qty && prc && txInput.asset_id) {
    const { data: lots, error: lotsError } = await supabase
      .from('tax_lots')
      .select('*')
      .eq('account_id', txInput.account_id)
      .eq('asset_id', txInput.asset_id)
      .gt('remaining_quantity', 0)
      .order('purchase_date', { ascending: true });

    if (lotsError || !lots?.length) throw new Error('No open tax lots for this sell');

    let remainingToSell = qty;
    let basisSold = 0;

    for (const lot of lots) {
      if (remainingToSell <= 0) break;
      const deplete = Math.min(remainingToSell, lot.remaining_quantity);
      basisSold += deplete * lot.cost_basis_per_unit;
      remainingToSell -= deplete;

      if (lot.remaining_quantity - deplete > 0) {
        await supabase
          .from('tax_lots')
          .update({ remaining_quantity: lot.remaining_quantity - deplete })
          .eq('id', lot.id);
      } else {
        await supabase.from('tax_lots').delete().eq('id', lot.id);
      }
    }

    if (remainingToSell > 0) throw new Error('Insufficient shares in tax lots');

    const proceeds = qty * prc - fs;
    const realized_gain = proceeds - basisSold;

    await supabase
      .from('transactions')
      .update({ realized_gain })
      .eq('id', newTx.id);
  }

  return newTx;
};

const handleCsvImport = (e: React.ChangeEvent<HTMLInputElement>) => {
  const file = e.target.files?.[0];
  if (!file) return;

  setIsImporting(true);
  setImportStatus(null);

  Papa.parse(file, {
    header: true,
    skipEmptyLines: 'greedy',
    transformHeader: (h) => h.trim().toLowerCase().replace(/\s+/g, ''),
    complete: async (results) => {
      const { data: rows, errors: parseErrors } = results;
      if (parseErrors.length > 0) {
        alert(`CSV parsing issues:\n${parseErrors.map(e => e.message).join('\n')}`);
        setIsImporting(false);
        return;
      }

      const total = rows.length;
      if (total > 2000) {
        if (!confirm(`Large file: ${total} rows.\nThis may take 10–60+ seconds.\nProceed?`)) {
          setIsImporting(false);
          return;
        }
      }

      const progress = {
        total,
        current: 0,
        successes: 0,
        failures: 0,
        errors: [] as string[],
      };
      setImportStatus(progress);

      // Quick date order warning
      const dates = rows.map((r: any) => r.date || r.Date).filter(Boolean);
      if (dates.length > 1 && new Date(dates[0]) > new Date(dates[1])) {
        alert("Heads up: CSV doesn't appear sorted oldest → newest.\nFIFO sells may fail if buys come after. Consider sorting first.");
      }

      for (const [index, rawRow] of (rows as any[]).entries()) {
        progress.current = index + 1;
        setImportStatus({ ...progress });

        try {
          const row = Object.fromEntries(
            Object.entries(rawRow).map(([k, v]) => [k.toLowerCase(), v?.toString().trim()])
          );

          const dateStr = row.date || '';
          const accountName = row.account || '';
          const assetTicker = row.asset || row.ticker || '';
          const typeRaw = row.type || '';

          if (!dateStr || !accountName || !typeRaw) {
            throw new Error('Missing required: date, account, type');
          }

          const type = typeRaw.charAt(0).toUpperCase() + typeRaw.slice(1).toLowerCase() as Transaction['type'];
          if (!['Buy','Sell','Dividend','Deposit','Withdrawal','Interest'].includes(type)) {
            throw new Error(`Invalid type: ${typeRaw}`);
          }

          const account = accounts.find(a => a.name.toLowerCase() === accountName.toLowerCase());
          if (!account) throw new Error(`Account not found: "${accountName}"`);

          let assetId: string | null = null;
          if (['Buy','Sell','Dividend'].includes(type)) {
            if (!assetTicker) throw new Error('Asset required for Buy/Sell/Dividend');
            const asset = assets.find(a => a.ticker.toLowerCase() === assetTicker.toLowerCase());
            if (!asset) throw new Error(`Asset not found: "${assetTicker}"`);
            assetId = asset.id;
          }

          const parsedDate = parseISO(dateStr);
          if (isNaN(parsedDate.getTime())) throw new Error('Invalid date');

          await processSingleTransaction({
            date: format(parsedDate, 'yyyy-MM-dd'),
            account_id: account.id,
            asset_id: assetId,
            type,
            quantity: row.quantity ? Number(row.quantity) : undefined,
            price_per_unit: row.priceperunit ? Number(row.priceperunit) : undefined,
            amount: row.amount ? Number(row.amount) : undefined,
            fees: row.fees ? Number(row.fees) : undefined,
            notes: row.notes || undefined,
            funding_source: row.fundingsource === 'external' ? 'external' : 'cash',
          });

          progress.successes++;
        } catch (err: any) {
          progress.failures++;
          progress.errors.push(`Row ${index + 2}: ${err.message || 'Unknown error'}`);
        }
      }

      setImportStatus({ ...progress, current: total });
      setIsImporting(false);

      if (progress.successes > 0) {
        router.refresh(); // Reload transactions & tax lots
      }

      // Show summary
      setTimeout(() => {
        alert(
          `Import complete!\n` +
          `Success: ${progress.successes}\n` +
          `Failed: ${progress.failures}${progress.errors.length ? ` (${progress.errors.length} with details)` : ''}\n\n` +
          (progress.errors.length ? 'First few errors:\n' + progress.errors.slice(0, 5).join('\n') : '')
        );
      }, 300);

      // Auto-hide progress bar
      setTimeout(() => {
        setImportStatus(null);
      }, 4000);
    },
    error: (err) => {
      alert('Failed to read CSV: ' + err.message);
      setIsImporting(false);
    },
  });

  e.target.value = ''; // Reset input
};

  const handleDelete = async () => {
    if (!deletingTx) return
    const supabase = createClient()

    try {
      if (deletingTx.type === 'Buy') {
        const expected_basis = Math.abs(deletingTx.amount ?? 0) / (deletingTx.quantity ?? 1)

        const { data: candidateLots } = await supabase
          .from('tax_lots')
          .select('*')
          .eq('account_id', deletingTx.account_id)
          .eq('asset_id', deletingTx.asset_id)
          .eq('purchase_date', deletingTx.date)

        if (candidateLots && candidateLots.length > 0) {
          const matchingLot = candidateLots.find((lot: any) =>
            Math.abs(lot.cost_basis_per_unit - expected_basis) < 0.01 &&
            Math.abs(lot.quantity - (deletingTx.quantity ?? 0)) < 0.00000001
          )

          if (matchingLot && matchingLot.remaining_quantity === matchingLot.quantity) {
            await supabase.from('tax_lots').delete().eq('id', matchingLot.id)
          } else {
            alert('Buy deleted, but the tax lot was partially sold or doesn\'t exactly match — please review/clean up manually on the Tax Lots page.')
          }
        }
      } else if (deletingTx.type === 'Sell') {
        alert('Sell deleted. To restore the sold shares, manually increase remaining_quantity on the oldest tax lots (FIFO order) on the Tax Lots page.')
      }
      // Dividend/others: no lot action

      await supabase.from('transactions').delete().eq('id', deletingTx.id)

      setTransactions(transactions.filter(t => t.id !== deletingTx.id))
      router.refresh()
      setDeletingTx(null)
    } catch (err: any) {
      console.error(err)
      alert('Delete failed: ' + err.message)
    }
  }

  return (
    <main className="container mx-auto py-8">
      <div className="flex justify-between items-center mb-8">
          <h1 className="text-3xl font-bold">Transactions</h1>
          <div className="flex gap-4 items-center flex-wrap">
          <Input
            placeholder="Search..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-64"
          />
          
          {/* Import Button */}
          <Button 
            variant="outline" 
            onClick={() => document.getElementById('csv-import-input')?.click()}
            disabled={isImporting}
          >
            Import CSV
          </Button>
          
          <input
            id="csv-import-input"
            type="file"
            accept=".csv"
            className="hidden"
            onChange={handleCsvImport}
          />

          <Button variant="outline" onClick={handleDownloadTemplate}>
            Download Template
          </Button>

          {importStatus && (
            <div className="mt-4 p-4 bg-muted rounded-lg">
              <div className="flex justify-between text-sm mb-1">
                <span>Importing {importStatus.current} / {importStatus.total}</span>
                <span>{importStatus.successes} ok · {importStatus.failures} failed</span>
              </div>
              <div className="w-full bg-secondary rounded-full h-2.5">
                <div
                  className="bg-primary h-2.5 rounded-full transition-all"
                  style={{ width: `${(importStatus.current / importStatus.total) * 100}%` }}
                />
              </div>
            </div>
          )}
          <Dialog open={open} onOpenChange={(isOpen) => {
            setOpen(isOpen)
            if (!isOpen) resetForm()
          }}>
            <DialogTrigger asChild>
              <Button>Add Transaction</Button>
            </DialogTrigger>
            <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
              <DialogHeader>
                <DialogTitle>{editingTx ? 'Edit' : 'Add'} Transaction</DialogTitle>
              </DialogHeader>

              {isBuyOrSellEdit && (
                <div className="bg-amber-50 border-l-4 border-amber-500 text-amber-900 p-4 mb-6 rounded">
                  <p className="font-medium">Important</p>
                  <p className="text-sm">Editing quantity, price, fees, date, account, asset, or type on Buy/Sell transactions is disabled to preserve tax lot accuracy. Delete and re-add if needed.</p>
                </div>
              )}

              <form onSubmit={handleSubmit} className="space-y-6">
                {/* 1. Type - now first */}
                <div className="space-y-2">
                  <Label>Type <span className="text-red-500">*</span></Label>
                  <Select value={type} onValueChange={(v) => setType(v as typeof type)} disabled={disableSelects}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="Buy">Buy</SelectItem>
                      <SelectItem value="Sell">Sell</SelectItem>
                      <SelectItem value="Dividend">Dividend</SelectItem>
                      <SelectItem value="Deposit">Deposit</SelectItem>
                      <SelectItem value="Withdrawal">Withdrawal</SelectItem>
                      <SelectItem value="Interest">Interest</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                {/* 2. Account */}
                <div className="space-y-2">
                  <Label>Account <span className="text-red-500">*</span></Label>
                  <Popover>
                    <PopoverTrigger asChild>
                      <Button variant="outline" role="combobox" className="w-full justify-between" disabled={disableSelects}>
                        {selectedAccount ? `${selectedAccount.name} (${selectedAccount.type})` : 'Select account...'}
                        <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                      </Button>
                    </PopoverTrigger>
                    <PopoverContent className="w-full p-0">
                      <Command>
                        <CommandInput placeholder="Search accounts..." />
                        <CommandList>
                          <CommandEmpty>No accounts found.</CommandEmpty>
                          <CommandGroup>
                            {accounts.map((acc) => (
                              <CommandItem
                                key={acc.id}
                                onSelect={() => setSelectedAccount(acc)}
                              >
                                <Check className={cn("mr-2 h-4 w-4", selectedAccount?.id === acc.id ? "opacity-100" : "opacity-0")} />
                                {acc.name} ({acc.type})
                              </CommandItem>
                            ))}
                          </CommandGroup>
                        </CommandList>
                      </Command>
                    </PopoverContent>
                  </Popover>
                </div>

                {/* 3. Asset - conditional */}
                {['Buy', 'Sell', 'Dividend'].includes(type) && (
                  <div className="space-y-2">
                    <Label>Asset <span className="text-red-500">*</span></Label>
                    <Popover>
                      <PopoverTrigger asChild>
                        <Button variant="outline" role="combobox" className="w-full justify-between" disabled={disableSelects}>
                          {selectedAsset
                            ? `${selectedAsset.ticker}${selectedAsset.name ? ` - ${selectedAsset.name}` : ''}`
                            : 'Select asset...'}
                          <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                        </Button>
                      </PopoverTrigger>
                      <PopoverContent className="w-full p-0">
                        <Command>
                          <CommandInput placeholder="Search assets..." />
                          <CommandList>
                            <CommandEmpty>No assets found.</CommandEmpty>
                            <CommandGroup>
                              {assets.map((ast) => (
                                <CommandItem
                                  key={ast.id}
                                  onSelect={() => setSelectedAsset(ast)}
                                >
                                  <Check className={cn("mr-2 h-4 w-4", selectedAsset?.id === ast.id ? "opacity-100" : "opacity-0")} />
                                  {ast.ticker}{ast.name ? ` - ${ast.name}` : ''}
                                </CommandItem>
                              ))}
                            </CommandGroup>
                          </CommandList>
                        </Command>
                      </PopoverContent>
                    </Popover>
                  </div>
                )}

                {/* 4. Date - moved down */}
                <div className="space-y-2">
                  <Label>Date <span className="text-red-500">*</span></Label>
                  <Popover>
                    <PopoverTrigger asChild>
                      <Button
                        variant="outline"
                        className={cn("w-full justify-start text-left font-normal", !date && "text-muted-foreground")}
                        disabled={disableCriticalFields}
                      >
                        {date ? format(date, "PPP") : "Pick a date"}
                        <CalendarIcon className="ml-auto h-4 w-4 opacity-50" />
                      </Button>
                    </PopoverTrigger>
                    <PopoverContent className="w-auto p-0">
                      <Calendar mode="single" selected={date} onSelect={setDate} initialFocus />
                    </PopoverContent>
                  </Popover>
                </div>

                {type === 'Buy' && (
                  <div className="space-y-2">
                    <Label>Funding Source <span className="text-red-500">*</span></Label>
                    <Select value={fundingSource} onValueChange={(v: 'cash' | 'external') => setFundingSource(v)} disabled={disableCriticalFields}>
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="cash">Cash Balance</SelectItem>
                        <SelectItem value="external">External (e.g., contribution)</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                )}

                {['Buy', 'Sell'].includes(type) && (
                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <Label>Quantity <span className="text-red-500">*</span></Label>
                      <Input
                        type="number"
                        step="any"
                        value={quantity}
                        onChange={(e) => setQuantity(e.target.value)}
                        disabled={disableCriticalFields}
                      />
                    </div>
                    <div className="space-y-2">
                      <Label>Price per Unit <span className="text-red-500">*</span></Label>
                      <Input
                        type="number"
                        step="any"
                        value={price}
                        onChange={(e) => setPrice(e.target.value)}
                        disabled={disableCriticalFields}
                      />
                    </div>
                  </div>
                )}

                {['Dividend', 'Interest', 'Deposit', 'Withdrawal'].includes(type) && (
                  <div className="space-y-2">
                    <Label>Amount <span className="text-red-500">*</span></Label>
                    <Input
                      type="number"
                      step="any"
                      value={dividendAmount}
                      onChange={(e) => setDividendAmount(e.target.value)}
                    />
                  </div>
                )}

                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label>Fees (optional)</Label>
                    <Input
                      type="number"
                      step="any"
                      value={fees}
                      onChange={(e) => setFees(e.target.value)}
                      disabled={disableCriticalFields}
                    />
                  </div>
                </div>

                <div className="space-y-2">
                  <Label>Notes (optional)</Label>
                  <Textarea
                    value={notes}
                    onChange={(e) => setNotes(e.target.value)}
                    rows={3}
                  />
                </div>

                <div className="flex justify-end gap-4">
                  <Button type="button" variant="secondary" onClick={() => { setOpen(false); resetForm(); }}>
                    Cancel
                  </Button>
                  <Button type="submit">
                    {editingTx ? 'Save Changes' : 'Add'} Transaction
                  </Button>
                </div>
              </form>
            </DialogContent>
          </Dialog>
        </div>
      </div>

      {displayTransactions.length > 0 ? (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="cursor-pointer" onClick={() => toggleSort('date')}>
                Date <ArrowUpDown className="inline h-4 w-4" />
              </TableHead>
              <TableHead className="cursor-pointer" onClick={() => toggleSort('account_name')}>
                Account <ArrowUpDown className="inline h-4 w-4" />
              </TableHead>
              <TableHead className="cursor-pointer" onClick={() => toggleSort('asset_ticker')}>
                Asset <ArrowUpDown className="inline h-4 w-4" />
              </TableHead>
              <TableHead className="cursor-pointer" onClick={() => toggleSort('type')}>
                Type <ArrowUpDown className="inline h-4 w-4" />
              </TableHead>
              <TableHead>Funding Source</TableHead>
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
                Realized G/L <ArrowUpDown className="inline h-4 w-4" />
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
                <TableCell>{tx.funding_source || '-'}</TableCell>
                <TableCell className="text-right">
                  {tx.quantity != null ? Number(tx.quantity).toFixed(8) : '-'}
                </TableCell>
                <TableCell className="text-right">
                  {tx.price_per_unit != null ? `${formatUSD(tx.price_per_unit)}` : '-'}
                </TableCell>
                <TableCell className="text-right">
                  {tx.amount != null ? `${formatUSD(tx.amount)}` : '-'}
                </TableCell>
                <TableCell className="text-right">
                  {tx.fees != null ? `${formatUSD(tx.fees)}` : '-'}
                </TableCell>
                <TableCell className={cn(
                  "text-right font-medium",
                  tx.realized_gain != null && tx.realized_gain > 0 ? 'text-green-600' :
                  tx.realized_gain != null && tx.realized_gain < 0 ? 'text-red-600' : ''
                )}>
                  {tx.realized_gain != null ? `${formatUSD(tx.realized_gain)}` : '-'}
                </TableCell>
                <TableCell className="max-w-xs truncate">{tx.notes || '-'}</TableCell>
                <TableCell className="flex gap-2">
                  <Button variant="ghost" size="sm" onClick={() => openEdit(tx)}>
                    <Edit2 className="h-4 w-4" />
                  </Button>
                  <Button variant="ghost" size="sm" onClick={() => setDeletingTx(tx)}>
                    <Trash2 className="h-4 w-4 text-red-600" />
                  </Button>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      ) : (
        <p className="text-muted-foreground">No transactions yet. Add one to get started!</p>
      )}

      <AlertDialog open={!!deletingTx} onOpenChange={(o) => !o && setDeletingTx(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this {deletingTx?.type} transaction?</AlertDialogTitle>
            <AlertDialogDescription>
              {deletingTx?.type === 'Buy' && (
                <>The matching tax lot will be <strong>automatically removed only if no shares have been sold from it</strong>. If any shares were sold, please review/clean up manually on the Tax Lots page.</>
              )}
              {deletingTx?.type === 'Sell' && (
                <>Sold shares will <strong>not</strong> be automatically restored. After deletion, manually increase remaining_quantity on the oldest tax lots (FIFO order) on the Tax Lots page.</>
              )}
              {['Dividend', 'Interest', 'Deposit', 'Withdrawal'].includes(deletingTx?.type || '') && <>This has no lot impact.</>}
              <br /><br />
              This action cannot be undone.
            </AlertDialogDescription>
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