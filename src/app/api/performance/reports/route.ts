import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { addDays, addMonths, endOfMonth, format, formatISO, isAfter, parseISO, startOfMonth, subMonths, subYears } from 'date-fns'
import { calculateCashBalances, fetchAllUserTransactionsServer, transactionFlowForIRR, calculateIRR, netCashFlowsByDate } from '@/lib/finance'
import { buildTotalsFromSeries } from '@/lib/performance-reports'

export const dynamic = 'force-dynamic'

const BENCHMARK_MAP: Record<string, string> = {
  sp500: 'SPY',
  nasdaq: 'QQQ',
  tlt: 'TLT',
  vxus: 'VXUS',
}

const SIXTY_FORTY = '6040'

export async function POST(req: Request) {
  try {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const body = await req.json()
    const {
      lens = 'total',
      selectedValues = [],
      aggregate = true,
      period = '1Y',
      startDate,
      endDate,
      granularity = 'monthly',
      benchmarks = [],
    } = body
    const allTx = await fetchAllUserTransactionsServer(supabase, user.id)

    const inceptionDate = allTx.length
      ? allTx.reduce((min, tx) => (tx.date < min ? tx.date : min), allTx[0].date)
      : format(new Date(), 'yyyy-MM-dd')
    const { start, end } = resolveDateRange(period, startDate, endDate, inceptionDate)
    
    // Fetch sub-portfolios and accounts for name lookup
    const { data: subPortfolios } = await supabase
      .from('sub_portfolios')
      .select('id, name')
      .eq('user_id', user.id)
    const { data: accounts } = await supabase
      .from('accounts')
      .select('id, name')
      .eq('user_id', user.id)
    
    const subPortfolioNames = new Map(subPortfolios?.map(sp => [sp.id, sp.name]) || [])
    const accountNames = new Map(accounts?.map(acc => [acc.id, acc.name]) || [])
    
    const { data: allLots } = await supabase
      .from('tax_lots')
      .select(`
        asset_id,
        account_id,
        purchase_date,
        remaining_quantity,
        cost_basis_per_unit,
        quantity,
        asset:assets (id, ticker, asset_type, asset_subtype, geography, size_tag, factor_tag, sub_portfolio_id)
      `)
      .eq('user_id', user.id)

    if (!allTx || allTx.length === 0) {
      return NextResponse.json({ series: {}, totals: {}, benchmarks: {} })
    }

    const dates = buildDates(start, end, granularity)
    const lastDateStr = formatISO(new Date(), { representation: 'date' })

    const assetToTicker = new Map(allTx.filter(tx => tx.asset).map(tx => {
      const asset = Array.isArray(tx.asset) ? tx.asset[0] : tx.asset
      return [asset.id, asset.ticker]
    }))

    const portfolioTickers = [...new Set(allTx.filter(tx => tx.asset_id).map(tx => {
      const asset = Array.isArray(tx.asset) ? tx.asset[0] : tx.asset
      return asset?.ticker || ''
    }).filter(Boolean))]

    const benchmarkTickers = benchmarks
      .filter((b: string) => b !== SIXTY_FORTY)
      .map((b: string) => BENCHMARK_MAP[b])
      .filter(Boolean)

    const allTickers = [...new Set([...portfolioTickers, ...benchmarkTickers])]

    const historicalPrices = await getHistoricalPrices(supabase, allTickers, start, end, granularity)
    const currentPrices = await getCurrentPrices(supabase, allTickers)
    const benchmarkSeries = await getBenchmarkSeries(supabase, benchmarks, start, end, granularity)

    const series: Record<string, any[]> = {}
    const assetSeries: Record<string, Record<string, any[]>> = {} // For non-aggregate mode: group -> asset -> data
    const totals: Record<string, any> = {}
    const assetTotals: Record<string, Record<string, any>> = {} // For non-aggregate mode
    const assetBreakdown: Record<string, any[]> = {} // For total portfolio non-aggregate mode
    const startStateTxAll = allTx.filter(tx => tx.date < start)

    for (const d of dates) {
      const filteredTx = allTx.filter(tx => tx.date <= d)
      const periodTx = allTx.filter(tx => tx.date >= start && tx.date <= d)
      const filteredLots = (allLots || []).filter(lot => lot.purchase_date <= d)

      // Get group mapping for all assets (needed for both modes)
      const getAssetGroupId = (asset: any, lotAccountId?: string) => {
        if (!asset) return null
        switch (lens) {
          case 'account': return lotAccountId || asset.account_id
          case 'sub_portfolio': return asset.sub_portfolio_id
          case 'asset_type': return asset.asset_type
          case 'asset_subtype': return asset.asset_subtype
          case 'geography': return asset.geography
          case 'size_tag': return asset.size_tag
          case 'factor_tag': return asset.factor_tag
          default: return null
        }
      }

      const getGroupLabel = (groupId: string) => {
        if (lens === 'account') {
          return accountNames.get(groupId) || groupId
        }
        if (lens === 'sub_portfolio') {
          return subPortfolioNames.get(groupId) || groupId
        }
        return groupId
      }

      // Build asset info map
      const assetInfoMap = new Map<string, { ticker: string, name: string, groupId: string | null }>()
      allTx.forEach((tx: any) => {
        const asset = Array.isArray(tx.asset) ? tx.asset[0] : tx.asset
        if (asset?.id && !assetInfoMap.has(asset.id)) {
          assetInfoMap.set(asset.id, {
            ticker: asset.ticker || '',
            name: asset.name || asset.ticker || '',
            groupId: getAssetGroupId(asset, tx.account_id)
          })
        }
      })

      if (lens === 'total') {
        // Total portfolio lens: always keep aggregated series for summary cards
        if (!series['aggregated']) series['aggregated'] = []
        const calc = calculateGroupMetrics(
          filteredTx,
          periodTx,
          startStateTxAll,
          filteredLots,
          assetToTicker,
          historicalPrices,
          currentPrices,
          lastDateStr,
          d,
          start,
          lens,
        )
        series['aggregated'].push({ date: d, ...calc })

        // In non-aggregate mode, also return per-asset breakdown
        if (!aggregate) {
          const assetIds = new Set<string>()
          filteredTx.forEach((tx: any) => {
            if (tx.asset_id) assetIds.add(tx.asset_id)
          })
          filteredLots.forEach((lot: any) => {
            const lotAsset = Array.isArray(lot.asset) ? lot.asset[0] : lot.asset
            if (lotAsset?.id) assetIds.add(lotAsset.id)
          })

          Array.from(assetIds).forEach(assetId => {
            const assetInfo = assetInfoMap.get(assetId)
            const assetLabel = assetInfo?.name || assetInfo?.ticker || assetId
            if (!assetBreakdown[assetLabel]) assetBreakdown[assetLabel] = []

            const assetTx = filteredTx.filter(tx => tx.asset_id === assetId)
            const assetLots = filteredLots.filter(lot => {
              const lotAsset = Array.isArray(lot.asset) ? lot.asset[0] : lot.asset
              return lotAsset?.id === assetId
            })

            const assetPeriodTx = periodTx.filter(tx => tx.asset_id === assetId)
            const assetStartStateTx = startStateTxAll.filter(tx => tx.asset_id === assetId)
            const assetCalc = calculateGroupMetrics(
              assetTx,
              assetPeriodTx,
              assetStartStateTx,
              assetLots,
              assetToTicker,
              historicalPrices,
              currentPrices,
              lastDateStr,
              d,
              start,
              lens,
            )
            assetBreakdown[assetLabel].push({ date: d, ...assetCalc })
          })
        }
      } else if (aggregate) {
        // Aggregate mode: one series per selected group (group-level aggregation)
        const groupIds = new Set<string>()
        filteredLots.forEach((lot: any) => {
          const asset = Array.isArray(lot.asset) ? lot.asset[0] : lot.asset
          const groupId = getAssetGroupId(asset, lot.account_id)
          if (groupId && selectedValues.includes(groupId)) groupIds.add(groupId)
        })
        filteredTx.forEach((tx: any) => {
          const asset = Array.isArray(tx.asset) ? tx.asset[0] : tx.asset
          const groupId = getAssetGroupId(asset, tx.account_id)
          if (groupId && selectedValues.includes(groupId)) groupIds.add(groupId)
        })

        Array.from(groupIds).forEach(groupId => {
          const groupLabel = getGroupLabel(groupId)
          if (!series[groupLabel]) series[groupLabel] = []

          const groupTx = filteredTx.filter(tx => {
            const asset = Array.isArray(tx.asset) ? tx.asset[0] : tx.asset
            return getAssetGroupId(asset, tx.account_id) === groupId
          })
          const groupPeriodTx = periodTx.filter(tx => {
            const asset = Array.isArray(tx.asset) ? tx.asset[0] : tx.asset
            return getAssetGroupId(asset, tx.account_id) === groupId
          })
          const groupLots = filteredLots.filter(lot => {
            const asset = Array.isArray(lot.asset) ? lot.asset[0] : lot.asset
            return getAssetGroupId(asset, lot.account_id) === groupId
          })

          const groupStartStateTx = startStateTxAll.filter(tx => {
            const asset = Array.isArray(tx.asset) ? tx.asset[0] : tx.asset
            return getAssetGroupId(asset, tx.account_id) === groupId
          })

          const calc = calculateGroupMetrics(
            groupTx,
            groupPeriodTx,
            groupStartStateTx,
            groupLots,
            assetToTicker,
            historicalPrices,
            currentPrices,
            lastDateStr,
            d,
            start,
            lens,
          )
          series[groupLabel].push({ date: d, ...calc })
        })
      } else {
        // Non-aggregate mode: group -> asset level data
        const groupIds = new Set<string>()
        filteredLots.forEach((lot: any) => {
          const asset = Array.isArray(lot.asset) ? lot.asset[0] : lot.asset
          const groupId = getAssetGroupId(asset, lot.account_id)
          if (groupId && selectedValues.includes(groupId)) groupIds.add(groupId)
        })
        filteredTx.forEach((tx: any) => {
          const asset = Array.isArray(tx.asset) ? tx.asset[0] : tx.asset
          const groupId = getAssetGroupId(asset, tx.account_id)
          if (groupId && selectedValues.includes(groupId)) groupIds.add(groupId)
        })

        Array.from(groupIds).forEach(groupId => {
          const groupLabel = getGroupLabel(groupId)
          if (!assetSeries[groupLabel]) assetSeries[groupLabel] = {}
          if (!series[groupLabel]) series[groupLabel] = []

          // Keep group-level series populated in non-aggregate mode so summary cards stay accurate
          const groupTx = filteredTx.filter(tx => {
            const asset = Array.isArray(tx.asset) ? tx.asset[0] : tx.asset
            return getAssetGroupId(asset, tx.account_id) === groupId
          })
          const groupPeriodTx = periodTx.filter(tx => {
            const asset = Array.isArray(tx.asset) ? tx.asset[0] : tx.asset
            return getAssetGroupId(asset, tx.account_id) === groupId
          })
          const groupLots = filteredLots.filter(lot => {
            const asset = Array.isArray(lot.asset) ? lot.asset[0] : lot.asset
            return getAssetGroupId(asset, lot.account_id) === groupId
          })

          const groupStartStateTx = startStateTxAll.filter(tx => {
            const asset = Array.isArray(tx.asset) ? tx.asset[0] : tx.asset
            return getAssetGroupId(asset, tx.account_id) === groupId
          })

          const groupCalc = calculateGroupMetrics(
            groupTx,
            groupPeriodTx,
            groupStartStateTx,
            groupLots,
            assetToTicker,
            historicalPrices,
            currentPrices,
            lastDateStr,
            d,
            start,
            lens,
          )
          series[groupLabel].push({ date: d, ...groupCalc })

          // Get assets in this group
          const groupAssetIds = new Set<string>()
          filteredLots.forEach((lot: any) => {
            const asset = Array.isArray(lot.asset) ? lot.asset[0] : lot.asset
            if (getAssetGroupId(asset, lot.account_id) === groupId && asset?.id) {
              groupAssetIds.add(asset.id)
            }
          })

          Array.from(groupAssetIds).forEach(assetId => {
            const assetInfo = assetInfoMap.get(assetId)
            if (!assetInfo) return
            const assetLabel = assetInfo.name || assetInfo.ticker || assetId
            if (!assetSeries[groupLabel][assetLabel]) assetSeries[groupLabel][assetLabel] = []

            const assetTx = groupTx.filter(tx => tx.asset_id === assetId)
            const assetPeriodTx = groupPeriodTx.filter(tx => tx.asset_id === assetId)
            const assetLots = filteredLots.filter(lot => {
              const lotAsset = Array.isArray(lot.asset) ? lot.asset[0] : lot.asset
              return lotAsset?.id === assetId && getAssetGroupId(lotAsset, lot.account_id) === groupId
            })

            const assetStartStateTx = groupStartStateTx.filter(tx => tx.asset_id === assetId)

            const calc = calculateGroupMetrics(
              assetTx,
              assetPeriodTx,
              assetStartStateTx,
              assetLots,
              assetToTicker,
              historicalPrices,
              currentPrices,
              lastDateStr,
              d,
              start,
              lens,
            )
            assetSeries[groupLabel][assetLabel].push({ date: d, ...calc })
          })
        })
      }
    }

    // TWR should be based on first in-range portfolio value (matching chart expectation)
    Object.values(series).forEach(applyTWRFromFirstValue)
    Object.values(assetSeries).forEach(groupMap => {
      Object.values(groupMap).forEach(applyTWRFromFirstValue)
    })
    Object.values(assetBreakdown).forEach(applyTWRFromFirstValue)

    Object.assign(totals, buildTotalsFromSeries(series))

    // Calculate totals for non-aggregate mode (asset level)
    for (const groupKey of Object.keys(assetSeries)) {
      assetTotals[groupKey] = {}
      for (const assetKey of Object.keys(assetSeries[groupKey])) {
        const s = assetSeries[groupKey][assetKey]
        const last = s[s.length - 1]
        assetTotals[groupKey][assetKey] = {
          netGain: last?.netGain || 0,
          income: last?.income || 0,
          realized: last?.realized || 0,
          unrealized: last?.unrealized || 0,
          totalReturnPct: last?.totalReturnPct || 0,
          irr: last?.irr || 0,
        }
      }
    }

    return NextResponse.json({ 
      series, 
      totals, 
      benchmarks: benchmarkSeries,
      assetSeries: lens !== 'total' && !aggregate ? assetSeries : undefined,
      assetTotals: lens !== 'total' && !aggregate ? assetTotals : undefined,
      assetBreakdown: lens === 'total' && !aggregate ? assetBreakdown : undefined,
    })
  } catch (error) {
    console.error(error)
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 })
  }
}

