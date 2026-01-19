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

    // All tickers: portfolio + benchmarks
    const portfolioTickers = [...new Set(Array.from(groups.values()).flat().filter(tx => tx.asset_id).map(tx => assetToTicker.get(tx.asset_id) || ''))]
    const benchmarkMap: Record<string, string> = {
      sp500: 'SPY',
      nasdaq: 'QQQ',
      intlExUs: 'VXUS',
      gold: 'GLD',
      bitcoin: 'bitcoin'
    }
    const benchmarkTickers = (benchmarks as string[]).map((b: string) => benchmarkMap[b]).filter(Boolean)
    const allTickers = [...new Set([...portfolioTickers, ...benchmarkTickers])]
    const historicalPrices = await getHistoricalPrices(allTickers, firstDate, lastDate)

    // Simulate for each group
    const series: Record<string, any[]> = {}
    for (const [groupKey, groupTxs] of groups) {
      const groupSeries: any[] = []
      for (const d of dates) {
        const pastTx = groupTxs.filter(tx => tx.date <= d)
        let lots = new Map<string, { qty: number, basis: number }[]>()
        let cash = 0
        let invested = 0
        let realized = 0
        let income = 0
        let costBasisTotal = 0

        pastTx.forEach(tx => {
          const assetId = tx.asset_id
          const amt = Number(tx.amount || 0)
          const fee = Number(tx.fees || 0)
          const qty = Number(tx.quantity || 0)
          const prc = Number(tx.price_per_unit || 0)

          switch (tx.type) {
            case 'Buy':
              const cost = qty * prc + fee
              if (tx.funding_source === 'cash') {
                cash -= cost
              } else {
                invested += cost
              }
              if (!lots.has(assetId)) lots.set(assetId, [])
              lots.get(assetId)!.push({ qty, basis: prc })
              costBasisTotal += qty * prc
              break
            case 'Sell':
              cash += amt - fee
              realized += Number(tx.realized_gain || 0)
              if (lots.has(assetId)) {
                let remain = qty
                const assetLots = lots.get(assetId)!
                for (let i = 0; i < assetLots.length && remain > 0; i++) {
                  const lotQty = assetLots[i].qty
                  if (lotQty > remain) {
                    assetLots[i].qty -= remain
                    costBasisTotal -= remain * assetLots[i].basis
                    remain = 0
                  } else {
                    remain -= lotQty
                    costBasisTotal -= lotQty * assetLots[i].basis
                    assetLots[i].qty = 0
                  }
                }
                lots.set(assetId, assetLots.filter(l => l.qty > 0))
              }
              break
            case 'Dividend':
            case 'Interest':
              cash += amt
              income += amt
              break
            case 'Deposit':
              cash += amt
              invested += amt
              break
            case 'Withdrawal':
              cash -= Math.abs(amt)
              invested -= Math.abs(amt)
              break
          }
        })

        // Investment value
        let investmentValue = 0
        for (const [assetId, assetLots] of lots) {
          const ticker = assetToTicker.get(assetId) || ''
          const prices = historicalPrices[ticker] || []
          const priceObj = prices.find((p: any) => p.date === d)
          const price = priceObj?.close || 0
          investmentValue += assetLots.reduce((sum, l) => sum + l.qty * price, 0)
        }

        const portfolioValue = investmentValue + cash
        const unrealized = investmentValue - costBasisTotal
        const netGain = portfolioValue - invested

        const bmValues: Record<string, number> = {}
        benchmarkTickers.forEach((bm: string) => {
          const prices = historicalPrices[bm] || []
          const priceObj = prices.find((p: any) => p.date === d)
          bmValues[bm] = priceObj?.close || 0
        })

        groupSeries.push({
          date: d,
          portfolioValue,
          investmentValue,
          netGain,
          unrealized,
          realized,
          income,
          costBasisTotal,
          benchmarkValues: bmValues,
        })
      }
      series[groupKey] = groupSeries
    }

    return NextResponse.json({ series, totalCostBasis })
  } catch (error) {
    console.error(error)
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 })
  }
}

