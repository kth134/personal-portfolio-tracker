import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { addDays, addMonths, endOfMonth, format, formatISO, isAfter, parseISO, startOfMonth, subMonths, subYears } from 'date-fns'
import { calculateCashBalances, fetchAllUserTransactionsServer, transactionFlowForIRR, calculateIRR, netCashFlowsByDate } from '@/lib/finance'

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

    const { start, end } = resolveDateRange(period, startDate, endDate)
    const allTx = await fetchAllUserTransactionsServer(supabase, user.id)
    
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

    for (const d of dates) {
      const filteredTx = allTx.filter(tx => tx.date <= d)
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

      const getGroupLabel = (groupId: string, txList: any[]) => {
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
        // Total portfolio lens: always aggregate everything
        if (!series['aggregated']) series['aggregated'] = []
        const calc = calculateGroupMetrics(filteredTx, filteredLots, assetToTicker, historicalPrices, currentPrices, lastDateStr, d, lens)
        series['aggregated'].push({ date: d, ...calc })
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
          const groupLabel = getGroupLabel(groupId, filteredTx)
          if (!series[groupLabel]) series[groupLabel] = []

          const groupTx = filteredTx.filter(tx => {
            const asset = Array.isArray(tx.asset) ? tx.asset[0] : tx.asset
            return getAssetGroupId(asset, tx.account_id) === groupId
          })
          const groupLots = filteredLots.filter(lot => {
            const asset = Array.isArray(lot.asset) ? lot.asset[0] : lot.asset
            return getAssetGroupId(asset, lot.account_id) === groupId
          })

          const calc = calculateGroupMetrics(groupTx, groupLots, assetToTicker, historicalPrices, currentPrices, lastDateStr, d, lens)
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

        Array.from(groupIds).forEach(groupId => {
          const groupLabel = getGroupLabel(groupId, filteredTx)
          if (!assetSeries[groupLabel]) assetSeries[groupLabel] = {}

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

            const assetTx = filteredTx.filter(tx => tx.asset_id === assetId)
            const assetLots = filteredLots.filter(lot => {
              const lotAsset = Array.isArray(lot.asset) ? lot.asset[0] : lot.asset
              return lotAsset?.id === assetId
            })

            const calc = calculateGroupMetrics(assetTx, assetLots, assetToTicker, historicalPrices, currentPrices, lastDateStr, d, lens)
            assetSeries[groupLabel][assetLabel].push({ date: d, ...calc })
          })
        })
      }
    }

    // Calculate totals for aggregate mode
    for (const key of Object.keys(series)) {
      const s = series[key]
      const last = s[s.length - 1]
      totals[key] = {
        netGain: last?.netGain || 0,
        income: last?.income || 0,
        realized: last?.realized || 0,
        unrealized: last?.unrealized || 0,
        totalReturnPct: last?.totalReturnPct || 0,
        irr: last?.irr || 0,
      }
    }

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

    // For total portfolio, include asset-level breakdown for non-aggregate view
    let assetBreakdown: Record<string, any[]> = {}
    if (lens === 'total' && !aggregate) {
      // Build asset-level series for total portfolio non-aggregate mode
      for (const d of dates) {
        const filteredTx = allTx.filter(tx => tx.date <= d)
        const filteredLots = (allLots || []).filter(lot => lot.purchase_date <= d)

        const assetIds = new Set<string>()
        filteredLots.forEach((lot: any) => {
          const asset = Array.isArray(lot.asset) ? lot.asset[0] : lot.asset
          if (asset?.id) assetIds.add(asset.id)
        })

        Array.from(assetIds).forEach(assetId => {
          const assetTx = filteredTx.filter(tx => tx.asset_id === assetId)
          const assetLots = filteredLots.filter(lot => {
            const lotAsset = Array.isArray(lot.asset) ? lot.asset[0] : lot.asset
            return lotAsset?.id === assetId
          })

          const ticker = assetToTicker.get(assetId) || ''
          if (!assetBreakdown[ticker]) assetBreakdown[ticker] = []

          const calc = calculateGroupMetrics(assetTx, assetLots, assetToTicker, historicalPrices, currentPrices, lastDateStr, d, lens)
          assetBreakdown[ticker].push({ date: d, ...calc })
        })
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
  groupTxs: any[],
  groupLots: any[],
  assetToTicker: Map<string, string>,
  historicalPrices: Record<string, { date: string, close: number }[]>,
  currentPrices: Record<string, number>,
  lastDateStr: string,
  d: string,
  lens: string = 'total'
) {
  const { totalCash: groupCash } = calculateCashBalances(groupTxs)
  const groupOriginalInvestment = groupLots.reduce((sum, lot) => sum + (Number(lot.cost_basis_per_unit) * Number(lot.quantity)), 0)

  // Build open lots by simulating FIFO from transactions
  const simulatedOpenLots: any[] = []
  const assetLots = new Map<string, { qty: number, basis: number }[]>()
  groupTxs.forEach(tx => {
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

  // Calculate market value and unrealized gains
  let marketValue = 0
  let unrealized = 0
  simulatedOpenLots.forEach(lot => {
    const ticker = assetToTicker.get(lot.asset_id) || ''
    const price = (d === lastDateStr ? (currentPrices[ticker] || 0) : (historicalPrices[ticker] || []).find(p => p.date === d)?.close || 0)
    if (price > 0) {
      marketValue += lot.remaining_quantity * price
      unrealized += lot.remaining_quantity * (price - lot.cost_basis_per_unit)
    }
  })

  const realized = groupTxs.reduce((sum, tx) => sum + (Number(tx.realized_gain) || 0), 0)
  const dividends = groupTxs.reduce((sum, tx) => sum + (tx.type === 'Dividend' ? Number(tx.amount || 0) : 0), 0)
  const interest = groupTxs.reduce((sum, tx) => sum + (tx.type === 'Interest' ? Number(tx.amount || 0) : 0), 0)
  const income = dividends + interest
  const netGain = unrealized + realized + income
  const portfolioValue = marketValue + groupCash
  const totalReturnPct = groupOriginalInvestment > 0 ? (netGain / groupOriginalInvestment) * 100 : 0

  // Calculate IRR (MWR) using the centralized function
  // For account/total lens: include all cash flows (deposits/withdrawals)
  // For other lenses: calculate asset-only IRR (exclude deposits/withdrawals)
  const irr = calculateMWRForLens(groupTxs, portfolioValue, d, lens)

  // Calculate TWR - time-weighted return based on portfolio value change
  const twr = groupOriginalInvestment > 0 ? ((portfolioValue / groupOriginalInvestment) - 1) * 100 : 0

  return {
    portfolioValue,
    netGain,
    unrealized,
    realized,
    income,
    totalReturnPct,
    originalInvestment: groupOriginalInvestment,
    irr,
    twr,
  }
}

function resolveDateRange(period: string, startDate?: string, endDate?: string) {
  if (startDate && endDate) return { start: startDate, end: endDate }
  const today = new Date()
  let start: Date
  switch (period) {
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
  let current = endOfMonth(startOfMonth(parseISO(start)))
  const endDate = parseISO(end)
  while (!isAfter(current, endDate)) {
    dates.push(format(current, 'yyyy-MM-dd'))
    current = endOfMonth(addMonths(current, 1))
  }
  if (dates[dates.length - 1] !== end) dates.push(end)
  return dates
}

function calculateMWR(transactions: any[], portfolioValue: number, asOfDate: string) {
  return calculateMWRForLens(transactions, portfolioValue, asOfDate, 'total')
}

function calculateMWRForLens(transactions: any[], portfolioValue: number, asOfDate: string, lens: string) {
  const flows: number[] = []
  const dates: Date[] = []
  
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
  flows.push(-portfolioValue)
  dates.push(new Date(asOfDate))
  
  if (flows.length < 2) return 0
  
  const { netFlows, netDates } = netCashFlowsByDate(flows, dates)
  if (netFlows.length < 2) return 0
  
  const irr = calculateIRR(netFlows, netDates)
  if (!Number.isFinite(irr)) return 0
  
  return irr * 100
}

async function getHistoricalPrices(supabase: any, tickers: string[], start: string, end: string, granularity: 'daily' | 'monthly') {
  const prices: Record<string, { date: string, close: number }[]> = {}
  if (!tickers.length) return prices

  const neededDates = buildDates(start, end, granularity)

  const { data: dbPrices } = await supabase
    .from('historical_prices')
    .select('ticker, date, close')
    .in('ticker', tickers)
    .in('date', neededDates)
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
    if (existingDates.size === neededDates.length) continue

    const func = granularity === 'daily' ? 'TIME_SERIES_DAILY_ADJUSTED' : 'TIME_SERIES_MONTHLY'
    const alphaUrl = `https://www.alphavantage.co/query?function=${func}&symbol=${t}&apikey=${alphaKey}`
    const alphaRes = await fetch(alphaUrl)
    if (!alphaRes.ok) continue
    const alphaData = await alphaRes.json()
    const series = alphaData['Time Series (Daily)'] || alphaData['Monthly Time Series']
    if (!series) continue

    Object.keys(series).forEach(dateStr => {
      if (neededDates.includes(dateStr) && !existingDates.has(dateStr)) {
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

  const prices = await getHistoricalPrices(supabase, tickers, start, end, granularity)
  benchIds.forEach((benchId: string) => {
    const ticker = BENCHMARK_MAP[benchId]
    const pts = prices[ticker] || []
    const first = pts[0]?.close || 1
    series[benchId] = pts.map(p => ({ date: p.date, value: first > 0 ? ((p.close / first) - 1) * 100 : 0 }))
  })

  if (benchmarks.includes(SIXTY_FORTY)) {
    const spy = series['sp500'] || []
    const tlt = series['tlt'] || []
    const mapTLT = new Map(tlt.map(p => [p.date, p.value]))
    series['6040'] = spy.map(p => ({ date: p.date, value: (p.value * 0.6) + ((mapTLT.get(p.date) || 0) * 0.4) }))
  }

  return series
}
