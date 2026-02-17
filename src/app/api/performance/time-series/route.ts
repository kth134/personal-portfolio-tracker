import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { endOfMonth, startOfMonth, addMonths, parseISO, isAfter, format, formatISO } from 'date-fns'
import { calculateCashBalances, fetchAllUserTransactionsServer } from '@/lib/finance'

type AssetMeta = {
  id?: string
  ticker?: string
  name?: string
  asset_type?: string
  asset_subtype?: string
  geography?: string
  size_tag?: string
  factor_tag?: string
  sub_portfolio_id?: string
}

type TransactionEntry = {
  date: string
  asset_id?: string
  account_id?: string
  asset?: AssetMeta | AssetMeta[]
  type?: string
  quantity?: number | string | null
  price_per_unit?: number | string | null
  realized_gain?: number | string | null
  amount?: number | string | null
}

type TaxLotEntry = {
  asset_id?: string
  account_id?: string
  purchase_date: string
  remaining_quantity?: number | string | null
  cost_basis_per_unit?: number | string | null
  quantity?: number | string | null
  asset?: AssetMeta | AssetMeta[]
}

type GroupBucket = {
  tx: TransactionEntry[]
  lots: TaxLotEntry[]
}

type SimulatedLot = {
  asset_id: string
  remaining_quantity: number
  cost_basis_per_unit: number
}

type SeriesPoint = {
  date: string
  portfolioValue: number
  netGain: number
  unrealized: number
  realized: number
  income: number
  totalReturnPct: number
  originalInvestment: number
  benchmarkValues: Record<string, number>
}

