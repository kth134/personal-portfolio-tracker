import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { endOfMonth, startOfMonth, addMonths, parseISO, isAfter, format } from 'date-fns'

export async function POST(req: Request) {
  try {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const body = await req.json()
    const { lens, selectedValues, aggregate, benchmarks } = body

    // Get transactions, assets, accounts, sub_portfolios based on lens and selected
    let txQuery = supabase.from('transactions').select('*, account:accounts(name), asset:assets(id, ticker, name, asset_type, asset_subtype, geography, size_tag, factor_tag, sub_portfolios!sub_portfolio_id(name))').eq('user_id', user.id).order('date')

    if (lens !== 'total' && selectedValues.length > 0) {
      if (lens === 'account') {
        const { data: accounts } = await supabase.from('accounts').select('id').in('name', selectedValues)
        const accountIds = accounts?.map(a => a.id) || []
        txQuery = txQuery.in('account_id', accountIds)
      } else if (lens === 'sub_portfolio') {
        const { data: subs } = await supabase.from('sub_portfolios').select('id').in('name', selectedValues)
        const subIds = subs?.map(s => s.id) || []
        const { data: assets } = await supabase.from('assets').select('id').in('sub_portfolio_id', subIds)
        const assetIds = assets?.map(a => a.id) || []
        txQuery = txQuery.in('asset_id', assetIds)
      } else if (lens === 'asset') {
        txQuery = txQuery.in('asset_id', selectedValues)
      } else {
        const { data: assets } = await (supabase.from('assets').select('id') as any).in(lens, selectedValues)
        const assetIds = assets?.map((a: any) => a.id) || []
        txQuery = txQuery.in('asset_id', assetIds)
      }
    }

    const { data: txs } = await txQuery

    if (!txs || txs.length === 0) return NextResponse.json({ series: {} })

    // Get total cost basis from all tax lots for consistent total return calculation
    const { data: allLots } = await supabase
      .from('tax_lots')
      .select('cost_basis_per_unit, quantity, remaining_quantity')
      .eq('user_id', user.id)
    const totalCostBasis = allLots?.reduce((sum, lot) => 
      sum + (Number(lot.cost_basis_per_unit) * Number(lot.quantity || lot.remaining_quantity)), 0) || 0

    // Asset maps
    const assetToTicker = new Map((txs || []).filter(tx => tx.asset).map(tx => [tx.asset.id, tx.asset.ticker]))
    const assetField = (tx: any) => {
      switch (lens) {
        case 'sub_portfolio': return tx.asset?.sub_portfolios?.name
        case 'asset_type': return tx.asset?.asset_type
        case 'asset_subtype': return tx.asset?.asset_subtype
        case 'geography': return tx.asset?.geography
        case 'size_tag': return tx.asset?.size_tag
        case 'factor_tag': return tx.asset?.factor_tag
        default: return null
      }
    }

    // Group tx if not aggregate
    const groups = new Map<string, any[]>()
    if (aggregate || lens === 'total') {
      groups.set('aggregated', txs || [])
    } else {
      (txs || []).forEach(tx => {
        let groupId: string | null = null
        if (lens === 'account') {
          groupId = tx.account?.name
        } else if (tx.asset_id) {
          groupId = assetField(tx)
        }
        if (groupId && selectedValues.includes(groupId)) {
          if (!groups.has(groupId)) groups.set(groupId, [])
          groups.get(groupId)!.push(tx)
        }
      })
    }

    // Generate monthly dates
    const firstDate = txs[0].date
    const lastDate = new Date().toISOString().slice(0, 10)
    let current = endOfMonth(parseISO(firstDate))
    const dates: string[] = []
    while (!isAfter(current, new Date(lastDate))) {
      dates.push(format(current, 'yyyy-MM-dd'))
      current = endOfMonth(addMonths(current, 1))
    }
    // Always include today as the last point if not already included
    if (dates.length === 0 || dates[dates.length - 1] !== lastDate) {
      dates.push(lastDate)
    }

    // For each date, calculate metrics using performance tab logic with date filter
    const series: Record<string, any[]> = {}
    const allGroups = new Map<string, any[]>()

    // Get accounts for cash calculation
    const { data: accountsData } = await supabase
      .from('accounts')
      .select('id, name')
      .eq('user_id', user.id)

    const accountIdToName = new Map<string, string>()
    accountsData?.forEach(account => {
      accountIdToName.set(account.id, account.name.trim())
    })

    for (const d of dates) {
      // Filter transactions up to this date
      const transactionsUpToD = txs.filter(tx => tx.date <= d)

      // Calculate cash balances up to this date
      const cashBalances = new Map<string, number>()
      transactionsUpToD.forEach((tx: any) => {
        if (!tx.account_id) return
        // Skip automatic deposits for external buys
        if (tx.notes === 'Auto-deposit for external buy') {
          return
        }
        const current = cashBalances.get(tx.account_id) || 0
        let delta = 0
        const amt = Number(tx.amount || 0)
        const fee = Number(tx.fees || 0)
        switch (tx.type) {
          case 'Buy':
            if (tx.funding_source === 'cash') {
              delta -= (Math.abs(amt) + fee)
            }
            break
          case 'Sell':
            delta += (amt - fee)
            break
          case 'Dividend':
          case 'Interest':
            delta += amt
            break
          case 'Deposit':
            delta += amt
            break
          case 'Withdrawal':
            delta -= Math.abs(amt)
            break
        }
        const newBalance = current + delta
        cashBalances.set(tx.account_id, newBalance)
      })
      const totalCash = Array.from(cashBalances.values()).reduce((sum, bal) => sum + bal, 0)

      // Simulate tax lots up to this date
      const simulatedLots = new Map<string, Array<{ asset_id: string, quantity: number, cost_basis_per_unit: number, remaining_quantity: number }>>()
      transactionsUpToD.forEach((tx: any) => {
        if (!tx.asset_id) return
        const assetId = tx.asset_id
        const qty = Number(tx.quantity || 0)
        const prc = Number(tx.price_per_unit || 0)
        const amt = Number(tx.amount || 0)

        if (!simulatedLots.has(assetId)) simulatedLots.set(assetId, [])

        switch (tx.type) {
          case 'Buy':
            simulatedLots.get(assetId)!.push({
              asset_id: assetId,
              quantity: qty,
              cost_basis_per_unit: prc,
              remaining_quantity: qty
            })
            break
          case 'Sell':
            // FIFO
            let remaining = qty
            const lots = simulatedLots.get(assetId)!
            for (let i = 0; i < lots.length && remaining > 0; i++) {
              const lot = lots[i]
              if (lot.remaining_quantity > remaining) {
                lot.remaining_quantity -= remaining
                remaining = 0
              } else {
                remaining -= lot.remaining_quantity
                lot.remaining_quantity = 0
              }
            }
            // Remove fully sold lots
            simulatedLots.set(assetId, lots.filter(l => l.remaining_quantity > 0))
            break
        }
      })

      // Flatten simulated lots
      const allSimulatedLots = Array.from(simulatedLots.values()).flat()

      // Calculate performance summaries from transactions up to this date
      const performanceSummaries = new Map<string, { realized_gain: number, dividends: number, interest: number, fees: number }>()
      transactionsUpToD.forEach((tx: any) => {
        const asset = tx.asset
        let groupId: string | null = null
        switch (lens) {
          case 'asset': groupId = tx.asset_id; break
          case 'account': groupId = tx.account_id; break
          case 'sub_portfolio': groupId = asset?.sub_portfolio_id || null; break
          case 'asset_type': groupId = asset?.asset_type || null; break
          case 'asset_subtype': groupId = asset?.asset_subtype || null; break
          case 'geography': groupId = asset?.geography || null; break
          case 'size_tag': groupId = asset?.size_tag || null; break
          case 'factor_tag': groupId = asset?.factor_tag || null; break
        }
        if (!groupId) return

        if (!performanceSummaries.has(groupId)) {
          performanceSummaries.set(groupId, { realized_gain: 0, dividends: 0, interest: 0, fees: 0 })
        }
        const summary = performanceSummaries.get(groupId)!

        if (tx.type === 'Sell') {
          summary.realized_gain += Number(tx.realized_gain || 0)
        } else if (tx.type === 'Dividend') {
          summary.dividends += Number(tx.amount || 0)
        } else if (tx.type === 'Interest') {
          summary.interest += Number(tx.amount || 0)
        }
        summary.fees += Number(tx.fees || 0)
      })

      // Get historical prices for this date
      const tickers = Array.from(new Set(allSimulatedLots.map(lot => assetToTicker.get(lot.asset_id) || '').filter(Boolean)))
      const historicalPrices = await getHistoricalPricesForDate(tickers, d)

      // Calculate metrics for each group
      const metricsByGroup = new Map<string, { market_value: number, unrealized_gain: number, realized_gain: number, dividends: number, interest: number, fees: number, net_gain: number, total_cost_basis: number }>()
      
      // Get possible groupings
      const possibleGroupings = new Map<string, { displayName: string }>()
      allSimulatedLots.forEach((lot: any) => {
        const asset = txs.find(tx => tx.asset_id === lot.asset_id)?.asset
        let groupId: string | null = null
        let displayName = ''
        switch (lens) {
          case 'asset':
            groupId = lot.asset_id
            displayName = asset ? `${asset.ticker}${asset.name ? ` - ${asset.name}` : ''}` : lot.asset_id
            break
          case 'account':
            // For asset-level, account is not relevant, but we need to handle
            groupId = lot.asset_id // Use asset for now
            displayName = asset ? `${asset.ticker}` : lot.asset_id
            break
          case 'sub_portfolio':
            groupId = asset?.sub_portfolio_id || null
            displayName = groupId || '(no sub-portfolio)'
            break
          case 'asset_type':
            groupId = asset?.asset_type || null
            displayName = groupId || '(no type)'
            break
          case 'asset_subtype':
            groupId = asset?.asset_subtype || null
            displayName = groupId || '(no subtype)'
            break
          case 'geography':
            groupId = asset?.geography || null
            displayName = groupId || '(no geography)'
            break
          case 'size_tag':
            groupId = asset?.size_tag || null
            displayName = groupId || '(no size)'
            break
          case 'factor_tag':
            groupId = asset?.factor_tag || null
            displayName = groupId || '(no factor)'
            break
        }
        if (groupId && !possibleGroupings.has(groupId)) {
          possibleGroupings.set(groupId, { displayName })
        }
      })

      // Calculate metrics for each group
      possibleGroupings.forEach((group, groupId) => {
        const lotsInGroup = allSimulatedLots.filter((lot: any) => {
          const asset = txs.find(tx => tx.asset_id === lot.asset_id)?.asset
          let lotGroupId: string | null = null
          switch (lens) {
            case 'asset': lotGroupId = lot.asset_id; break
            case 'account': lotGroupId = lot.asset_id; break // Simplified
            case 'sub_portfolio': lotGroupId = asset?.sub_portfolio_id || null; break
            case 'asset_type': lotGroupId = asset?.asset_type || null; break
            case 'asset_subtype': lotGroupId = asset?.asset_subtype || null; break
            case 'geography': lotGroupId = asset?.geography || null; break
            case 'size_tag': lotGroupId = asset?.size_tag || null; break
            case 'factor_tag': lotGroupId = asset?.factor_tag || null; break
          }
          return lotGroupId === groupId
        })

        let marketValue = 0
        let totalCostBasis = 0
        lotsInGroup.forEach((lot: any) => {
          const ticker = assetToTicker.get(lot.asset_id) || ''
          const price = historicalPrices[ticker] || 0
          marketValue += lot.remaining_quantity * price
          totalCostBasis += lot.remaining_quantity * lot.cost_basis_per_unit
        })

        const unrealizedGain = marketValue - totalCostBasis
        const summary = performanceSummaries.get(groupId) || { realized_gain: 0, dividends: 0, interest: 0, fees: 0 }
        const netGain = unrealizedGain + summary.realized_gain + summary.dividends + summary.interest

        metricsByGroup.set(groupId, {
          market_value: marketValue,
          unrealized_gain: unrealizedGain,
          realized_gain: summary.realized_gain,
          dividends: summary.dividends,
          interest: summary.interest,
          fees: summary.fees,
          net_gain: netGain,
          total_cost_basis: totalCostBasis
        })
      })

      // For aggregated/total
      if (aggregate || lens === 'total') {
        const totalMarketValue = Array.from(metricsByGroup.values()).reduce((sum, m) => sum + m.market_value, 0)
        const totalUnrealized = Array.from(metricsByGroup.values()).reduce((sum, m) => sum + m.unrealized_gain, 0)
        const totalRealized = Array.from(metricsByGroup.values()).reduce((sum, m) => sum + m.realized_gain, 0)
        const totalDividends = Array.from(metricsByGroup.values()).reduce((sum, m) => sum + m.dividends, 0)
        const totalInterest = Array.from(metricsByGroup.values()).reduce((sum, m) => sum + m.interest, 0)
        const totalNet = totalUnrealized + totalRealized + totalDividends + totalInterest
        const totalCostBasis = Array.from(metricsByGroup.values()).reduce((sum, m) => sum + m.total_cost_basis, 0)

        if (!series['aggregated']) series['aggregated'] = []
        series['aggregated'].push({
          date: d,
          portfolioValue: totalMarketValue + totalCash,
          investmentValue: totalMarketValue,
          netGain: totalNet,
          unrealized: totalUnrealized,
          realized: totalRealized,
          income: totalDividends + totalInterest,
          costBasisTotal: totalCostBasis,
          benchmarkValues: {} // TODO
        })
      } else {
        // For each group
        metricsByGroup.forEach((metrics, groupId) => {
          if (!series[groupId]) series[groupId] = []
          series[groupId].push({
            date: d,
            portfolioValue: metrics.market_value + (lens === 'account' ? (cashBalances.get(groupId) || 0) : 0),
            investmentValue: metrics.market_value,
            netGain: metrics.net_gain,
            unrealized: metrics.unrealized_gain,
            realized: metrics.realized_gain,
            income: metrics.dividends + metrics.interest,
            costBasisTotal: metrics.total_cost_basis,
            benchmarkValues: {}
          })
        })
      }
    }

    return NextResponse.json({ series, totalCostBasis })
  } catch (error) {
    console.error(error)
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 })
  }
}