function calculateGroupMetrics(
  groupStateTxs: any[],
  groupPeriodTxs: any[],
  groupStartStateTxs: any[],
  groupLots: any[],
  assetToTicker: Map<string, string>,
  historicalPrices: Record<string, { date: string, close: number }[]>,
  currentPrices: Record<string, number>,
  lastDateStr: string,
  d: string,
  rangeStartDate: string,
  lens: string = 'total'
) {
  const groupOriginalInvestment = groupLots.reduce((sum, lot) => sum + (Number(lot.cost_basis_per_unit) * Number(lot.quantity)), 0)

  const currentState = calculatePortfolioStateAtDate(
    groupStateTxs,
    assetToTicker,
    historicalPrices,
    currentPrices,
    lastDateStr,
    d,
  )
  const startState = calculatePortfolioStateAtDate(
    groupStartStateTxs,
    assetToTicker,
    historicalPrices,
    currentPrices,
    lastDateStr,
    rangeStartDate,
  )

  // Rebase unrealized to selected range start.
  const unrealized = currentState.unrealized - startState.unrealized

  // Match performance page semantics: realized/income come from transactions in selected period.
  const realized = groupPeriodTxs.reduce((sum, tx) => sum + (Number(tx.realized_gain) || 0), 0)
  const dividends = groupPeriodTxs.reduce((sum, tx) => sum + (tx.type === 'Dividend' ? Number(tx.amount || 0) - Math.abs(Number(tx.fees || 0)) : 0), 0)
  const interest = groupPeriodTxs.reduce((sum, tx) => sum + (tx.type === 'Interest' ? Number(tx.amount || 0) - Math.abs(Number(tx.fees || 0)) : 0), 0)
  const income = dividends + interest
  const netGain = unrealized + realized + income
  const portfolioValue = currentState.portfolioValue
  const totalReturnPct = startState.portfolioValue > 0 ? (netGain / startState.portfolioValue) * 100 : 0

  // Calculate IRR (MWR) using the centralized function
  // For account/total lens: include all cash flows (deposits/withdrawals)
  // For other lenses: calculate asset-only IRR (exclude deposits/withdrawals)
  const irr = calculateMWRForLens(groupPeriodTxs, portfolioValue, d, lens, {
    startPortfolioValue: startState.portfolioValue,
    startDate: rangeStartDate,
  })

  // Placeholder; overwritten by applyTWRFromFirstValue() after full series is built
  const twr = 0

  return {
    portfolioValue,
    netGain,
    unrealized,
    realized,
    income,
    totalReturnPct,
    originalInvestment: groupOriginalInvestment,
    startPortfolioValue: startState.portfolioValue,
    irr,
    twr,
  }
}

