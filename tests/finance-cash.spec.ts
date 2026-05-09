import test from 'node:test'
import assert from 'node:assert/strict'

import { calculateCashBalances, calculateEffectiveCashBalances, type CashAnchor } from '../src/lib/finance.ts'

const sampleTransactions = [
  { id: 't1', account_id: 'acct-1', date: '2026-01-10', type: 'Deposit', amount: 1000, fees: 0 },
  { id: 't2', account_id: 'acct-1', date: '2026-01-12', type: 'Buy', amount: -400, fees: 0 },
  { id: 't3', account_id: 'acct-1', date: '2026-01-15', type: 'Dividend', amount: 25, fees: 0 },
  { id: 't4', account_id: 'acct-1', date: '2026-01-20', type: 'Withdrawal', amount: -50, fees: 0 },
  { id: 't5', account_id: 'acct-2', date: '2026-01-10', type: 'Deposit', amount: 300, fees: 0 },
]

test('effective cash matches auto cash when no anchors exist', () => {
  const auto = calculateCashBalances(sampleTransactions)
  const effective = calculateEffectiveCashBalances(sampleTransactions, [], '2026-01-31')

  assert.equal(effective.totalCash, auto.totalCash)
  assert.equal(effective.balances.get('acct-1'), auto.balances.get('acct-1'))
  assert.equal(effective.balances.get('acct-2'), auto.balances.get('acct-2'))
  assert.equal(effective.breakdownByAccount.get('acct-1')?.hasManualAnchor, false)
})

test('effective cash uses latest anchor and only later transaction deltas', () => {
  const anchors: CashAnchor[] = [
    { id: 'a1', account_id: 'acct-1', effective_date: '2026-01-12', balance: 610, created_at: '2026-01-12T20:00:00.000Z' },
  ]

  const effective = calculateEffectiveCashBalances(sampleTransactions, anchors, '2026-01-31')

  assert.equal(effective.autoBalances.get('acct-1'), 575)
  assert.equal(effective.balances.get('acct-1'), 585)
  assert.equal(effective.breakdownByAccount.get('acct-1')?.driftFromAuto, 10)
  assert.equal(effective.breakdownByAccount.get('acct-1')?.anchorEffectiveDate, '2026-01-12')
})

test('same-day transactions are treated as included in the anchor balance', () => {
  const anchors: CashAnchor[] = [
    { id: 'a1', account_id: 'acct-1', effective_date: '2026-01-15', balance: 700, created_at: '2026-01-16T08:00:00.000Z' },
  ]

  const effective = calculateEffectiveCashBalances(sampleTransactions, anchors, '2026-01-31')

  assert.equal(effective.balances.get('acct-1'), 650)
})

test('historical snapshots before an anchor fall back to auto cash', () => {
  const anchors: CashAnchor[] = [
    { id: 'a1', account_id: 'acct-1', effective_date: '2026-01-20', balance: 900, created_at: '2026-01-21T08:00:00.000Z' },
  ]

  const effective = calculateEffectiveCashBalances(sampleTransactions, anchors, '2026-01-15')

  assert.equal(effective.balances.get('acct-1'), 625)
  assert.equal(effective.breakdownByAccount.get('acct-1')?.hasManualAnchor, false)
})