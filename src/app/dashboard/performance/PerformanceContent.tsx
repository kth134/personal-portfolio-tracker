'use client';

import { useState, useEffect, useMemo } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { formatUSD } from '@/lib/formatters';
import { cn } from '@/lib/utils';
import { refreshAssetPrices } from '../portfolio/actions';
import { ChevronUp, ChevronDown, ChevronsUpDown } from 'lucide-react';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';

function calculateIRR(cashFlows: number[], dates: Date[]): number {
  // Sort by date just in case
  const sorted = dates.map((d, i) => ({ d, cf: cashFlows[i] }))
    .sort((a, b) => a.d.getTime() - b.d.getTime());
  const sortedDates = sorted.map(({ d }) => d);
  const sortedCashFlows = sorted.map(({ cf }) => cf);

  // Newton-Raphson (increased iter, better guess)
  let guess = 0.1;  // Start higher for growth portfolios
  const maxIter = 1000;
  const precision = 1e-8;
  for (let i = 0; i < maxIter; i++) {
    let npv = 0;
    let dnpv = 0;
    sortedCashFlows.forEach((cf, j) => {
      const years = (sortedDates[j].getTime() - sortedDates[0].getTime()) / (365.25 * 24 * 60 * 60 * 1000);
      const denom = Math.pow(1 + guess, years);
      npv += cf / denom;
      dnpv -= years * cf / (denom * (1 + guess));
    });
    if (Math.abs(npv) < precision) return guess;
    if (Math.abs(dnpv) < precision) break;  // Avoid div/0
    guess -= npv / dnpv;
    if (guess < -0.99 || guess > 50) break;  // Bound extreme - increased for high-growth assets
  }

  // Fallback to bisection if Newton fails
  let low = -0.99;
  let high = 20.0;  // Cap at 2000% for high-growth assets like crypto
  for (let i = 0; i < 200; i++) {  // Increased iterations
    const mid = (low + high) / 2;
    let npv = 0;
    sortedCashFlows.forEach((cf, j) => {
      const years = (sortedDates[j].getTime() - sortedDates[0].getTime()) / (365.25 * 24 * 60 * 60 * 1000);
      npv += cf / Math.pow(1 + mid, years);
    });
    if (Math.abs(npv) < precision) return mid;
    if (npv > 0) low = mid;
    else high = mid;
  }
  return NaN;  // Still fail? Rare
}

const LENSES = [
  { value: 'asset', label: 'Asset' },
  { value: 'account', label: 'Account' },
  { value: 'sub_portfolio', label: 'Sub-Portfolio' },
  { value: 'asset_type', label: 'Asset Type' },
  { value: 'asset_subtype', label: 'Asset Subtype' },
  { value: 'geography', label: 'Geography' },
  { value: 'size_tag', label: 'Size' },
  { value: 'factor_tag', label: 'Factor/Style' },
];

function PerformanceContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const supabase = createClient();

  const initialLens = searchParams.get('lens') || 'asset';
  const [lens, setLens] = useState(initialLens);
  const [summaries, setSummaries] = useState<any[]>([]);
  const [totalOriginalInvestment, setTotalOriginalInvestment] = useState<number>(0);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [refreshMessage, setRefreshMessage] = useState<string | null>(null);
  const [totalAnnualizedReturnPct, setTotalAnnualizedReturnPct] = useState<number>(0);

  // Sorting state
  const [sortColumn, setSortColumn] = useState<string>('market_value');
  const [sortDirection, setSortDirection] = useState<'asc' | 'desc'>('desc');

  // Sorted summaries
  const sortedSummaries = useMemo(() => {
    return [...summaries].sort((a, b) => {
      let aVal: any = a[sortColumn];
      let bVal: any = b[sortColumn];

      // Handle null/undefined values
      if (aVal == null && bVal == null) return 0;
      if (aVal == null) return sortDirection === 'asc' ? -1 : 1;
      if (bVal == null) return sortDirection === 'asc' ? 1 : -1;

      // Handle string sorting
      if (typeof aVal === 'string' && typeof bVal === 'string') {
        aVal = aVal.toLowerCase();
        bVal = bVal.toLowerCase();
      }

      if (aVal < bVal) return sortDirection === 'asc' ? -1 : 1;
      if (aVal > bVal) return sortDirection === 'asc' ? 1 : -1;
      return 0;
    });
  }, [summaries, sortColumn, sortDirection]);

  // Handle column sorting
  const handleSort = (column: string) => {
    if (sortColumn === column) {
      setSortDirection(sortDirection === 'asc' ? 'desc' : 'asc');
    } else {
      setSortColumn(column);
      setSortDirection('asc');
    }
  };

  // Get sort icon for column
  const getSortIcon = (column: string) => {
    if (sortColumn !== column) {
      return <ChevronsUpDown className="ml-2 h-4 w-4" />;
    }
    return sortDirection === 'asc' 
      ? <ChevronUp className="ml-2 h-4 w-4" />
      : <ChevronDown className="ml-2 h-4 w-4" />;
  };

  // Calculate totals
  const totals = useMemo(() => {
    return summaries.reduce(
      (acc, row) => ({
        market_value: acc.market_value + (row.market_value || 0),
        unrealized_gain: acc.unrealized_gain + (row.unrealized_gain || 0),
        realized_gain: acc.realized_gain + (row.realized_gain || 0),
        dividends: acc.dividends + (row.dividends || 0),
        net_gain: acc.net_gain + (row.net_gain || 0),
      }),
      { market_value: 0, unrealized_gain: 0, realized_gain: 0, dividends: 0, net_gain: 0 }
    );
  }, [summaries]);

  const handleRefreshPrices = async () => {
    setRefreshing(true);
    setRefreshMessage(null);
    try {
      const result = await refreshAssetPrices();
      setRefreshMessage(result.message || 'Prices refreshed!');
      // Force refetch of data
      // Since we use useEffect on lens only → temporarily change lens and revert
      const current = lens;
      setLens('__temp__' as any);
      setTimeout(() => setLens(current), 100);
    } catch (err) {
      setRefreshMessage('Refresh failed – check console');
      console.error(err);
    } finally {
      setRefreshing(false);
    }
  };

  useEffect(() => {
    const fetchData = async () => {
      setLoading(true);
      try {
        // Update URL
        const newParams = new URLSearchParams(searchParams.toString());
        newParams.set('lens', lens);
        router.replace(`/dashboard/performance?${newParams.toString()}`, { scroll: false });

        const { data: { user } } = await supabase.auth.getUser();
        const userId = user?.id;
        if (!userId) throw new Error("No user");

        // Fetch all tax lots (including sold ones) to calculate total original investment and groupings
        const { data: allLotsData, error: allLotsError } = await supabase
          .from('tax_lots')
          .select(`
            asset_id,
            account_id,
            remaining_quantity,
            cost_basis_per_unit,
            quantity,
            asset:assets (
              id,
              ticker,
              name,
              asset_type,
              asset_subtype,
              geography,
              size_tag,
              factor_tag,
              sub_portfolio_id
            )
          `)
          .eq('user_id', userId);

        if (allLotsError) throw allLotsError;

        // Fetch all transactions for IRR calculation
        const { data: transactionsData, error: txError } = await supabase
          .from('transactions')
          .select(`
            date,
            type,
            amount,
            fees,
            funding_source,
            notes,
            asset_id,
            account_id,
            asset:assets (
              asset_type,
              asset_subtype,
              geography,
              size_tag,
              factor_tag,
              sub_portfolio_id
            )
          `)
          .eq('user_id', userId)
          .order('date');

        if (txError) throw txError;

        // Fetch accounts for cash calculation
        const { data: accountsData, error: accountsError } = await supabase
          .from('accounts')
          .select('id, name')
          .eq('user_id', userId);

        if (accountsError) throw accountsError;

        // Compute cash balances
        const cashBalances = new Map<string, number>()
        transactionsData.forEach((tx: any) => {
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
                delta -= (Math.abs(amt) + fee)  // deduct purchase amount and fee from cash balance
              }
              break
            case 'Sell':
              delta += (amt - fee)  // increase cash balance by sale amount less fees
              break
            case 'Dividend':
              delta += amt  // increase cash balance
              break
            case 'Interest':
              delta += amt  // increase cash balance
              break
            case 'Deposit':
              delta += amt  // increase cash balance
              break
            case 'Withdrawal':
              delta -= Math.abs(amt)  // decrease cash balance
              break
          }
          const newBalance = current + delta
          cashBalances.set(tx.account_id, newBalance)
        })
        const totalCash = Array.from(cashBalances.values()).reduce((sum, bal) => sum + bal, 0)

        // Map cash by account name
        const cashByAccountName = new Map<string, number>()
        const accountIdToName = new Map<string, string>()
        accountsData.forEach(account => {
          const balance = cashBalances.get(account.id) || 0
          cashByAccountName.set(account.name.trim(), balance)
          accountIdToName.set(account.id, account.name.trim())
        })

        // Calculate total original investment (sum of all cost bases from all lots)
        const totalOriginalInvestment = allLotsData?.reduce((sum, lot) => {
          return sum + (Number(lot.cost_basis_per_unit) * Number(lot.quantity || lot.remaining_quantity));
        }, 0) || 0;

        // Get possible groupings based on lens
        const possibleGroupings = new Map<string, { displayName: string }>();
        allLotsData?.forEach((lot: any) => {
          const asset = Array.isArray(lot.asset) ? lot.asset[0] : lot.asset;
          let groupId: string | null = null;
          let displayName = '';
          switch (lens) {
            case 'asset':
              groupId = lot.asset_id;
              displayName = asset ? `${asset.ticker}${asset.name ? ` - ${asset.name}` : ''}` : lot.asset_id;
              break;
            case 'account':
              groupId = lot.account_id;
              displayName = lot.account_id;
              break;
            case 'sub_portfolio':
              groupId = asset?.sub_portfolio_id || null;
              displayName = groupId || '(no sub-portfolio)';
              break;
            case 'asset_type':
              groupId = asset?.asset_type || null;
              displayName = groupId || '(no type)';
              break;
            case 'asset_subtype':
              groupId = asset?.asset_subtype || null;
              displayName = groupId || '(no subtype)';
              break;
            case 'geography':
              groupId = asset?.geography || null;
              displayName = groupId || '(no geography)';
              break;
            case 'size_tag':
              groupId = asset?.size_tag || null;
              displayName = groupId || '(no size)';
              break;
            case 'factor_tag':
              groupId = asset?.factor_tag || null;
              displayName = groupId || '(no factor)';
              break;
          }
          if (groupId && !possibleGroupings.has(groupId)) {
            possibleGroupings.set(groupId, { displayName });
          }
        });

        // Group transactions by the same grouping logic
        const transactionsByGroup = new Map<string, any[]>();
        (transactionsData || []).forEach((tx: any) => {
          const asset = Array.isArray(tx.asset) ? tx.asset[0] : tx.asset;
          let groupId: string | null = null;
          switch (lens) {
            case 'asset':
              groupId = tx.asset_id;
              break;
            case 'account':
              groupId = tx.account_id;
              break;
            case 'sub_portfolio':
              groupId = asset?.sub_portfolio_id || null;
              break;
            case 'asset_type':
              groupId = asset?.asset_type || null;
              break;
            case 'asset_subtype':
              groupId = asset?.asset_subtype || null;
              break;
            case 'geography':
              groupId = asset?.geography || null;
              break;
            case 'size_tag':
              groupId = asset?.size_tag || null;
              break;
            case 'factor_tag':
              groupId = asset?.factor_tag || null;
              break;
          }
          if (groupId) {
            if (!transactionsByGroup.has(groupId)) {
              transactionsByGroup.set(groupId, []);
            }
            transactionsByGroup.get(groupId)!.push(tx);
          }
        });

        // For account and sub_portfolio, fetch names
        if (lens === 'account') {
          const accountIds = Array.from(possibleGroupings.keys());
          if (accountIds.length > 0) {
            const { data: accounts } = await supabase
              .from('accounts')
              .select('id, name')
              .in('id', accountIds);
            accounts?.forEach(acc => {
              if (possibleGroupings.has(acc.id)) {
                possibleGroupings.get(acc.id)!.displayName = acc.name;
              }
            });
          }
        } else if (lens === 'sub_portfolio') {
          const subIds = Array.from(possibleGroupings.keys());
          if (subIds.length > 0) {
            const { data: subs } = await supabase
              .from('sub_portfolios')
              .select('id, name')
              .in('id', subIds);
            subs?.forEach(sub => {
              if (possibleGroupings.has(sub.id)) {
                possibleGroupings.get(sub.id)!.displayName = sub.name;
              }
            });
          }
        }

        // Fetch performance summaries for each grouping
        const summaryPromises = Array.from(possibleGroupings.entries()).map(async ([groupId, group]) => {
          const { data: summary } = await supabase
            .from('performance_summaries')
            .select('realized_gain, dividends, interest, fees')
            .eq('user_id', userId)
            .eq('grouping_type', lens)
            .eq('grouping_id', groupId)
            .single();
          return {
            grouping_id: groupId,
            display_name: group.displayName,
            summary: summary || { realized_gain: 0, dividends: 0, interest: 0, fees: 0 }
          };
        });
        const groupingsWithSummary = await Promise.all(summaryPromises);

        // Get open lots for metrics
        const openLotsData = allLotsData.filter(lot => lot.remaining_quantity > 0);

        // Get unique tickers and latest prices
        const tickers = [
          ...new Set(
            openLotsData
              .map((lot: any) => {
                const asset = Array.isArray(lot.asset) ? lot.asset[0] : lot.asset;
                return asset?.ticker;
              })
              .filter(Boolean)
          ),
        ];

        const { data: pricesData } = await supabase
          .from('asset_prices')
          .select('ticker, price, timestamp')
          .in('ticker', tickers)
          .order('timestamp', { ascending: false });

        // Fixed: Build latestPrices
        const latestPrices = new Map<string, number>();
        pricesData?.forEach((p: any) => {
          if (!latestPrices.has(p.ticker)) {
            latestPrices.set(p.ticker, Number(p.price));
          }
        });

        // Aggregate metrics by group from open lots
        const metricsMap = new Map<string, { unrealized: number; marketValue: number; currentPrice?: number }>();
        openLotsData.forEach((lot: any) => {
          const asset = Array.isArray(lot.asset) ? lot.asset[0] : lot.asset;
          const qty = Number(lot.remaining_quantity);
          const basis = Number(lot.cost_basis_per_unit);
          const price = latestPrices.get(asset?.ticker || '') || 1;
          const unrealThis = qty * (price - basis);
          const marketThis = qty * price;
          let groupId: string | null = null;
          switch (lens) {
            case 'asset': groupId = lot.asset_id; break;
            case 'account': groupId = lot.account_id; break;
            case 'sub_portfolio': groupId = asset?.sub_portfolio_id || null; break;
            case 'asset_type': groupId = asset?.asset_type || null; break;
            case 'asset_subtype': groupId = asset?.asset_subtype || null; break;
            case 'geography': groupId = asset?.geography || null; break;
            case 'size_tag': groupId = asset?.size_tag || null; break;
            case 'factor_tag': groupId = asset?.factor_tag || null; break;
          }
          if (!groupId) return;
          const current = metricsMap.get(groupId) || { unrealized: 0, marketValue: 0 };
          current.unrealized += unrealThis;
          current.marketValue += marketThis;
          // For asset lens only
          if (lens === 'asset' && !current.currentPrice) {
            current.currentPrice = price;
          }
          metricsMap.set(groupId, current);
        });

        // Calculate total cost basis by group from all lots
        const costBasisByGroup = new Map<string, number>();
        allLotsData.forEach((lot: any) => {
          const asset = Array.isArray(lot.asset) ? lot.asset[0] : lot.asset;
          const cost = Number(lot.cost_basis_per_unit) * Number(lot.quantity || lot.remaining_quantity);
          let groupId: string | null = null;
          switch (lens) {
            case 'asset': groupId = lot.asset_id; break;
            case 'account': groupId = lot.account_id; break;
            case 'sub_portfolio': groupId = asset?.sub_portfolio_id || null; break;
            case 'asset_type': groupId = asset?.asset_type || null; break;
            case 'asset_subtype': groupId = asset?.asset_subtype || null; break;
            case 'geography': groupId = asset?.geography || null; break;
            case 'size_tag': groupId = asset?.size_tag || null; break;
            case 'factor_tag': groupId = asset?.factor_tag || null; break;
          }
          if (groupId) {
            costBasisByGroup.set(groupId, (costBasisByGroup.get(groupId) || 0) + cost);
          }
        });

        // Combine
        const enhanced = groupingsWithSummary.map((row) => {
          const metrics = metricsMap.get(row.grouping_id) || { unrealized: 0, marketValue: 0, currentPrice: undefined };
          const summary = row.summary;
          const net =
            metrics.unrealized +
            (summary.realized_gain || 0) +
            (summary.dividends || 0) +
            (summary.interest || 0);
          const totalCostBasis = costBasisByGroup.get(row.grouping_id) || 0;

          // Calculate annualized return using IRR
          let annualizedReturnPct = 0;
          let irrSkipped = false;
          const groupTxs = transactionsByGroup.get(row.grouping_id) || [];
          if (groupTxs.length > 0 || metrics.marketValue > 0) {
            const cashFlows: number[] = [];
            const flowDates: Date[] = [];

            // Add transaction cash flows
            groupTxs.forEach((tx: any) => {
              let flow = 0;
              if (tx.type === 'Buy') {
                flow = (tx.amount || 0) - (tx.fees || 0);
              } else if (tx.type === 'Deposit' && tx.notes !== "Auto-deposit for external buy") {
                flow = (tx.amount || 0) - (tx.fees || 0);
              } else if (tx.type === 'Sell' || tx.type === 'Dividend' || tx.type === 'Interest') {
                flow = (tx.amount || 0) - (tx.fees || 0);
              } else if (tx.type === 'Withdrawal') {
                flow = -(Math.abs(tx.amount || 0)) - (tx.fees || 0);
              }
              if (flow !== 0 && tx.date) {
                const date = new Date(tx.date);
                if (!isNaN(date.getTime())) {
                  cashFlows.push(flow);
                  flowDates.push(date);
                }
              }
            });

            // Add current market value as final cash flow
            const accountCash = lens === 'account' ? (cashByAccountName.get(accountIdToName.get(row.grouping_id) || '') || 0) : 0
            if (metrics.marketValue > 0 || accountCash > 0) {
              cashFlows.push(metrics.marketValue + accountCash);
              flowDates.push(new Date());
            }

            if (cashFlows.length < 2 || flowDates.some(d => isNaN(d.getTime()))) {
              annualizedReturnPct = 0;
              irrSkipped = true;
            } else {
              console.log(`Group ${row.grouping_id} cash flows:`, cashFlows, flowDates.map(d => d.toISOString()));
              const irr = calculateIRR(cashFlows, flowDates);
              annualizedReturnPct = isNaN(irr) ? 0 : irr * 100;
            }
          }

          return {
            ...row,
            ...summary,
            unrealized_gain: metrics.unrealized,
            market_value: metrics.marketValue,
            current_price: metrics.currentPrice,
            net_gain: net,
            total_cost_basis: totalCostBasis,
            weight: 0, // Will be calculated after all data is processed
            total_return_pct: totalCostBasis > 0 ? (net / totalCostBasis) * 100 : 0,
            annualized_return_pct: annualizedReturnPct,
            irrSkipped,
          };
        });

        // Calculate weight
        const totalPortfolioValue = enhanced.reduce((sum, row) => sum + row.market_value, 0);
        enhanced.forEach(row => {
          row.weight = totalPortfolioValue > 0 ? (row.market_value / totalPortfolioValue) * 100 : 0;
        });

        // Calculate total annualized return (personal money-weighted, external flows only)
        let totalAnnualizedReturnPct = 0;
        if (transactionsData && transactionsData.length > 0) {
          const allCashFlows: number[] = [];
          const allFlowDates: Date[] = [];

          transactionsData.forEach((tx: any) => {
            let flow = 0;

            // Only external new money going in
            if (tx.type === 'Buy' && tx.funding_source === 'external') {
              flow = (tx.amount || 0) - (tx.fees || 0);
            } else if (tx.type === 'Deposit' && tx.notes !== "Auto-deposit for external buy") {
              flow = (tx.amount || 0) - (tx.fees || 0);
            } 
            // Explicit money coming out
            else if (tx.type === 'Withdrawal') {
              flow = -(Math.abs(tx.amount || 0)) - (tx.fees || 0);
            }
            // IMPORTANT: Do NOT add Sell, Dividend, Interest here — they are internal unless withdrawn

            if (flow !== 0 && tx.date) {
              const date = new Date(tx.date);
              if (!isNaN(date.getTime())) {
                allCashFlows.push(flow);
                allFlowDates.push(date);
              }
            }
          });

          // Terminal value (what everything is worth today)
          if (totalPortfolioValue + totalCash > 0) {
            allCashFlows.push(totalPortfolioValue + totalCash);
            allFlowDates.push(new Date());
          }

          if (allCashFlows.length < 2 || allFlowDates.some(d => isNaN(d.getTime()))) {
            totalAnnualizedReturnPct = 0;
          } else {
            console.log(`Total portfolio EXTERNAL cash flows:`, allCashFlows, allFlowDates.map(d => d.toISOString()));
            const irr = calculateIRR(allCashFlows, allFlowDates);
            totalAnnualizedReturnPct = isNaN(irr) ? 0 : irr * 100;
          }
        }

        setSummaries(enhanced);
        setTotalOriginalInvestment(totalOriginalInvestment);
        setTotalAnnualizedReturnPct(totalAnnualizedReturnPct);

        setSummaries(enhanced);
        setTotalOriginalInvestment(totalOriginalInvestment);
      } catch (err) {
        console.error('Performance fetch error:', err);
      } finally {
        setLoading(false);
      }
    };

    fetchData();
  }, [lens, supabase, router, searchParams]);

  const totalNet = summaries.reduce((sum, r) => sum + r.net_gain, 0);
  const totalUnrealized = summaries.reduce((sum, r) => sum + r.unrealized_gain, 0);
  const totalCostBasis = summaries.reduce((sum, r) => sum + (r.market_value - r.unrealized_gain), 0);
  const totalReturnPct = totalOriginalInvestment > 0 ? (totalNet / totalOriginalInvestment) * 100 : 0;

  return (
    <TooltipProvider>
      <main className="p-4 md:p-8">
      {refreshMessage && (
        <div className="mb-4 p-2 bg-green-100 text-green-800 rounded">
          {refreshMessage}
        </div>
      )}
      <Card className="mb-8">
        <CardHeader>
          <CardTitle className="text-center text-4xl">Portfolio Performance Summary</CardTitle>
          <div className="grid grid-cols-1 md:grid-cols-4 items-center mt-6 gap-8">
            <div className="text-center">
              <CardTitle className="break-words">Total Portfolio Value</CardTitle>
              <p className="text-2xl font-bold text-black mt-2 break-words">
                {formatUSD(totals.market_value)}
              </p>
            </div>
            <div className="text-center">
              <CardTitle className="break-words">Net Gain/Loss</CardTitle>
              <p className={cn("text-2xl font-bold mt-2 break-words", totalNet >= 0 ? "text-green-600" : "text-red-600")}>
                {formatUSD(totalNet)} {totalNet >= 0 ? '▲' : '▼'}
              </p>
            </div>
            <div className="text-center space-y-2 text-lg">
              <div>
                <p className="text-sm text-muted-foreground break-words">Unrealized G/L</p>
                <p className={cn("font-bold break-words", totalUnrealized >= 0 ? "text-green-600" : "text-red-600")}>
                  {formatUSD(totalUnrealized)}
                </p>
              </div>
              <div>
                <p className="text-sm text-muted-foreground break-words">Realized G/L</p>
                <p className={cn("font-bold break-words", totals.realized_gain >= 0 ? "text-green-600" : "text-red-600")}>
                  {formatUSD(totals.realized_gain)}
                </p>
              </div>
              <div>
                <p className="text-sm text-muted-foreground break-words">Income</p>
                <p className={cn("font-bold break-words", totals.dividends >= 0 ? "text-green-600" : "text-red-600")}>
                  {formatUSD(totals.dividends)}
                </p>
              </div>
            </div>
            <div className="text-center space-y-2 text-lg">
              <div>
                <p className="text-sm text-muted-foreground break-words">Total Return %</p>
                <p className={cn("font-bold break-words", totalReturnPct >= 0 ? "text-green-600" : "text-red-600")}>
                  {totalReturnPct.toFixed(2)}%
                </p>
              </div>
              <div>
                <p className="text-sm text-muted-foreground break-words">Annualized IRR</p>
                <p className={cn("font-bold break-words", totalAnnualizedReturnPct >= 0 ? "text-green-600" : "text-red-600")}>
                  {totalAnnualizedReturnPct.toFixed(2)}%
                </p>
              </div>
            </div>
          </div>
        </CardHeader>
      </Card>
      <div className="flex flex-col sm:flex-row items-start sm:items-center gap-4 mb-8">
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium">View by:</span>
          <Select value={lens} onValueChange={setLens}>
            <SelectTrigger className="w-[180px]">
              <SelectValue placeholder="Select lens" />
            </SelectTrigger>
            <SelectContent>
              {LENSES.map((l) => (
                <SelectItem key={l.value} value={l.value}>
                  {l.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <Button
          onClick={handleRefreshPrices}
          disabled={refreshing || loading}
          size="sm"
        >
          {refreshing ? 'Refreshing...' : 'Refresh Prices'}
        </Button>
        {refreshMessage && (
          <span className={cn("text-sm", refreshMessage.includes('failed') ? "text-red-600" : "text-green-600")}>
            {refreshMessage}
          </span>
        )}
      </div>
      <div className="overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead 
                className="cursor-pointer hover:bg-muted/50 select-none w-48"
                onClick={() => handleSort('display_name')}
              >
                <div className="flex items-center">
                  {lens.replace('_', ' ').toUpperCase()}
                  {getSortIcon('display_name')}
                </div>
              </TableHead>
              {lens === 'asset' && (
                <TableHead 
                  className="text-right cursor-pointer hover:bg-muted/50 select-none"
                  onClick={() => handleSort('current_price')}
                >
                  <div className="flex items-center justify-end">
                    Current Price
                    {getSortIcon('current_price')}
                  </div>
                </TableHead>
              )}
              <TableHead 
                className="text-right cursor-pointer hover:bg-muted/50 select-none"
                onClick={() => handleSort('market_value')}
              >
                <div className="flex items-center justify-end">
                  Market Value
                  {getSortIcon('market_value')}
                </div>
              </TableHead>
              <TableHead 
                className="text-right cursor-pointer hover:bg-muted/50 select-none"
                onClick={() => handleSort('unrealized_gain')}
              >
                <div className="flex items-center justify-end">
                  <span className="break-words">Unrealized G/L</span>
                  {getSortIcon('unrealized_gain')}
                </div>
              </TableHead>
              <TableHead 
                className="text-right cursor-pointer hover:bg-muted/50 select-none"
                onClick={() => handleSort('realized_gain')}
              >
                <div className="flex items-center justify-end">
                  <span className="break-words">Realized G/L</span>
                  {getSortIcon('realized_gain')}
                </div>
              </TableHead>
              <TableHead 
                className="text-right cursor-pointer hover:bg-muted/50 select-none"
                onClick={() => handleSort('dividends')}
              >
                <div className="flex items-center justify-end">
                  Dividends
                  {getSortIcon('dividends')}
                </div>
              </TableHead>
              <TableHead 
                className="text-right cursor-pointer hover:bg-muted/50 select-none font-bold"
                onClick={() => handleSort('net_gain')}
              >
                <Tooltip>
                  <TooltipTrigger asChild>
                    <div className="flex items-center justify-end">
                      <span className="break-words">Net Gain/Loss</span>
                      {getSortIcon('net_gain')}
                    </div>
                  </TooltipTrigger>
                  <TooltipContent>
                    <p>Total net gain or loss including unrealized gains/losses, realized gains, and income (dividends/interest).</p>
                  </TooltipContent>
                </Tooltip>
              </TableHead>
              <TableHead 
                className="text-right cursor-pointer hover:bg-muted/50 select-none font-bold"
                onClick={() => handleSort('total_return_pct')}
              >
                <Tooltip>
                  <TooltipTrigger asChild>
                    <div className="flex items-center justify-end">
                      <span className="break-words">Total Return %</span>
                      {getSortIcon('total_return_pct')}
                    </div>
                  </TooltipTrigger>
                  <TooltipContent>
                    <p>Total return percentage based on net gain divided by total cost basis (simple return, not annualized).</p>
                  </TooltipContent>
                </Tooltip>
              </TableHead>
              <TableHead 
                className="text-right cursor-pointer hover:bg-muted/50 select-none font-bold"
                onClick={() => handleSort('annualized_return_pct')}
              >
                <Tooltip>
                  <TooltipTrigger asChild>
                    <div className="flex items-center justify-end">
                      <span className="break-words">Annualized IRR</span>
                      {getSortIcon('annualized_return_pct')}
                    </div>
                  </TooltipTrigger>
                  <TooltipContent>
                    <p>Annualized Internal Rate of Return (IRR) - considers timing and size of all cash flows for money-weighted performance.</p>
                  </TooltipContent>
                </Tooltip>
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {loading ? (
              <TableRow>
                <TableCell colSpan={lens === 'asset' ? 10 : 9} className="text-center py-8">
                  Loading...
                </TableCell>
              </TableRow>
            ) : sortedSummaries.length === 0 ? (
              <TableRow>
                <TableCell colSpan={lens === 'asset' ? 10 : 9} className="text-center py-8 text-muted-foreground">
                  No data yet for this lens. Add transactions to populate performance.
                </TableCell>
              </TableRow>
            ) : (
              <>
                {sortedSummaries.map((row) => (
                  <TableRow key={row.grouping_id} className={lens === 'asset' && row.market_value === 0 ? "opacity-50" : ""}>
                    <TableCell className="font-medium w-48">
                      {lens === 'asset' ? (
                        <div className="flex flex-col">
                          <span className="font-bold break-words">{row.display_name.split(' - ')[0]}</span>
                          {row.display_name.includes(' - ') && <span className="text-muted-foreground break-words">{row.display_name.split(' - ')[1]}</span>}
                        </div>
                      ) : <span className="break-words">{row.display_name}</span>}
                    </TableCell>
                    {lens === 'asset' && (
                      <TableCell className="text-right">
                        {row.current_price != null ? formatUSD(row.current_price) : '-'}
                      </TableCell>
                    )}
                    <TableCell className="text-right">{formatUSD(row.market_value)}</TableCell>
                    <TableCell
                      className={cn(
                        "text-right",
                        row.unrealized_gain > 0 ? "text-green-600" : row.unrealized_gain < 0 ? "text-red-600" : ""
                      )}
                    >
                      {formatUSD(row.unrealized_gain)}
                    </TableCell>
                    <TableCell
                      className={cn(
                        "text-right",
                        row.realized_gain > 0 ? "text-green-600" : row.realized_gain < 0 ? "text-red-600" : ""
                      )}
                    >
                      {formatUSD(row.realized_gain)}
                    </TableCell>
                    <TableCell className="text-right">{formatUSD(row.dividends)}</TableCell>
                    <TableCell
                      className={cn(
                        "text-right font-medium",
                        row.net_gain > 0 ? "text-green-600" : row.net_gain < 0 ? "text-red-600" : ""
                      )}
                    >
                      {formatUSD(row.net_gain)}
                    </TableCell>
                    <TableCell
                      className={cn(
                        "text-right font-medium",
                        row.total_return_pct > 0 ? "text-green-600" : row.total_return_pct < 0 ? "text-red-600" : ""
                      )}
                    >
                      {row.total_return_pct.toFixed(2)}%
                    </TableCell>
                    <TableCell
                      className={cn(
                        "text-right font-medium",
                        row.annualized_return_pct > 0 ? "text-green-600" : row.annualized_return_pct < 0 ? "text-red-600" : ""
                      )}
                    >
                      {row.irrSkipped ? (
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <span>N/A</span>
                          </TooltipTrigger>
                          <TooltipContent>
                            <p>Insufficient cash flows (e.g., single transaction) to calculate IRR.</p>
                          </TooltipContent>
                        </Tooltip>
                      ) : (
                        row.annualized_return_pct.toFixed(2) + "%"
                      )}
                    </TableCell>
                  </TableRow>
                ))}
                {/* Total row */}
                <TableRow className="border-t-2 font-semibold bg-muted/50">
                  <TableCell className="font-bold break-words">Total</TableCell>
                  <TableCell className="text-right font-bold">100.00%</TableCell>
                  {lens === 'asset' && <TableCell className="text-right">-</TableCell>}
                  <TableCell className="text-right font-bold">{formatUSD(totals.market_value)}</TableCell>
                  <TableCell 
                    className={cn(
                      "text-right font-bold",
                      totals.unrealized_gain > 0 ? "text-green-600" : totals.unrealized_gain < 0 ? "text-red-600" : ""
                    )}
                  >
                    {formatUSD(totals.unrealized_gain)}
                  </TableCell>
                  <TableCell className="text-right font-bold">{formatUSD(totals.realized_gain)}</TableCell>
                  <TableCell className="text-right font-bold">{formatUSD(totals.dividends)}</TableCell>
                  <TableCell 
                    className={cn(
                      "text-right font-bold",
                      totals.net_gain > 0 ? "text-green-600" : totals.net_gain < 0 ? "text-red-600" : ""
                    )}
                  >
                    {formatUSD(totals.net_gain)}
                  </TableCell>
                  <TableCell 
                    className={cn(
                      "text-right font-bold",
                      totalReturnPct > 0 ? "text-green-600" : totalReturnPct < 0 ? "text-red-600" : ""
                    )}
                  >
                    {totalReturnPct.toFixed(2)}%
                  </TableCell>
                  <TableCell 
                    className={cn(
                      "text-right font-bold",
                      totalAnnualizedReturnPct > 0 ? "text-green-600" : totalAnnualizedReturnPct < 0 ? "text-red-600" : ""
                    )}
                  >
                    {totalAnnualizedReturnPct.toFixed(2)}%
                  </TableCell>
                </TableRow>
              </>
            )}
          </TableBody>
        </Table>
      </div>
    </main>
    </TooltipProvider>
  );
}

export default PerformanceContent;