async function getHistoricalPricesForDate(tickers: string[], date: string) {
  const supabase = await createClient();
  const prices: Record<string, number> = {};

  const stocks = tickers.filter(t => t !== 'bitcoin');
  const cryptos = tickers.filter(t => t === 'bitcoin');

  // Try to get from DB first
  if (tickers.length > 0) {
    const { data: dbPrices, error } = await supabase
      .from('historical_prices')
      .select('ticker, close')
      .in('ticker', tickers)
      .eq('date', date);

    if (error) console.error('DB historical fetch error:', error);

    dbPrices?.forEach(p => {
      prices[p.ticker] = Number(p.close);
    });
  }

  // For missing prices, fetch from APIs
  const missingStocks = stocks.filter(t => !prices[t]);
  const missingCryptos = cryptos.filter(t => !prices[t]);

  if (missingStocks.length > 0) {
    // Use Finnhub or Alpha Vantage
    const finnhubKey = process.env.FINNHUB_API_KEY;
    if (finnhubKey) {
      for (const t of missingStocks) {
        try {
          const fromUnix = Math.floor(parseISO(date).getTime() / 1000);
          const toUnix = fromUnix + 86400; // Next day
          const finnhubUrl = `https://finnhub.io/api/v1/stock/candle?symbol=${t}&resolution=D&from=${fromUnix}&to=${toUnix}&token=${finnhubKey}`;
          const finnhubRes = await fetch(finnhubUrl);
          if (finnhubRes.ok) {
            const finnhubData = await finnhubRes.json();
            if (finnhubData.c && finnhubData.c.length > 0) {
              prices[t] = finnhubData.c[0];
              // Insert into DB
              await supabase.from('historical_prices').insert({
                ticker: t,
                date,
                close: finnhubData.c[0],
                source: 'finnhub'
              });
            }
          }
        } catch (e) {
          console.error(`Finnhub failed for ${t}:`, e);
        }
      }
    }
  }

  if (missingCryptos.length > 0) {
    for (const c of missingCryptos) {
      try {
        const dateParts = date.split('-').reverse().join('-'); // To dd-MM-yyyy for CoinGecko
        const url = `https://api.coingecko.com/api/v3/coins/${c}/history?date=${dateParts}`;
        const res = await fetch(url);
        if (res.ok) {
          const data = await res.json();
          const close = data.market_data?.current_price?.usd || 0;
          prices[c] = close;
          // Insert into DB
          await supabase.from('historical_prices').insert({
            ticker: c,
            date,
            close,
            source: 'coingecko'
          });
        }
      } catch (e) {
        console.error(`CoinGecko failed for ${c}:`, e);
      }
    }
  }

  return prices;
}