async function getHistoricalPrices(tickers: string[], start: string, end: string) {
  const supabase = await createClient();
  const prices: Record<string, { date: string, close: number }[]> = {};

  const stocks = tickers.filter(t => t !== 'bitcoin');
  const cryptos = tickers.filter(t => t === 'bitcoin');

  // Helper to get monthly dates in range
  const getMonthlyDates = (startDate: Date, endDate: Date): string[] => {
    const dates: string[] = [];
    let current = endOfMonth(startOfMonth(startDate));
    while (current <= endDate) {
      dates.push(format(current, 'yyyy-MM-dd'));
      current = addMonths(current, 1);
    }
    return dates;
  };

  const startDate = parseISO(start);
  const endDate = parseISO(end);
  const neededDates = getMonthlyDates(startDate, endDate);

  // Fetch from DB first
  if (tickers.length > 0 && neededDates.length > 0) {
    const { data: dbPrices, error } = await supabase
      .from('historical_prices')
      .select('ticker, date, close')
      .in('ticker', tickers)
      .in('date', neededDates)
      .order('date');

    if (error) console.error('DB historical fetch error:', error);

    dbPrices?.forEach(p => {
      if (!prices[p.ticker]) prices[p.ticker] = [];
      prices[p.ticker].push({ date: p.date, close: Number(p.close) });
    });
  }

  // Find and fetch gaps
  const inserts: { ticker: string, date: string, close: number, source: string }[] = [];

  if (stocks.length) {
    const finnhubKey = process.env.FINNHUB_API_KEY;
    const alphaKey = process.env.ALPHA_VANTAGE_API_KEY;
    if (!finnhubKey) throw new Error('Missing FINNHUB_API_KEY');
    if (!alphaKey) throw new Error('Missing ALPHA_VANTAGE_API_KEY');

    for (const t of stocks) {
      if (!prices[t]) prices[t] = [];
      const existingDates = new Set(prices[t].map(p => p.date));
      if (existingDates.size === neededDates.length) continue; // No gaps

      let fetchedData: { date: string, close: number }[] = [];
      let source = 'finnhub';

      // Finnhub primary
      const fromUnix = Math.floor(startDate.getTime() / 1000);
      const toUnix = Math.floor(endDate.getTime() / 1000);
      const finnhubUrl = `https://finnhub.io/api/v1/stock/candle?symbol=${t}&resolution=M&from=${fromUnix}&to=${toUnix}&token=${finnhubKey}`;
      const finnhubRes = await fetch(finnhubUrl);
      if (finnhubRes.ok) {
        const finnhubData = await finnhubRes.json();
        if (finnhubData.c && finnhubData.t) {
          finnhubData.t.forEach((timestamp: number, i: number) => {
            const dateStr = new Date(timestamp * 1000).toISOString().slice(0, 10);
            if (neededDates.includes(dateStr)) {
              fetchedData.push({ date: dateStr, close: finnhubData.c[i] });
            }
          });
        }
      } else {
        console.warn(`Finnhub failed for ${t}: ${finnhubRes.status}`);
      }

      // Alpha Vantage fallback
      if (fetchedData.length === 0) {
        source = 'alphavantage';
        const alphaUrl = `https://www.alphavantage.co/query?function=TIME_SERIES_MONTHLY&symbol=${t}&apikey=${alphaKey}`;
        const alphaRes = await fetch(alphaUrl);
        if (alphaRes.ok) {
          const alphaData = await alphaRes.json();
          const timeSeries = alphaData['Monthly Time Series'];
          if (timeSeries) {
            Object.keys(timeSeries).forEach(dateStr => {
              if (neededDates.includes(dateStr)) {
                const close = parseFloat(timeSeries[dateStr]['4. close']);
                fetchedData.push({ date: dateStr, close });
              }
            });
          }
        } else {
          console.warn(`Alpha Vantage failed for ${t}: ${alphaRes.status}`);
        }
      }

      // Add to prices and inserts
      fetchedData.forEach(item => {
        if (!existingDates.has(item.date)) {
          prices[t].push(item);
          inserts.push({ ticker: t, date: item.date, close: item.close, source });
        }
      });
      prices[t].sort((a, b) => a.date.localeCompare(b.date));
    }
  }

  if (cryptos.length) {
    for (const c of cryptos) {
      const id = c.toLowerCase();
      if (!prices[c]) prices[c] = [];
      const existingDates = new Set(prices[c].map(p => p.date));

      for (const d of neededDates) {
        if (existingDates.has(d)) continue;

        const dateParts = d.split('-').reverse().join('-'); // To dd-MM-yyyy for CoinGecko
        const url = `https://api.coingecko.com/api/v3/coins/${id}/history?date=${dateParts}`;
        const res = await fetch(url);
        if (!res.ok) {
          console.warn(`CoinGecko failed for ${c} on ${d}`);
          continue;
        }
        const data = await res.json();
        const close = data.market_data?.current_price?.usd || 0;
        prices[c].push({ date: d, close });
        inserts.push({ ticker: c.toUpperCase(), date: d, close, source: 'coingecko' });
      }
      prices[c].sort((a, b) => a.date.localeCompare(b.date));
    }
  }

  // Batch insert new prices
  if (inserts.length > 0) {
    const { error } = await supabase.from('historical_prices').insert(inserts);
    if (error) console.error('Historical insert error:', error);
  }

  return prices;
}