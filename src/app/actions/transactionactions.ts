// src/app/actions/transactionactions.ts
'use server'

import { createClient } from '@/lib/supabase/server'

type BuyInput = {
  account_id: string
  asset_id: string
  date: string
  quantity: number
  price_per_unit: number
  amount: number          // negative for buy
  fees?: number | null
  notes?: string | null
  funding_source?: 'cash' | 'external'
}

type SellInput = {
  account_id: string
  asset_id: string
  date: string
  quantity: number
  price_per_unit: number
  fees?: number | null
  notes?: string | null
  transaction_id: string   // the sell tx we just inserted
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
  funding_source?: 'cash' | 'external'
}

export async function serverCreateBuyWithLot(input: BuyInput, userId: string) {
  const supabase = await createClient()

  // Verify user owns the account
  const { data: acc, error: accErr } = await supabase
    .from('accounts')
    .select('user_id')
    .eq('id', input.account_id)
    .single()

  if (accErr || acc?.user_id !== userId) {
    throw new Error('Unauthorized: account access denied')
  }

  // Auto-deposit if external
  if (input.funding_source === 'external') {
    const depositAmt = Math.abs(input.amount)
    const { error: depErr } = await supabase
      .from('transactions')
      .insert({
        account_id: input.account_id,
        asset_id: null,
        date: input.date,
        type: 'Deposit',
        amount: depositAmt,
        notes: `Auto-deposit for external buy`,
        user_id: userId,
      })

    if (depErr) throw depErr
  }

  // Create tax lot
  // `input.amount` from the transaction already includes fees (UI and bulk import store net amount),
  // so compute basis using the absolute transaction amount only (consistent with bulk import logic).
  const basis_per_unit = Math.abs(input.amount) / input.quantity

  const { error: lotErr } = await supabase.from('tax_lots').insert({
    account_id: input.account_id,
    asset_id: input.asset_id,
    purchase_date: input.date,
    quantity: input.quantity,
    cost_basis_per_unit: basis_per_unit,
    remaining_quantity: input.quantity,
    user_id: userId,
  })

  if (lotErr) throw lotErr

  return { success: true }
}

export async function serverProcessSellFifo(input: SellInput, userId: string) {
  const supabase = await createClient()

  // Verify ownership of account
  const { data: acc, error: accErr } = await supabase
    .from('accounts')
    .select('user_id')
    .eq('id', input.account_id)
    .single()

  if (accErr || acc?.user_id !== userId) {
    throw new Error('Unauthorized: account access denied')
  }

  // Fetch open lots (FIFO order)
  const { data: lots, error: lotsErr } = await supabase
    .from('tax_lots')
    .select('*')
    .eq('account_id', input.account_id)
    .eq('asset_id', input.asset_id)
    .gt('remaining_quantity', 0)
    .order('purchase_date', { ascending: true })

  if (lotsErr) throw lotsErr
  if (!lots?.length) throw new Error('No open tax lots for this sell')

  let remainingToSell = input.quantity
  let basisSold = 0

  for (const lot of lots) {
    if (remainingToSell <= 0) break
    const deplete = Math.min(remainingToSell, lot.remaining_quantity)
    basisSold += deplete * lot.cost_basis_per_unit
    remainingToSell -= deplete

    if (lot.remaining_quantity - deplete > 0) {
      const { error: upErr } = await supabase
        .from('tax_lots')
        .update({ remaining_quantity: lot.remaining_quantity - deplete })
        .eq('id', lot.id)
      if (upErr) throw upErr
    } else {
      const { error: upErr } = await supabase
        .from('tax_lots')
        .update({ remaining_quantity: 0 })
        .eq('id', lot.id)
      if (upErr) throw upErr
    }
  }

  if (remainingToSell > 0) throw new Error('Insufficient shares in tax lots')

  // Calculate realized gain
  const proceeds = input.quantity * input.price_per_unit - (input.fees || 0)
  const realized_gain = proceeds - basisSold

  // Update the sell transaction
  const { error: txErr } = await supabase
    .from('transactions')
    .update({ realized_gain })
    .eq('id', input.transaction_id)

  if (txErr) throw txErr

  return { success: true, realized_gain }
}