export async function POST(req: Request) {
  try {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const body = await req.json()
    const { lens, selectedValues, aggregate, benchmarks } = body

    // Fetch all transactions using centralized pagination
    const allTx = (await fetchAllUserTransactionsServer(supabase, user.id)) as TransactionEntry[]

    const lotsQuery = supabase.from('tax_lots').select(`
      asset_id, account_id, purchase_date, remaining_quantity, cost_basis_per_unit, quantity,
      asset:assets (id, ticker, name, asset_type, asset_subtype, geography, size_tag, factor_tag, sub_portfolio_id)
    `).eq('user_id', user.id)

    const { data: allLotsRaw } = await lotsQuery
    const allLots = (allLotsRaw || []) as TaxLotEntry[]

    console.log('Fetched transactions count:', allTx?.length || 0);

    if (!allTx || allTx.length === 0) return NextResponse.json({ series: {} })

    // Asset maps
    const assetToTicker = new Map<string, string>(
      allTx
        .map((tx) => (Array.isArray(tx.asset) ? tx.asset[0] : tx.asset))
        .filter((asset): asset is AssetMeta => Boolean(asset?.id && asset?.ticker))
        .map((asset) => [asset.id!, asset.ticker!])
    )

    // Generate dates (monthly + today)
    const firstDate = allTx[0].date
    const lastDate = new Date().toISOString().slice(0, 10)
    let current = endOfMonth(parseISO(firstDate))
    const dates: string[] = []
    while (!isAfter(current, new Date(lastDate))) {
      dates.push(format(current, 'yyyy-MM-dd'))
      current = endOfMonth(addMonths(current, 1))
    }
    if (dates[dates.length - 1] !== lastDate) dates.push(lastDate)

    // All tickers + benchmarks
    const portfolioTickers: string[] = [...new Set(
      allTx
        .filter(tx => tx.asset_id)
        .map(tx => {
          const asset = Array.isArray(tx.asset) ? tx.asset[0] : tx.asset
          return asset?.ticker
        })
        .filter((ticker): ticker is string => typeof ticker === 'string' && ticker.length > 0)
    )]
    const benchmarkMap: Record<string, string> = {
      sp500: 'SPY',
      nasdaq: 'QQQ',
      intlExUs: 'VXUS',
      gold: 'GLD',
      bitcoin: 'BTC'
    }
    const benchmarkTickers: string[] = (benchmarks as string[])
      .map((b: string) => benchmarkMap[b])
      .filter((ticker): ticker is string => typeof ticker === 'string' && ticker.length > 0)
    const allTickers: string[] = [...new Set([...portfolioTickers, ...benchmarkTickers])]
    const historicalPrices = await getHistoricalPrices(allTickers, firstDate, lastDate)
    const currentPrices = await getCurrentPrices(allTickers);
    const lastDateStr = formatISO(new Date(), { representation: 'date' });

    console.log('Historical prices keys:', Object.keys(historicalPrices));

    // For each date, simulate PerformanceContent calcs with filters
    const series: Record<string, SeriesPoint[]> = {}
    for (const d of dates) {
      // Filter data <= d
      const filteredTx = allTx.filter(tx => tx.date <= d)
      const filteredLots = allLots.filter(lot => lot.purchase_date <= d) // But remaining needs simulation

      // Group filtered tx/lots by lens (if not aggregate)
      const groups = new Map<string, GroupBucket>()
      if (aggregate || lens === 'total') {
        groups.set('aggregated', { tx: filteredTx, lots: filteredLots })
      } else {
        const getGroupId = (item: TransactionEntry | TaxLotEntry, isLot: boolean): string | null => {
          const rawAsset = item.asset
          const asset = Array.isArray(rawAsset) ? rawAsset[0] : rawAsset
          switch (lens) {
            case 'account': return item.account_id || null
            case 'sub_portfolio': return asset?.sub_portfolio_id || null
            case 'asset_type': return asset?.asset_type || null
            case 'asset_subtype': return asset?.asset_subtype || null
            case 'geography': return asset?.geography || null
            case 'size_tag': return asset?.size_tag || null
            case 'factor_tag': return asset?.factor_tag || null
            default: return null
          }
        }
        filteredTx.forEach(tx => {
          const groupId = getGroupId(tx, false)
          if (groupId && selectedValues.includes(groupId)) {
            if (!groups.has(groupId)) groups.set(groupId, { tx: [], lots: [] })
            groups.get(groupId)!.tx.push(tx)
          }
        })
        filteredLots.forEach(lot => {
          const groupId = getGroupId(lot, true)
          if (groupId && selectedValues.includes(groupId)) {
            if (!groups.has(groupId)) groups.set(groupId, { tx: [], lots: [] })
            groups.get(groupId)!.lots.push(lot)
          }
        })
      }

      // Compute for each group
      for (const [groupKey, { tx: groupTxs, lots: groupLots }] of groups) {
        if (!series[groupKey]) series[groupKey] = []

        // Cash balances using centralized helper
        const { totalCash: groupCash } = calculateCashBalances(groupTxs)

        // Total original investment (sum cost from all lots <= d)
        const groupOriginalInvestment = groupLots.reduce((sum, lot) => 
          sum + (Number(lot.cost_basis_per_unit) * Number(lot.quantity)), 0
        )

        // Simulate remaining_quantity for history (since tax_lots has current)
        const simulatedOpenLots: SimulatedLot[] = []
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
        for (const [assetId, lots] of assetLots) {
          lots.forEach(lot => {
            if (lot.qty > 0) {
              simulatedOpenLots.push({
                asset_id: assetId,
                remaining_quantity: lot.qty,
                cost_basis_per_unit: lot.basis,
              })
            }
          })
        }

        // Market value + unrealized using historical prices
        let marketValue = 0
        let unrealized = 0
        simulatedOpenLots.forEach(lot => {
          const ticker = assetToTicker.get(lot.asset_id) || ''
          const price = (d === lastDateStr ? (currentPrices[ticker] || 0) : (historicalPrices[ticker] || []).find(p => p.date === d)?.close || 0);
          marketValue += lot.remaining_quantity * price
          unrealized += lot.remaining_quantity * (price - lot.cost_basis_per_unit)
        })

        // Summaries (realized, dividends, etc.) from filtered tx
        const realized = groupTxs.reduce((sum, tx) => sum + (Number(tx.realized_gain) || 0), 0)
        const dividends = groupTxs.reduce((sum, tx) => sum + (tx.type === 'Dividend' ? Number(tx.amount || 0) : 0), 0)
        const interest = groupTxs.reduce((sum, tx) => sum + (tx.type === 'Interest' ? Number(tx.amount || 0) : 0), 0)
        const income = dividends + interest

        const netGain = unrealized + realized + income
        const portfolioValue = marketValue + groupCash
        const totalReturnPct = groupOriginalInvestment > 0 ? (netGain / groupOriginalInvestment) * 100 : 0

        // Benchmarks
        const bmValues: Record<string, number> = {}
        benchmarkTickers.forEach((bm: string) => {
          bmValues[bm] = (d === lastDateStr ? (currentPrices[bm] || 0) : (historicalPrices[bm] || []).find(p => p.date === d)?.close || 0);
        })

        series[groupKey].push({
          date: d,
          portfolioValue,
          netGain,
          unrealized,
          realized,
          income,
          totalReturnPct,
          originalInvestment: groupOriginalInvestment,
          benchmarkValues: bmValues,
        })
      }
    }

    return NextResponse.json({ series })
  } catch (error) {
    console.error(error)
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 })
  }
}

