import { parseISO } from 'date-fns'

export type ReportPoint = {
  date: string
  portfolioValue?: number
  netGain?: number
  unrealized?: number
  realized?: number
  income?: number
  totalReturnPct?: number
  irr?: number
  twr?: number
}

export function rebaseSeriesToRange(points: ReportPoint[]) {
  if (!points || points.length === 0) return

  const baseline = points[0]
  const baselinePortfolioValue = Number(baseline?.portfolioValue || 0)
  const baselineUnrealized = Number(baseline?.unrealized || 0)
  const baselineRealized = Number(baseline?.realized || 0)
  const baselineIncome = Number(baseline?.income || 0)
  const baselineDate = parseISO(baseline.date)

  points.forEach((p) => {
    const unrealized = Number(p?.unrealized || 0) - baselineUnrealized
    const realized = Number(p?.realized || 0) - baselineRealized
    const income = Number(p?.income || 0) - baselineIncome
    const netGain = unrealized + realized + income

    const pv = Number(p?.portfolioValue || 0)
    const twr = baselinePortfolioValue !== 0
      ? ((pv / baselinePortfolioValue) - 1) * 100
      : 0

    const currentDate = parseISO(p.date)
    const years = (currentDate.getTime() - baselineDate.getTime()) / (365.25 * 24 * 60 * 60 * 1000)
    const irr = years > 0
      ? ((Math.pow(1 + (twr / 100), 1 / years) - 1) * 100)
      : 0

    p.unrealized = unrealized
    p.realized = realized
    p.income = income
    p.netGain = netGain
    p.totalReturnPct = twr
    p.twr = twr
    p.irr = Number.isFinite(irr) ? irr : 0
  })
}

export function buildTotalsFromSeries(series: Record<string, ReportPoint[]>) {
  const totals: Record<string, {
    netGain: number
    income: number
    realized: number
    unrealized: number
    totalReturnPct: number
    irr: number
  }> = {}

  for (const key of Object.keys(series || {})) {
    const s = series[key] || []
    const last = s[s.length - 1]
    totals[key] = {
      netGain: Number(last?.netGain || 0),
      income: Number(last?.income || 0),
      realized: Number(last?.realized || 0),
      unrealized: Number(last?.unrealized || 0),
      totalReturnPct: Number(last?.totalReturnPct || 0),
      irr: Number(last?.irr || 0),
    }
  }

  return totals
}