export async function serverBulkImportTransactions(rows: ValidatedRow[], userId: string) {
  const supabase = await createClient()

  // Enforce chronological order for FIFO accuracy
  rows.sort((a, b) => a.date.localeCompare(b.date))

  const errors: string[] = []
  let successCount = 0

  for (const [index, row] of rows.entries()) {
    try {
      // Verify account ownership (every row)
      const { data: acc, error: accErr } = await supabase
        .from('accounts')
        .select('user_id')
        .eq('id', row.account_id)
        .single()
      if (accErr || acc?.user_id !== userId) {
        throw new Error(`Unauthorized access to account`)
      }

      let amt = row.amount ?? 0
      const fs = row.fees ?? 0
      if (row.type === 'Withdrawal') amt = -Math.abs(amt)

      // Calculate amount for Buy/Sell if not provided
      if (['Buy', 'Sell'].includes(row.type) && row.quantity && row.price_per_unit) {
        const gross = row.quantity * row.price_per_unit
        amt = row.type === 'Buy' ? -(gross + fs) : (gross - fs)
      }

      // Insert the transaction
      const { data: newTx, error: txErr } = await supabase
        .from('transactions')
        .insert({
          account_id: row.account_id,
          asset_id: row.asset_id,
          date: row.date,
          type: row.type,
          quantity: row.quantity ?? null,
          price_per_unit: row.price_per_unit ?? null,
          amount: amt,
          fees: fs || null,
          notes: row.notes || null,
          funding_source: row.type === 'Buy' ? row.funding_source : null,
          user_id: userId,
        })
        .select('id')
        .single()

      if (txErr) throw txErr
      const txId = newTx.id

      // Handle Buy
      if (row.type === 'Buy' && row.quantity && row.price_per_unit && row.asset_id) {
        if (row.funding_source === 'external') {
          const depositAmt = Math.abs(amt)
          const { error: depErr } = await supabase.from('transactions').insert({
            account_id: row.account_id,
            asset_id: null,
            date: row.date,
            type: 'Deposit',
            amount: depositAmt,
            notes: `Auto-deposit for external buy`,
            user_id: userId,
          })
          if (depErr) throw depErr
        }

        const basis_per_unit = Math.abs(amt) / row.quantity
        const { error: lotErr } = await supabase.from('tax_lots').insert({
          account_id: row.account_id,
          asset_id: row.asset_id,
          purchase_date: row.date,
          quantity: row.quantity,
          cost_basis_per_unit: basis_per_unit,
          remaining_quantity: row.quantity,
          user_id: userId,
        })
        if (lotErr) throw lotErr
      }

      // Handle Sell
      else if (row.type === 'Sell' && row.quantity && row.price_per_unit && row.asset_id) {
        const { data: lots, error: lotsErr } = await supabase
          .from('tax_lots')
          .select('*')
          .eq('account_id', row.account_id)
          .eq('asset_id', row.asset_id)
          .gt('remaining_quantity', 0)
          .order('purchase_date', { ascending: true })

        if (lotsErr) throw lotsErr
        if (!lots?.length) throw new Error('No open tax lots for this sell')

        let remainingToSell = row.quantity
        let basisSold = 0

        for (const lot of lots) {
          if (remainingToSell <= 0) break
          const deplete = Math.min(remainingToSell, lot.remaining_quantity)
          basisSold += deplete * lot.cost_basis_per_unit
          remainingToSell -= deplete

          if (lot.remaining_quantity - deplete > 0) {
            const { error: upErr } = await supabase
              .from('tax_lots')
              .update({ remaining_quantity: lot.remaining_quantity - deplete })
              .eq('id', lot.id)
            if (upErr) throw upErr
          } else {
            const { error: upErr } = await supabase
              .from('tax_lots')
              .update({ remaining_quantity: 0 })
              .eq('id', lot.id)
            if (upErr) throw upErr
          }
        }

        if (remainingToSell > 0) throw new Error('Insufficient shares in tax lots')

        const proceeds = row.quantity * row.price_per_unit - fs
        const realized_gain = proceeds - basisSold

        const { error: gainErr } = await supabase
          .from('transactions')
          .update({ realized_gain })
          .eq('id', txId)
        if (gainErr) throw gainErr
      }

      successCount++
    } catch (err: any) {
      errors.push(`Row ${index + 2}: ${err.message || 'Unknown error'}`)
    }
  }

  return { 
    success: successCount > 0, 
    imported: successCount, 
    errors: errors.length > 0 ? errors : null,
    total: rows.length
  }
}