function calculatePortfolioStateAtDate(
  stateTxs: any[],
  assetToTicker: Map<string, string>,
  historicalPrices: Record<string, { date: string, close: number }[]>,
  currentPrices: Record<string, number>,
  lastDateStr: string,
  asOfDate: string,
) {
  const { totalCash } = calculateCashBalances(stateTxs)

  // Build open lots by simulating FIFO from transactions up to as-of date
  const simulatedOpenLots: { asset_id: string, remaining_quantity: number, cost_basis_per_unit: number }[] = []
  const assetLots = new Map<string, { qty: number, basis: number }[]>()

  stateTxs.forEach(tx => {
    const assetId = tx.asset_id
    if (!assetId) return
    if (tx.type === 'Buy') {
      const qty = Number(tx.quantity || 0)
      const prc = Number(tx.price_per_unit || 0)
      if (!assetLots.has(assetId)) assetLots.set(assetId, [])
      assetLots.get(assetId)!.push({ qty, basis: prc })
    } else if (tx.type === 'Sell') {
      const qty = Number(tx.quantity || 0)
      if (assetLots.has(assetId)) {
        let remain = qty
        const lots = assetLots.get(assetId)!
        for (let i = 0; i < lots.length && remain > 0; i++) {
          if (lots[i].qty > remain) {
            lots[i].qty -= remain
            remain = 0
          } else {
            remain -= lots[i].qty
            lots[i].qty = 0
          }
        }
        assetLots.set(assetId, lots.filter(l => l.qty > 0))
      }
    }
  })

  Array.from(assetLots.entries()).forEach(([assetId, lots]) => {
    lots.forEach(lot => {
      if (lot.qty > 0) {
        simulatedOpenLots.push({ asset_id: assetId, remaining_quantity: lot.qty, cost_basis_per_unit: lot.basis })
      }
    })
  })

  let totalBasis = 0
  let marketValue = 0

  simulatedOpenLots.forEach(lot => {
    const ticker = assetToTicker.get(lot.asset_id) || ''
    const price = asOfDate === lastDateStr
      ? (currentPrices[ticker] || getPriceAtOrBefore(historicalPrices[ticker] || [], asOfDate))
      : getPriceAtOrBefore(historicalPrices[ticker] || [], asOfDate)

    totalBasis += lot.remaining_quantity * lot.cost_basis_per_unit
    if (price > 0) {
      marketValue += lot.remaining_quantity * price
    }
  })

  const unrealized = marketValue - totalBasis
  const portfolioValue = marketValue + totalCash

  return {
    marketValue,
    totalBasis,
    unrealized,
    portfolioValue,
  }
}

