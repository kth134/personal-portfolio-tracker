// src/app/actions/transactionactions.ts
'use server'

import { createClient } from '@/lib/supabase/server'

type BuyInput = {
  account_id: string
  asset_id: string
  date: string
  quantity: number
  price_per_unit: number
  amount: number          // negative for buy (signed)
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

// Buy: delegates the Deposit + Buy + tax_lot inserts to a single Postgres
// transaction (RPC create_buy_with_lot), and triggers a FIFO recompute so any
// prior back-dated sells reconcile against the new lot.
export async function serverCreateBuyWithLot(input: BuyInput, _userId: string) {
  const supabase = await createClient()

  const { data, error } = await supabase.rpc('create_buy_with_lot', {
    p_account_id: input.account_id,
    p_asset_id: input.asset_id,
    p_date: input.date,
    p_quantity: input.quantity,
    p_price_per_unit: input.price_per_unit,
    p_amount: input.amount,
    p_fees: input.fees ?? 0,
    p_funding_source: input.funding_source ?? 'cash',
    p_notes: input.notes ?? null,
  })

  if (error) throw new Error(error.message)

  return {
    success: true,
    transaction_id: (data as { transaction_id: string }).transaction_id,
    deposit_id: (data as { deposit_id: string | null }).deposit_id,
  }
}

// Sell: the RPC inserts the Sell row AND runs the FIFO recompute. The caller
// must NOT pre-insert a sell transaction (contract change from the previous
// version, which required the caller to pass an already-created transaction_id).
export async function serverProcessSellFifo(input: SellInput, _userId: string) {
  const supabase = await createClient()

  const { data, error } = await supabase.rpc('process_sell_fifo', {
    p_account_id: input.account_id,
    p_asset_id: input.asset_id,
    p_date: input.date,
    p_quantity: input.quantity,
    p_price_per_unit: input.price_per_unit,
    p_fees: input.fees ?? 0,
    p_notes: input.notes ?? null,
  })

  if (error) throw new Error(error.message)

  return {
    success: true,
    transaction_id: (data as { transaction_id: string }).transaction_id,
    realized_gain: (data as { realized_gain: number }).realized_gain,
  }
}

// Bulk import:
// 1. H3: validate that any provided `amount` agrees with quantity*price ± fees
//    to within $0.01. Reject the row otherwise. Currently the prior code
//    silently overwrote conflicting amounts.
// 2. Sort rows chronologically for FIFO determinism (the RPC does its own
//    recompute, but sorting still helps when the input is reviewed).
// 3. If any row fails JS validation we return errors WITHOUT touching the
//    database. If JS validation passes, the entire batch is inserted in a
//    single Postgres transaction via the RPC — any DB error rolls back all
//    rows.
export async function serverBulkImportTransactions(rows: ValidatedRow[], _userId: string) {
  const supabase = await createClient()

  const errors: string[] = []
  const cleaned: ValidatedRow[] = []

  // chronological order
  const sorted = [...rows].sort((a, b) => a.date.localeCompare(b.date))

  sorted.forEach((row, index) => {
    const rowNum = index + 2 // header is row 1

    if (row.type === 'Buy' || row.type === 'Sell') {
      if (!row.quantity || !row.price_per_unit) {
        errors.push(`Row ${rowNum}: ${row.type} requires quantity and price_per_unit`)
        return
      }
      const fees = row.fees ?? 0
      const gross = row.quantity * row.price_per_unit
      const computed = row.type === 'Buy' ? -(gross + fees) : gross - fees

      // H3: only flag a mismatch when the user provided an `amount` AND it
      // disagrees with the computed value by more than a cent. If `amount`
      // wasn't provided, the computed value is authoritative.
      if (row.amount != null && Math.abs(row.amount - computed) > 0.01) {
        errors.push(
          `Row ${rowNum}: amount ${row.amount} does not match ${row.type === 'Buy' ? '-(qty*price+fees)' : '(qty*price-fees)'} = ${computed.toFixed(2)}`,
        )
        return
      }

      cleaned.push({ ...row, amount: computed })
    } else if (row.type === 'Withdrawal') {
      const amt = row.amount != null ? -Math.abs(row.amount) : 0
      cleaned.push({ ...row, amount: amt })
    } else {
      cleaned.push(row)
    }
  })

  if (errors.length > 0) {
    return {
      success: false,
      imported: 0,
      errors,
      total: rows.length,
    }
  }

  const payload = cleaned.map((row) => ({
    date: row.date,
    account_id: row.account_id,
    asset_id: row.asset_id,
    type: row.type,
    quantity: row.quantity ?? null,
    price_per_unit: row.price_per_unit ?? null,
    amount: row.amount ?? null,
    fees: row.fees ?? null,
    notes: row.notes ?? null,
    funding_source: row.type === 'Buy' ? (row.funding_source ?? 'cash') : null,
  }))

  const { data, error } = await supabase.rpc('bulk_import_transactions', {
    p_rows: payload,
  })

  if (error) {
    return {
      success: false,
      imported: 0,
      errors: [error.message],
      total: rows.length,
    }
  }

  const imported = (data as { imported: number }).imported ?? 0
  return {
    success: imported > 0,
    imported,
    errors: null,
    total: rows.length,
  }
}
