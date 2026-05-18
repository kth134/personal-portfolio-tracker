import test from 'node:test'
import assert from 'node:assert/strict'

import { computePerformanceForGroup } from '../src/lib/performance-engine.ts'

// Regression fixture for C2 in the 2026-05-14 audit.
//
// Scenario: $1,000 deposited and fully invested on 2025-01-01. The asset
// price never moves. A $50 dividend lands on 2025-07-01 and stays in cash.
// One year later (2026-01-01) the portfolio is worth $1,050:
//   - asset = $1,000 (10 shares @ $100, unchanged)
//   - cash  = $50 (the dividend, undistributed)
//
// The only return is the $50 dividend over ~1 year on $1,000, so the
// correct IRR is ~5%.
//
// Bug: src/lib/performance-engine.ts includes 'Dividend' and 'Interest' in
// `externalTypes`. The dividend is added as an inflow on the dividend date
// AND it sits in the terminal cashBalance — double-counting it. The
// observed IRR is therefore overstated (~10.3% on this fixture).

const transactions = [
  { id: 'd1', account_id: 'a1', date: '2025-01-01', type: 'Deposit', amount: 1000, fees: 0 },
  { id: 'b1', account_id: 'a1', asset_id: 'asset-x', date: '2025-01-01', type: 'Buy', amount: -1000, quantity: 10, price_per_unit: 100, fees: 0 },
  { id: 'div1', account_id: 'a1', asset_id: 'asset-x', date: '2025-07-01', type: 'Dividend', amount: 50, fees: 0 },
]

const currentMarketValue = 1000
const cashBalance = 50

test('IRR for a dividend-paying portfolio reflects only true returns (C2)', async () => {
  const result = await computePerformanceForGroup(
    transactions,
    currentMarketValue,
    cashBalance,
    '2025-01-01',
    '2026-01-01',
    false,
  )

  // True IRR on this fixture is 5% — the $50 dividend is the only return.
  // (The IRR solver finds ~5.0035% rather than exactly 5.00% because the
  // dividend lands mid-year and the solver values the timing.)
  //
  // Pre-fix this asserted ~10.26% (dividend was double-counted as both an
  // external inflow and part of terminal cashBalance). The C2 fix removed
  // Dividend/Interest from externalTypes; this test now guards against the
  // bug reappearing.
  assert.ok(
    Math.abs(result.annualized - 0.05) < 1e-3,
    `expected IRR ≈ 5.00% (only the $50 dividend is real return), got ${(result.annualized * 100).toFixed(4)}%`,
  )
})