function resolveDateRange(period: string, startDate?: string, endDate?: string, inceptionDate?: string) {
  if (startDate && endDate) return { start: startDate, end: endDate }
  const today = new Date()
  let start: Date
  switch (period) {
    case 'inception':
      if (inceptionDate) return { start: inceptionDate, end: format(today, 'yyyy-MM-dd') }
      start = subYears(today, 10)
      break
    case '1M': start = subMonths(today, 1); break
    case '3M': start = subMonths(today, 3); break
    case '1Y': start = subYears(today, 1); break
    case '3Y': start = subYears(today, 3); break
    case '5Y': start = subYears(today, 5); break
    case 'All': start = subYears(today, 10); break
    default: start = subYears(today, 1)
  }
  return { start: format(start, 'yyyy-MM-dd'), end: format(today, 'yyyy-MM-dd') }
}

function buildDates(start: string, end: string, granularity: 'daily' | 'monthly') {
  const dates: string[] = []
  if (granularity === 'daily') {
    let current = parseISO(start)
    const endDate = parseISO(end)
    while (!isAfter(current, endDate)) {
      dates.push(format(current, 'yyyy-MM-dd'))
      current = addDays(current, 1)
    }
    return dates
  }
  const startDate = parseISO(start)
  const endDate = parseISO(end)

  dates.push(format(startDate, 'yyyy-MM-dd'))

  let current = endOfMonth(startOfMonth(startDate))
  if (!isAfter(startDate, current)) {
    current = endOfMonth(addMonths(current, 1))
  }

  while (isAfter(endDate, current)) {
    dates.push(format(current, 'yyyy-MM-dd'))
    current = endOfMonth(addMonths(current, 1))
  }
  if (dates[dates.length - 1] !== end) dates.push(end)
  return dates
}

