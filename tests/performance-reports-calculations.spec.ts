import test from 'node:test'
import assert from 'node:assert/strict'
import { buildTotalsFromSeries, rebaseSeriesToRange, type ReportPoint } from '../src/lib/performance-reports'

function clonePoints(points: ReportPoint[]): ReportPoint[] {
  return points.map(p => ({ ...p }))
}

test('rebases summary/chart metrics to selected date range', () => {
    const points = clonePoints([
      {
        date: '2026-01-01',
        portfolioValue: 1000,
        unrealized: 100,
        realized: 20,
        income: 10,
      },
      {
        date: '2026-02-01',
        portfolioValue: 1150,
        unrealized: 180,
        realized: 35,
        income: 25,
      },
    ])

    rebaseSeriesToRange(points)

    assert.equal(points[0].unrealized, 0)
    assert.equal(points[0].realized, 0)
    assert.equal(points[0].income, 0)
    assert.equal(points[0].netGain, 0)
    assert.equal(points[0].twr, 0)

    assert.equal(points[1].unrealized, 80)
    assert.equal(points[1].realized, 15)
    assert.equal(points[1].income, 15)
    assert.equal(points[1].netGain, 110)
    assert.ok(Math.abs((points[1].totalReturnPct || 0) - 15) < 1e-8)
    assert.ok(Math.abs((points[1].twr || 0) - 15) < 1e-8)
    assert.ok((points[1].irr || 0) > 15)
  })

test('builds totals from the last point for each group (aggregate mode)', () => {
    const series: Record<string, ReportPoint[]> = {
      Growth: [
        { date: '2026-01-01', netGain: 0, income: 0, realized: 0, unrealized: 0, totalReturnPct: 0, irr: 0 },
        { date: '2026-02-01', netGain: 125, income: 15, realized: 40, unrealized: 70, totalReturnPct: 12.5, irr: 18.2 },
      ],
      Value: [
        { date: '2026-01-01', netGain: 0, income: 0, realized: 0, unrealized: 0, totalReturnPct: 0, irr: 0 },
        { date: '2026-02-01', netGain: 80, income: 8, realized: 22, unrealized: 50, totalReturnPct: 8, irr: 11.1 },
      ],
    }

    const totals = buildTotalsFromSeries(series)

    assert.equal(totals.Growth.netGain, 125)
    assert.equal(totals.Growth.unrealized, 70)
    assert.equal(totals.Value.netGain, 80)
    assert.equal(totals.Value.realized, 22)
  })

test('non-aggregate mode still has group totals after rebasing', () => {
    const groupSeries: Record<string, ReportPoint[]> = {
      Brokerage: clonePoints([
        { date: '2026-01-01', portfolioValue: 2000, unrealized: 200, realized: 10, income: 5 },
        { date: '2026-03-01', portfolioValue: 2300, unrealized: 280, realized: 20, income: 15 },
      ]),
      Retirement: clonePoints([
        { date: '2026-01-01', portfolioValue: 3000, unrealized: 300, realized: 30, income: 12 },
        { date: '2026-03-01', portfolioValue: 3150, unrealized: 330, realized: 42, income: 20 },
      ]),
    }

    Object.values(groupSeries).forEach(rebaseSeriesToRange)
    const totals = buildTotalsFromSeries(groupSeries)

    assert.equal(totals.Brokerage.unrealized, 80)
    assert.equal(totals.Brokerage.realized, 10)
    assert.equal(totals.Brokerage.income, 10)
    assert.equal(totals.Brokerage.netGain, 100)

    assert.equal(totals.Retirement.unrealized, 30)
    assert.equal(totals.Retirement.realized, 12)
    assert.equal(totals.Retirement.income, 8)
    assert.equal(totals.Retirement.netGain, 50)
  })