async function getHistoricalPrices(tickers: string[], start: string, end: string) {
  const supabase = await createClient();
  const prices: Record<string, { date: string, close: number }[]> = {};

const stocks = tickers.filter(t => t.toUpperCase() !== 'BTC');
    const cryptos = tickers.filter(t => t.toUpperCase() === 'BTC');

  // Helper to get monthly dates in range
    const getMonthlyDates = (startDate: Date, endDate: Date): string[] => {
    const dates: string[] = [];
    let current = endOfMonth(startOfMonth(startDate));
    while (current < endDate) {
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

      const fetchedData: { date: string, close: number }[] = [];
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
        inserts.push({ ticker: c, date: d, close, source: 'coingecko' });
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

async function getCurrentPrices(tickers: string[]) {
  const prices: Record<string, number> = {};
  const stocks = tickers.filter(t => t.toUpperCase() !== 'BTC'); // Add !='ETH' etc. if more cryptos.
  const cryptos = tickers.filter(t => t.toUpperCase() === 'BTC');

  // Stocks (Finnhub primary, Alpha fallback)
  const finnhubKey = process.env.FINNHUB_API_KEY;
  const alphaKey = process.env.ALPHA_VANTAGE_API_KEY;
  for (const ticker of stocks) {
    let price: number | undefined;
    let source = 'finnhub';

    const finnhubUrl = `https://finnhub.io/api/v1/quote?symbol=${ticker}&token=${finnhubKey}`;
    const finnhubRes = await fetch(finnhubUrl);
    if (finnhubRes.ok) {
      const data = await finnhubRes.json();
      price = data.c || data.pc;
    }

    if (!price || price <= 0) {
      source = 'alphavantage';
      const alphaUrl = `https://www.alphavantage.co/query?function=GLOBAL_QUOTE&symbol=${ticker}&apikey=${alphaKey}`;
      const alphaRes = await fetch(alphaUrl);
      if (alphaRes.ok) {
        const data = await alphaRes.json();
        const quote = data['Global Quote'];
        if (quote && quote['05. price']) {
          price = parseFloat(quote['05. price']);
        }
      }
    }

    if (price && price > 0) {
      prices[ticker] = price;
    } else {
      console.warn(`No current price for ${ticker}`);
      prices[ticker] = 0;
    }
  }

  // Cryptos (CoinGecko)
  if (cryptos.length) {
    const idMap: Record<string, string> = { BTC: 'bitcoin' };
    const cgIds = cryptos.map(t => idMap[t.toUpperCase()] || t.toLowerCase());
    const cgUrl = `https://api.coingecko.com/api/v3/simple/price?ids=${cgIds.join(',')}&vs_currencies=usd`;
    const cgRes = await fetch(cgUrl);
    if (cgRes.ok) {
      const cgPrices = await cgRes.json();
      cryptos.forEach((t, i) => {
        const cgId = cgIds[i];
        const price = cgPrices[cgId]?.usd || 0;
        prices[t] = price;
      });
    } else {
      console.warn('CoinGecko current fetch failed');
    }
  }

  return prices;
}