function calculateMWR(transactions: any[], portfolioValue: number, asOfDate: string) {
  return calculateMWRForLens(transactions, portfolioValue, asOfDate, 'total')
}

function applyTWRFromFirstValue(points: any[]) {
  if (!points || points.length === 0) return
  const firstPV = Number(points[0]?.portfolioValue || 0)
  points.forEach((p: any) => {
    const pv = Number(p?.portfolioValue || 0)
    const twr = firstPV > 0 ? ((pv / firstPV) - 1) * 100 : 0
    p.twr = twr
  })
}

function calculateMWRForLens(
  transactions: any[],
  portfolioValue: number,
  asOfDate: string,
  lens: string,
  opening?: { startPortfolioValue?: number, startDate?: string },
) {
  const flows: number[] = []
  const dates: Date[] = []

  const startPortfolioValue = Number(opening?.startPortfolioValue || 0)
  if (startPortfolioValue > 0 && opening?.startDate) {
    flows.push(-startPortfolioValue)
    dates.push(new Date(opening.startDate))
  }
  
  // For account/total lens: include all transactions (deposits/withdrawals matter)
  // For other lenses: only include asset transactions (Buy/Sell/Dividend/Interest)
  const includeAllFlows = lens === 'total' || lens === 'account'
  
  transactions.forEach(tx => {
    const type = tx?.type || ''
    // Skip non-asset flows for non-account lenses
    if (!includeAllFlows && (type === 'Deposit' || type === 'Withdrawal')) {
      return
    }
    // Skip fee-only transactions
    if (type === 'Fee') {
      return
    }
    flows.push(transactionFlowForIRR(tx))
    dates.push(new Date(tx.date))
  })
  
  // Terminal value (current portfolio value)
  flows.push(portfolioValue)
  dates.push(new Date(asOfDate))
  
  if (flows.length < 2) {
    console.log('[MWR] Not enough flows:', flows.length)
    return 0
  }
  
  const { netFlows, netDates } = netCashFlowsByDate(flows, dates)
  if (netFlows.length < 2) {
    return 0
  }

  const irr = calculateIRR(netFlows, netDates)

  if (!Number.isFinite(irr)) return 0

  return irr * 100
}

