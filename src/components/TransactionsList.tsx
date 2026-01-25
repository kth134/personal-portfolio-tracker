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
import { CalendarIcon, Check, ChevronsUpDown, Edit2, Trash2, ArrowUpDown, Filter } from 'lucide-react'
import { cn } from '@/lib/utils'
import { format, parseISO } from 'date-fns'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog'
import { Checkbox } from '@/components/ui/checkbox'
import { formatUSD } from '@/lib/formatters'
import Papa from 'papaparse'
import { serverCreateBuyWithLot, serverProcessSellFifo, serverBulkImportTransactions } from '@/app/actions/transactionactions'

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
  asset_id: string | null
  account: { name: string; type?: string } | null
  asset: { ticker: string; name?: string } | null
  funding_source?: 'cash' | 'external' | null
}

type ValidatedRow = {
  date: string
  account_id: string
  asset_id: string | null
  type: 'Buy' | 'Sell' | 'Dividend' | 'Deposit' | 'Withdrawal' | 'Interest'
  quantity?: number
  price_per_unit?: number
  amount?: number
  fees?: number
  notes?: string
  funding_source: 'cash' | 'external'
}

type TransactionsListProps = {
  initialTransactions: Transaction[]
  total: number
  currentPage: number
  pageSize: number
}

export default function TransactionsList({ initialTransactions, total, currentPage: currentPageProp, pageSize }: TransactionsListProps) {
  const router = useRouter()
  const [transactions, setTransactions] = useState(initialTransactions)
  const [displayTransactions, setDisplayTransactions] = useState(initialTransactions)
  const [currentPage, setCurrentPage] = useState(currentPageProp)
  const [open, setOpen] = useState(false)
  const [editingTx, setEditingTx] = useState<Transaction | null>(null)
  const [deletingTx, setDeletingTx] = useState<Transaction | null>(null)
  const [isImporting, setIsImporting] = useState(false)
  const [importStatus, setImportStatus] = useState<{
    total: number
    current: number
    successes: number
    failures: number
    errors: string[]
  } | null>(null)

  // Search & sort
  const [search, setSearch] = useState('')
  const [sortKey, setSortKey] = useState<keyof Transaction | 'account_name' | 'asset_ticker'>('date')
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc')

  // Filters
  const [filterType, setFilterType] = useState('')
  const [filterAccount, setFilterAccount] = useState('')
  const [filterAsset, setFilterAsset] = useState('')
  const [filterFundingSource, setFilterFundingSource] = useState('')
  const [filterDateFrom, setFilterDateFrom] = useState('')
  const [filterDateTo, setFilterDateTo] = useState('')
  const [filterAmountMin, setFilterAmountMin] = useState('')
  const [filterAmountMax, setFilterAmountMax] = useState('')
  const [filterNotes, setFilterNotes] = useState('')

  // Mass actions
  const [selectedTransactions, setSelectedTransactions] = useState<string[]>([])
  const [selectAll, setSelectAll] = useState(false)
  const [bulkEditOpen, setBulkEditOpen] = useState(false)
  const [bulkForm, setBulkForm] = useState({
    notes: ''
  })

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

  // Help modal state
  const [showImportHelp, setShowImportHelp] = useState(false)
  const [dontShowAgain, setDontShowAgain] = useState(false)
  const [helpOpen, setHelpOpen] = useState(false)
  const [showFilters, setShowFilters] = useState(false)

  const isBuyOrSellEdit = !!editingTx && (editingTx.type === 'Buy' || editingTx.type === 'Sell')
  const disableSelects = !!editingTx
  const disableCriticalFields = isBuyOrSellEdit

  // Load help-seen flag
  useEffect(() => {
    const seen = localStorage.getItem('csv-import-help-seen')
    setShowImportHelp(!seen)
  }, [])

  // Update transactions when initialTransactions changes
  useEffect(() => {
    setTransactions(initialTransactions)
  }, [initialTransactions])

  // Update currentPage when prop changes
  useEffect(() => {
    setCurrentPage(currentPageProp)
  }, [currentPageProp])

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
      setQuantity('')
      setPrice('')
      setDividendAmount('')
    }
    if (type !== 'Buy') setFundingSource('cash')
  }, [type])

  // Search + sort + filter effect
  useEffect(() => {
    let list = [...transactions]
    if (search) {
      const low = search.toLowerCase()
      list = list.filter(tx =>
        tx.asset?.ticker?.toLowerCase().includes(low) ||
        tx.asset?.name?.toLowerCase().includes(low) ||
        tx.account?.name.toLowerCase().includes(low) ||
        tx.notes?.toLowerCase().includes(low) ||
        tx.type.toLowerCase().includes(low)
      )
    }
    // Apply filters
    if (filterType) {
      list = list.filter(tx => tx.type === filterType)
    }
    if (filterAccount) {
      list = list.filter(tx => tx.account?.name?.toLowerCase().includes(filterAccount.toLowerCase()))
    }
    if (filterAsset) {
      list = list.filter(tx => tx.asset?.ticker?.toLowerCase().includes(filterAsset.toLowerCase()) || tx.asset?.name?.toLowerCase().includes(filterAsset.toLowerCase()))
    }
    if (filterFundingSource) {
      list = list.filter(tx => tx.funding_source === filterFundingSource)
    }
    if (filterDateFrom) {
      list = list.filter(tx => tx.date >= filterDateFrom)
    }
    if (filterDateTo) {
      list = list.filter(tx => tx.date <= filterDateTo)
    }
    if (filterAmountMin) {
      const min = Number(filterAmountMin)
      list = list.filter(tx => tx.amount && tx.amount >= min)
    }
    if (filterAmountMax) {
      const max = Number(filterAmountMax)
      list = list.filter(tx => tx.amount && tx.amount <= max)
    }
    if (filterNotes) {
      list = list.filter(tx => tx.notes?.toLowerCase().includes(filterNotes.toLowerCase()))
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
  }, [transactions, search, sortKey, sortDir, filterType, filterAccount, filterAsset, filterFundingSource, filterDateFrom, filterDateTo, filterAmountMin, filterAmountMax, filterNotes])

  // Update select all state
  useEffect(() => {
    const paginatedTransactions = displayTransactions.slice((currentPage - 1) * pageSize, currentPage * pageSize)
    const allSelected = paginatedTransactions.length > 0 && selectedTransactions.length === paginatedTransactions.length && selectedTransactions.every(id => paginatedTransactions.some(tx => tx.id === id))
    setSelectAll(allSelected)
  }, [selectedTransactions, displayTransactions, currentPage, pageSize])

  const totalPages = Math.ceil(displayTransactions.length / pageSize)

  // Adjust currentPage if out of bounds
  useEffect(() => {
    if (currentPage > totalPages && totalPages > 0) {
      setCurrentPage(totalPages)
      router.push(`?page=${totalPages}`)
    }
  }, [displayTransactions, pageSize, currentPage, totalPages, router])

  const toggleSort = (key: typeof sortKey) => {
    if (sortKey === key) {
      setSortDir(sortDir === 'asc' ? 'desc' : 'asc')
    } else {
      setSortKey(key)
      setSortDir('desc')
    }
  }

  const handleSelectTransaction = (id: string, checked: boolean) => {
    if (checked) {
      setSelectedTransactions(prev => [...prev, id])
    } else {
      setSelectedTransactions(prev => prev.filter(txId => txId !== id))
    }
  }

  const handleSelectAll = (checked: boolean) => {
    const paginatedTransactions = displayTransactions.slice((currentPage - 1) * pageSize, currentPage * pageSize)
    if (checked) {
      setSelectedTransactions(paginatedTransactions.map(tx => tx.id))
    } else {
      setSelectedTransactions([])
    }
    setSelectAll(checked)
  }

  const handleBulkDelete = async () => {
    if (selectedTransactions.length === 0) return
    if (!confirm(`Delete ${selectedTransactions.length} transactions? This cannot be undone.`)) return

    const supabase = createClient()
    try {
      await supabase.from('transactions').delete().in('id', selectedTransactions)
      setTransactions(transactions.filter(t => !selectedTransactions.includes(t.id)))
      setSelectedTransactions([])
      setSelectAll(false)
      router.refresh()
    } catch (err: any) {
      alert('Bulk delete failed: ' + err.message)
    }
  }

  const handleBulkEdit = () => {
    if (selectedTransactions.length === 0) return
    setBulkEditOpen(true)
  }

  const handleBulkEditSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (selectedTransactions.length === 0) return

    const supabase = createClient()
    const updateData: any = {}
    if (bulkForm.notes) updateData.notes = bulkForm.notes

    if (Object.keys(updateData).length === 0) {
      alert('Please enter notes to update')
      return
    }

    try {
      await supabase.from('transactions').update(updateData).in('id', selectedTransactions)
      // Update local state
      setTransactions(transactions.map(tx => 
        selectedTransactions.includes(tx.id) ? { ...tx, ...updateData } : tx
      ))
      setBulkEditOpen(false)
      setBulkForm({ notes: '' })
      setSelectedTransactions([])
      setSelectAll(false)
    } catch (err: any) {
      alert('Bulk edit failed: ' + err.message)
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
    setQuantity(tx.quantity?.toString() || '')
    setPrice(tx.price_per_unit?.toString() || '')
    setDividendAmount(tx.amount?.toString() || '')
    setFees(tx.fees?.toString() || '')
    setNotes(tx.notes || '')
    setFundingSource(tx.funding_source || 'cash')
    setOpen(true)
  }

  const handleDownloadTemplate = () => {
    const accountList = accounts.length > 0
      ? accounts.map(acc => `# - ${acc.name} (${acc.type || 'N/A'})`).join('\n')
      : '# - (No accounts yet—add some in the app first)'
    const assetList = assets.length > 0
      ? assets.map(ast => `# - ${ast.ticker}${ast.name ? ` - ${ast.name}` : ''}`).join('\n')
      : '# - (No assets yet—add some in the app first)'

    const templateContent = `
# Transaction Import CSV Template
# IMPORTANT TIPS:
# - Date: Required, format YYYY-MM-DD (e.g., 2024-01-17)
# - Account: Required, exact account name (case-insensitive). Must match one of your existing accounts.
# - Asset: Required for Buy/Sell/Dividend (ticker, case-insensitive); leave blank for Deposit/Withdrawal/Interest.
# - Type: Required—one of: Buy, Sell, Dividend, Deposit, Withdrawal, Interest (case-insensitive).
# - Quantity: For Buy/Sell—positive number (e.g., 4.38604). App auto-cleans formats like $1,234.56 or (1234.56).
# - PricePerUnit: For Buy/Sell—positive number (e.g., 37.25). App auto-cleans $ and ,.
# - Amount: For Dividend/Interest/Deposit/Withdrawal—positive number; auto-negated for Withdrawal/Buy if provided as negative.
#   For Buy/Sell, optional—if omitted, calculated from Quantity * PricePerUnit +/- Fees.
# - Fees: Optional—number, defaults to 0. App auto-cleans formats.
# - Notes: Optional—string for details.
# - FundingSource: For Buy only—'cash' or 'external' (defaults to 'cash'). 'external' auto-creates a Deposit.
# Best Practices:
# - Sort rows oldest to newest (FIFO accuracy for sells).
# - Empty/comment lines (#) skipped. Headers case-insensitive, spaces ok (e.g., "Price Per Unit").
# - Numbers: App auto-strips $ and ,—e.g., "$1,234.56" → 1234.56. Negatives ok for Amount (e.g., -$100 for Buy).
# - Test small batches first. If errors, check console or validation messages.
# - Duplicate columns (e.g., two 'Amount')? App uses the last one—avoid if possible.
# Available Accounts:
${accountList}
# Available Assets:
${assetList}
Date,Account,Asset,Type,Quantity,PricePerUnit,Amount,Fees,Notes,FundingSource
2024-01-17,KH Traditional IRA,FBTC,Buy,4.38604,37.25,,0,Initial buy,external
2025-01-02,AH Roth IRA,FBTC,Sell,31.437,88.47,,0,Partial sell,
2025-03-01,KH Traditional IRA,,Dividend,,,50.00,0,Quarterly dividend,
2025-04-01,KH Traditional IRA,,Deposit,,,1000.00,0,Monthly contribution,
`.trim();

    const blob = new Blob([templateContent], { type: 'text/csv;charset=utf-8;' })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = 'transaction-import-template.csv'
    document.body.appendChild(link)
    link.click()
    document.body.removeChild(link)
    URL.revokeObjectURL(url)
  }

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
    let amt = 0
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
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) throw new Error('Not authenticated')

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
        user_id: user.id,
      }

      let updatedTx: Transaction

      if (editingTx) {
        // Edit: only simple fields (no lot changes)
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
        // New transaction: insert first
        const { data: newTx, error: txErr } = await supabase
          .from('transactions')
          .insert(txData)
          .select(`
            *,
            account:accounts (name, type),
            asset:assets (ticker, name)
          `)
          .single()
        if (txErr) throw txErr
        updatedTx = newTx!

        // Then handle tax-sensitive logic on server
        if (type === 'Buy' && qty && prc && selectedAsset) {
          const { data: { user } } = await supabase.auth.getUser()
          if (!user) throw new Error('Not authenticated')
          await serverCreateBuyWithLot(
            {
              account_id: selectedAccount.id,
              asset_id: selectedAsset.id,
              date: txData.date,
              quantity: qty,
              price_per_unit: prc,
              amount: amt,
              fees: fs,
              notes: notes || null,
              funding_source: fundingSource,
            },
            user.id
          )
        } else if (type === 'Sell' && qty && prc && selectedAsset) {
          const { data: { user } } = await supabase.auth.getUser()
          if (!user) throw new Error('Not authenticated')
          await serverProcessSellFifo(
            {
              account_id: selectedAccount.id,
              asset_id: selectedAsset.id,
              date: txData.date,
              quantity: qty,
              price_per_unit: prc,
              fees: fs,
              notes: notes || null,
              transaction_id: updatedTx.id,
            },
            user.id
          )
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

  const handleCsvImport = (e: React.ChangeEvent<HTMLInputElement>) => {
  const file = e.target.files?.[0]
  if (!file) return

  setIsImporting(true)
  setImportStatus({ total: 0, current: 0, successes: 0, failures: 0, errors: [] })

  const reader = new FileReader()
  reader.onload = async (event) => {
    const text = event.target?.result as string
    if (!text) {
      alert('Empty file')
      setIsImporting(false)
      return
    }

    const lines = text
      .split(/\r?\n/)
      .filter(line => {
        const trimmed = line.trim()
        return trimmed !== '' && !trimmed.startsWith('#')
      })
    const cleanedCsv = lines.join('\n')

    Papa.parse(cleanedCsv, {
      header: true,
      skipEmptyLines: 'greedy',
      transformHeader: (h) => h.trim().toLowerCase().replace(/\s+/g, ''),
      complete: async (results) => {
        const { data: rows, errors: parseErrors } = results
        if (parseErrors.length > 0) {
          alert(`CSV parsing issues:\n${parseErrors.map(e => e.message).join('\n')}`)
          setIsImporting(false)
          return
        }

        const total = rows.length
        if (total === 0) {
          alert('No data rows found')
          setIsImporting(false)
          return
        }

        setImportStatus({ total, current: 0, successes: 0, failures: 0, errors: [] })

        // Client-side validation + collection
        const validatedRows: ValidatedRow[] = []
        const validationErrors: string[] = []
        const cleanNumber = (val: string | undefined, preserveSign = false): number | undefined => {
          if (!val) return undefined;
          const cleaned = val.replace(/[$,]/g, '').trim();
          const num = Number(cleaned);
          if (isNaN(num)) return undefined;
          return preserveSign ? num : Math.abs(num);
        };
        for (const [index, rawRow] of (rows as any[]).entries()) {
          try {
            const row = Object.fromEntries(
            Object.entries(rawRow).map(([k, v]) => [k.toLowerCase(), v?.toString().trim()])
);
            const quantity = cleanNumber(row.quantity);
            const price_per_unit = cleanNumber(row.priceperunit);
            const amount = cleanNumber(row.amount, true);     // preserve sign
            const fees = cleanNumber(row.fees, true) ?? 0;  // preserve sign, fallback 0
            const dateStr = row.date || ''
            const accountName = row.account || ''
            const assetTicker = row.asset || row.ticker || ''
            const typeRaw = row.type || ''

            if (!dateStr || !accountName || !typeRaw) {
              throw new Error('Missing required: date, account, type')
            }

            const txType = typeRaw.charAt(0).toUpperCase() + typeRaw.slice(1).toLowerCase() as Transaction['type']
            if (!['Buy','Sell','Dividend','Deposit','Withdrawal','Interest'].includes(txType)) {
              throw new Error(`Invalid type: ${typeRaw}`)
            }

            const account = accounts.find(a => a.name.toLowerCase() === accountName.toLowerCase())
            if (!account) throw new Error(`Account not found: "${accountName}"`)

            let assetId: string | null = null
            if (['Buy','Sell','Dividend'].includes(txType)) {
              if (!assetTicker) throw new Error('Asset required for Buy/Sell/Dividend')
              const asset = assets.find(a => a.ticker.toLowerCase() === assetTicker.toLowerCase())
              if (!asset) throw new Error(`Asset not found: "${assetTicker}"`)
              assetId = asset.id
            }

            const parsedDate = parseISO(dateStr)
            if (isNaN(parsedDate.getTime())) throw new Error('Invalid date (use YYYY-MM-DD)')

          validatedRows.push({
            date: format(parsedDate, 'yyyy-MM-dd'),
            account_id: account.id,
            asset_id: assetId,
            type: txType,
            quantity, // cleaned
            price_per_unit, // cleaned
            amount, // cleaned
            fees, // cleaned
            notes: row.notes || undefined,
            funding_source: row.fundingsource === 'external' ? 'external' : 'cash',
          });
          } catch (err: any) {
            validationErrors.push(`Row ${index + 2}: ${err.message}`)
          }
        }

        if (validationErrors.length > 0) {
          alert(`Validation failed:\n${validationErrors.slice(0, 20).join('\n')}${validationErrors.length > 20 ? `\n...and ${validationErrors.length - 20} more` : ''}`)
          setIsImporting(false)
          return
        }

        // All valid → bulk import on server
        try {
          const supabase = createClient()
          const { data: { user } } = await supabase.auth.getUser()
          if (!user) throw new Error('Not authenticated')

          alert('All rows validated! Starting server-side import (this may take 30-60 seconds for large files)...')

          const result = await serverBulkImportTransactions(validatedRows, user.id)

          router.refresh()
          alert(`Success! Imported ${result.imported} transactions with tax lots processed.`)
        } catch (err: any) {
          alert(`Server import failed:\n${err.message}`)
        } finally {
          setIsImporting(false)
          setImportStatus(null)
        }
      },
      error: (err: any) => {
        alert('CSV parse failed: ' + err.message)
        setIsImporting(false)
      },
    })
  }
  reader.readAsText(file)
  e.target.value = ''
}

  const handleDelete = async () => {
    if (!deletingTx) return
    const supabase = createClient()
    try {
      if (deletingTx.type === 'Buy') {
        alert('Buy deleted. Tax lot cleanup is not automatic if shares were partially sold. Review Tax Lots page manually if needed.')
      } else if (deletingTx.type === 'Sell') {
        alert('Sell deleted. Sold shares are not automatically restored. Manually adjust remaining_quantity on oldest tax lots if needed.')
      }

      await supabase.from('transactions').delete().eq('id', deletingTx.id)
      setTransactions(transactions.filter(t => t.id !== deletingTx.id))
      router.refresh()
      setDeletingTx(null)
    } catch (err: any) {
      console.error(err)
      alert('Delete failed: ' + err.message)
    }
  }

  const handleImportClick = () => {
    if (showImportHelp) {
      setHelpOpen(true)
    } else {
      document.getElementById('csv-import-input')?.click()
    }
  }

  const handleHelpClose = () => {
    if (dontShowAgain) {
      localStorage.setItem('csv-import-help-seen', 'true')
      setShowImportHelp(false)
    }
    setHelpOpen(false)
    document.getElementById('csv-import-input')?.click()
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

          <Button variant="outline" onClick={() => setShowFilters(!showFilters)}>
            <Filter className="h-4 w-4 mr-2" />
            Filters
          </Button>

          {selectedTransactions.length > 0 && (
            <div className="flex gap-2 items-center">
              <span className="text-sm text-muted-foreground">
                {selectedTransactions.length} selected
              </span>
              <Button variant="outline" size="sm" onClick={handleBulkEdit}>
                Edit Selected
              </Button>
              <Button variant="destructive" size="sm" onClick={handleBulkDelete}>
                Delete Selected
              </Button>
            </div>
          )}

          <Button
            variant="outline"
            onClick={handleImportClick}
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
            Download CSV Template
          </Button>

      {showFilters && (
        <div className="mb-4 p-4 border rounded-lg bg-muted/20">
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
            <div>
              <Label>Type</Label>
              <Select value={filterType} onValueChange={setFilterType}>
                <SelectTrigger>
                  <SelectValue placeholder="All types" />
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
            <div>
              <Label>Account</Label>
              <Input
                placeholder="Filter by account"
                value={filterAccount}
                onChange={(e) => setFilterAccount(e.target.value)}
              />
            </div>
            <div>
              <Label>Asset</Label>
              <Input
                placeholder="Filter by asset"
                value={filterAsset}
                onChange={(e) => setFilterAsset(e.target.value)}
              />
            </div>
            <div>
              <Label>Funding Source</Label>
              <Select value={filterFundingSource} onValueChange={setFilterFundingSource}>
                <SelectTrigger>
                  <SelectValue placeholder="All" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="cash">Cash</SelectItem>
                  <SelectItem value="external">External</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Date From</Label>
              <Input
                type="date"
                value={filterDateFrom}
                onChange={(e) => setFilterDateFrom(e.target.value)}
              />
            </div>
            <div>
              <Label>Date To</Label>
              <Input
                type="date"
                value={filterDateTo}
                onChange={(e) => setFilterDateTo(e.target.value)}
              />
            </div>
            <div>
              <Label>Amount Min</Label>
              <Input
                type="number"
                value={filterAmountMin}
                onChange={(e) => setFilterAmountMin(e.target.value)}
              />
            </div>
            <div>
              <Label>Amount Max</Label>
              <Input
                type="number"
                value={filterAmountMax}
                onChange={(e) => setFilterAmountMax(e.target.value)}
              />
            </div>
            <div className="md:col-span-2 lg:col-span-4">
              <Label>Notes</Label>
              <Input
                placeholder="Filter by notes"
                value={filterNotes}
                onChange={(e) => setFilterNotes(e.target.value)}
              />
            </div>
          </div>
          <div className="mt-4 flex gap-2">
            <Button variant="outline" onClick={() => {
              setFilterType('')
              setFilterAccount('')
              setFilterAsset('')
              setFilterFundingSource('')
              setFilterDateFrom('')
              setFilterDateTo('')
              setFilterAmountMin('')
              setFilterAmountMax('')
              setFilterNotes('')
            }}>
              Clear Filters
            </Button>
          </div>
        </div>
      )}

            {isImporting && (
              <div className="mt-4 p-4 bg-muted rounded-lg text-center">
                <p className="text-sm font-medium">Processing import on server...</p>
                <p className="text-xs text-muted-foreground mt-2">
                  This can take 30–90 seconds for large files. Do not refresh or close the tab.
                </p>
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
                    <Select value={fundingSource} onValueChange={(v: 'cash' | 'external') => setFundingSource(v)}>
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
            {displayTransactions.slice((currentPage - 1) * pageSize, currentPage * pageSize).map((tx) => (
              <TableRow key={tx.id}>
                <TableCell>
                  <Checkbox
                    checked={selectedTransactions.includes(tx.id)}
                    onCheckedChange={(checked) => handleSelectTransaction(tx.id, checked as boolean)}
                  />
                </TableCell>
                <TableCell>{tx.date}</TableCell>
                <TableCell>{tx.account?.name || '-'}</TableCell>
                <TableCell className="w-16 break-words">
                  {tx.asset?.ticker || '-'}
                </TableCell>
                <TableCell>{tx.type}</TableCell>
                <TableCell>{tx.funding_source || '-'}</TableCell>
                <TableCell className="text-right">
                  {tx.quantity != null ? Number(tx.quantity).toFixed(8) : '-'}
                </TableCell>
                <TableCell className="text-right">
                  {tx.price_per_unit != null ? formatUSD(tx.price_per_unit) : '-'}
                </TableCell>
                <TableCell className="text-right">
                  {tx.amount != null ? formatUSD(tx.amount) : '-'}
                </TableCell>
                <TableCell className="text-right">
                  {tx.fees != null ? formatUSD(tx.fees) : '-'}
                </TableCell>
                <TableCell className={cn(
                  "text-right font-medium",
                  tx.realized_gain != null && tx.realized_gain > 0 ? 'text-green-600' :
                  tx.realized_gain != null && tx.realized_gain < 0 ? 'text-red-600' : ''
                )}>
                  {tx.realized_gain != null ? formatUSD(tx.realized_gain) : '-'}
                </TableCell>
                <TableCell className="break-words">{tx.notes || '-'}</TableCell>
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
        </div>
      ) : (
        <p className="text-muted-foreground">No transactions yet. Add one to get started!</p>
      )}

      <PaginationControls
        currentPage={currentPage}
        totalPages={totalPages}
        onPageChange={(page) => {
          setCurrentPage(page)
          router.push(`?page=${page}`)
        }}
      />

      <AlertDialog open={!!deletingTx} onOpenChange={(o) => !o && setDeletingTx(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this {deletingTx?.type} transaction?</AlertDialogTitle>
            <AlertDialogDescription>
              {deletingTx?.type === 'Buy' && (
                <>The matching tax lot will only be removed automatically if no shares have been sold from it. Otherwise, clean up manually on the Tax Lots page.</>
              )}
              {deletingTx?.type === 'Sell' && (
                <>Sold shares will not be automatically restored. Manually adjust remaining_quantity on oldest lots (FIFO order) if needed.</>
              )}
              {['Dividend', 'Interest', 'Deposit', 'Withdrawal'].includes(deletingTx?.type || '') && <>This has no tax-lot impact.</>}
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

      <Dialog open={helpOpen} onOpenChange={setHelpOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>CSV Import Instructions</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <p>Follow these steps for a smooth import:</p>
            <ul className="list-disc pl-5 space-y-2 text-sm">
              <li>Download the template—it lists your current accounts/assets and detailed tips.</li>
              <li>Sort rows oldest → newest for accurate FIFO handling on sells.</li>
              <li>Match account names and asset tickers exactly (case-insensitive).</li>
              <li>Required: Date (YYYY-MM-DD), Account, Type.</li>
              <li>For Buy/Sell/Dividend: include Asset ticker.</li>
              <li>Numbers can include $ and ,—the app auto-cleans them (e.g., "$1,234.56" → 1234.56).</li>
              <li>Negatives ok for Amount (e.g., -$100 for buys)—app handles.</li>
              <li>Avoid duplicate columns (e.g., two 'Amount')—app uses last one.</li>
              <li>Test with a few rows first. If errors, check for missing fields or invalid dates.</li>
            </ul>
            <div className="flex items-center space-x-2">
              <Checkbox id="dont-show" checked={dontShowAgain} onCheckedChange={(c) => setDontShowAgain(!!c)} />
              <label htmlFor="dont-show" className="text-sm text-muted-foreground">Don't show again</label>
            </div>
          </div>
          <div className="flex justify-end mt-4">
            <Button onClick={handleHelpClose}>Got it, proceed</Button>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={bulkEditOpen} onOpenChange={setBulkEditOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Bulk Edit {selectedTransactions.length} Transactions</DialogTitle>
          </DialogHeader>
          <form onSubmit={handleBulkEditSubmit} className="space-y-4">
            <div>
              <Label>Notes (leave empty to keep current)</Label>
              <Textarea 
                value={bulkForm.notes} 
                onChange={e => setBulkForm({...bulkForm, notes: e.target.value})} 
                placeholder="Update notes for all selected transactions"
                rows={3}
              />
            </div>
            <div className="flex gap-2">
              <Button type="submit">Update Selected</Button>
              <Button type="button" variant="outline" onClick={() => setBulkEditOpen(false)}>Cancel</Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>
    </main>
  )
}

function PaginationControls({ currentPage, totalPages, onPageChange }: { currentPage: number, totalPages: number, onPageChange: (page: number) => void }) {
  return (
    <div className="flex items-center justify-center gap-2 mt-4">
      <Button
        variant="outline"
        onClick={() => onPageChange(1)}
        disabled={currentPage === 1}
      >
        First
      </Button>
      <Button
        variant="outline"
        onClick={() => onPageChange(currentPage - 1)}
        disabled={currentPage <= 1}
      >
        Previous
      </Button>
      <Select value={currentPage.toString()} onValueChange={(v) => onPageChange(parseInt(v))}>
        <SelectTrigger className="w-20">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {Array.from({ length: totalPages }, (_, i) => i + 1).map(page => (
            <SelectItem key={page} value={page.toString()}>{page}</SelectItem>
          ))}
        </SelectContent>
      </Select>
      <span>of {totalPages}</span>
      <Button
        variant="outline"
        onClick={() => onPageChange(currentPage + 1)}
        disabled={currentPage >= totalPages}
      >
        Next
      </Button>
      <Button
        variant="outline"
        onClick={() => onPageChange(totalPages)}
        disabled={currentPage === totalPages}
      >
        Last
      </Button>
    </div>
  )
}