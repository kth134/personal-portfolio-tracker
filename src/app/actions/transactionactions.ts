// src/app/actions/transactionActions.ts
'use server'

import { createClient } from '@/lib/supabase/server' // Must use service_role key here!

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

export async function serverCreateBuyWithLot(input: BuyInput, userId: string) {
  const supabase = await createClient()

  // Optional: verify user owns the account
  const { data: acc, error: accErr } = await supabase
    .from('accounts')
    .select('user_id')
    .eq('id', input.account_id)
    .single()

  if (accErr || acc?.user_id !== userId) {
    throw new Error('Unauthorized: account access denied')
  }

  let depositId: string | null = null

  // 1. Auto-deposit if external
  if (input.funding_source === 'external') {
    const depositAmt = Math.abs(input.amount)
    const { data: depTx, error: depErr } = await supabase
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
      .select('id')
      .single()

    if (depErr) throw depErr
    depositId = depTx.id
  }

  // 2. Create tax lot
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

  return { success: true, depositId }
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
      const { error: delErr } = await supabase
        .from('tax_lots')
        .delete()
        .eq('id', lot.id)
      if (delErr) throw delErr
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