async function getHistoricalPrices(supabase: any, tickers: string[], start: string, end: string, granularity: 'daily' | 'monthly') {
  const prices: Record<string, { date: string, close: number }[]> = {}
  if (!tickers.length) return prices

  const neededDates = buildDates(start, end, granularity)
  const lookupStart = format(
    granularity === 'daily' ? addDays(parseISO(start), -14) : addMonths(parseISO(start), -2),
    'yyyy-MM-dd',
  )

  const { data: dbPrices } = await supabase
    .from('historical_prices')
    .select('ticker, date, close')
    .in('ticker', tickers)
    .gte('date', lookupStart)
    .lte('date', end)
    .order('date')

  dbPrices?.forEach((p: any) => {
    if (!prices[p.ticker]) prices[p.ticker] = []
    prices[p.ticker].push({ date: p.date, close: Number(p.close) })
  })

  const alphaKey = process.env.ALPHA_VANTAGE_API_KEY
  if (!alphaKey) throw new Error('Missing ALPHA_VANTAGE_API_KEY')

  const inserts: { ticker: string, date: string, close: number, source: string }[] = []

  for (const t of tickers) {
    if (!prices[t]) prices[t] = []
    const existingDates = new Set(prices[t].map(p => p.date))
    const hasAllNeeded = neededDates.every((date) => existingDates.has(date) || prices[t].some(p => p.date <= date))
    if (hasAllNeeded) continue

    const func = granularity === 'daily' ? 'TIME_SERIES_DAILY_ADJUSTED' : 'TIME_SERIES_MONTHLY'
    const alphaUrl = `https://www.alphavantage.co/query?function=${func}&symbol=${t}&apikey=${alphaKey}`
    const alphaRes = await fetch(alphaUrl)
    if (!alphaRes.ok) continue
    const alphaData = await alphaRes.json()
    const series = alphaData['Time Series (Daily)'] || alphaData['Monthly Time Series']
    if (!series) continue

    Object.keys(series).forEach(dateStr => {
      if (dateStr >= lookupStart && dateStr <= end && !existingDates.has(dateStr)) {
        const close = parseFloat(series[dateStr]['4. close'])
        prices[t].push({ date: dateStr, close })
        inserts.push({ ticker: t, date: dateStr, close, source: 'alphavantage' })
      }
    })
    prices[t].sort((a, b) => a.date.localeCompare(b.date))
  }

  if (inserts.length) {
    await supabase.from('historical_prices').insert(inserts)
  }

  return prices
}

async function getCurrentPrices(supabase: any, tickers: string[]) {
  const prices: Record<string, number> = {}
  if (!tickers.length) return prices

  const alphaKey = process.env.ALPHA_VANTAGE_API_KEY
  if (!alphaKey) throw new Error('Missing ALPHA_VANTAGE_API_KEY')

  for (const ticker of tickers) {
    const alphaUrl = `https://www.alphavantage.co/query?function=GLOBAL_QUOTE&symbol=${ticker}&apikey=${alphaKey}`
    const alphaRes = await fetch(alphaUrl)
    if (alphaRes.ok) {
      const data = await alphaRes.json()
      const quote = data['Global Quote']
      if (quote && quote['05. price']) {
        prices[ticker] = parseFloat(quote['05. price'])
        continue
      }
    }
    prices[ticker] = 0
  }
  return prices
}

async function getBenchmarkSeries(supabase: any, benchmarks: string[], start: string, end: string, granularity: 'daily' | 'monthly') {
  const series: Record<string, { date: string, value: number }[]> = {}
  const benchIds = benchmarks.filter((b: string) => b !== SIXTY_FORTY)
  const tickers = benchIds.map((b: string) => BENCHMARK_MAP[b]).filter(Boolean)
  const neededDates = buildDates(start, end, granularity)

  const prices = await getHistoricalPrices(supabase, tickers, start, end, granularity)
  benchIds.forEach((benchId: string) => {
    const ticker = BENCHMARK_MAP[benchId]
    const pts = prices[ticker] || []
    const aligned = neededDates.map((date) => ({ date, close: getPriceAtOrBefore(pts, date) }))
    const first = aligned.find((p) => p.close > 0)?.close || 0
    series[benchId] = aligned.map((p) => ({ date: p.date, value: first > 0 ? ((p.close / first) - 1) * 100 : 0 }))
  })

  if (benchmarks.includes(SIXTY_FORTY)) {
    const spy = series['sp500'] || []
    const tlt = series['tlt'] || []
    const mapTLT = new Map(tlt.map(p => [p.date, p.value]))
    series['6040'] = spy.map(p => ({ date: p.date, value: (p.value * 0.6) + ((mapTLT.get(p.date) || 0) * 0.4) }))
  }

  return series
}

function getPriceAtOrBefore(points: { date: string, close: number }[], targetDate: string) {
  if (!points || points.length === 0) return 0

  let candidate = 0
  for (const p of points) {
    if (p.date <= targetDate) candidate = Number(p.close || 0)
    else break
  }

  if (candidate > 0) return candidate

  // If no earlier price exists in range, use the earliest available
  return Number(points[0]?.close || 0)
}
