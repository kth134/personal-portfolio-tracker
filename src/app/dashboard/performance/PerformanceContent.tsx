'use client';

import { useState, useEffect, useMemo, useRef } from 'react';
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
import { calculateIRR, normalizeTransactionToFlow, calculateCashBalances, formatCashFlowsDebug, netCashFlowsByDate, transactionFlowForIRR, fetchAllUserTransactions } from '@/lib/finance';

// use centralized calculateIRR and normalizeTransactionToFlow from src/lib/finance

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

const formatUSDWhole = (value: number | null | undefined) => {
  const num = Math.round(Number(value) || 0)
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(num)
}

const formatPctTenth = (value: number | null | undefined) => `${(Number(value) || 0).toFixed(1)}%`

function PerformanceContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const supabase = useMemo(() => createClient(), []);

  const initialLens = searchParams.get('lens') || 'asset';
  const [lens, setLens] = useState(initialLens);
  const [summaries, setSummaries] = useState<any[]>([]);
  const [totalOriginalInvestment, setTotalOriginalInvestment] = useState<number>(0);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [refreshMessage, setRefreshMessage] = useState<string | null>(null);
  const [totalAnnualizedReturnPct, setTotalAnnualizedReturnPct] = useState<number>(0);
  const [refreshCounter, setRefreshCounter] = useState(0);
  const requestIdRef = useRef(0);

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
      // Trigger an explicit refetch without mutating `lens`
      setRefreshCounter((c) => c + 1);
    } catch (err) {
      setRefreshMessage('Refresh failed – check console');
      console.error(err);
    } finally {
      setRefreshing(false);
    }
  };

  useEffect(() => {
    const fetchData = async () => {
      const currentRequestId = ++requestIdRef.current;
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

        // Fetch all transactions for IRR calculation using centralized pagination
        const transactionsData = await fetchAllUserTransactions();

        // fetched transactions for IRR calculations

        // Fetch accounts for cash calculation
        const { data: accountsData, error: accountsError } = await supabase
          .from('accounts')
          .select('id, name')
          .eq('user_id', userId);

        if (accountsError) throw accountsError;

        // Compute cash balances using centralized helper (portfolio canonical logic)
        const { balances: cashBalances, totalCash } = calculateCashBalances(transactionsData || []);

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

        // Compute performance summaries for each grouping from transactions
        const groupingsWithSummary = Array.from(possibleGroupings.entries()).map(([groupId, group]) => {
          const groupTxs = transactionsByGroup.get(groupId) || [];
          const summary = groupTxs.reduce(
            (acc, tx: any) => {
              if (tx.type === 'Sell' && tx.realized_gain != null) {
                acc.realized_gain += tx.realized_gain;
              } else if (tx.type === 'Dividend') {
                acc.dividends += (tx.amount || 0) - Math.abs(tx.fees || 0);
              } else if (tx.type === 'Interest') {
                acc.interest += (tx.amount || 0) - Math.abs(tx.fees || 0);
              } else if (tx.fees && (tx.type === 'Buy' || tx.type === 'Sell' || tx.type === 'Dividend' || tx.type === 'Interest')) {
                acc.fees += Math.abs(tx.fees);
              }
              return acc;
            },
            { realized_gain: 0, dividends: 0, interest: 0, fees: 0 }
          );
          return {
            grouping_id: groupId,
            display_name: group.displayName,
            summary
          };
        });

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
        const metricsMap = new Map<string, { unrealized: number; marketValue: number; quantity: number; currentPrice?: number }>();
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
          const current = metricsMap.get(groupId) || { unrealized: 0, marketValue: 0, quantity: 0 };
          current.unrealized += unrealThis;
          current.marketValue += marketThis;
          current.quantity += qty;
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
          const metrics = metricsMap.get(row.grouping_id) || { unrealized: 0, marketValue: 0, quantity: 0, currentPrice: undefined };
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
          // raw group transactions used for IRR
          if (groupTxs.length > 0 || metrics.marketValue > 0) {
            const cashFlows: number[] = [];
            const flowDates: Date[] = [];

            // Add transaction cash flows using canonical normalization
            const txFlows: number[] = [];
            const txDates: Date[] = [];
            groupTxs.forEach((tx: any) => {
              // Exclude Buy/Sell for account-level IRR; include for other lenses
              const externalTypes = ['Deposit', 'Withdrawal', 'Dividend', 'Interest'];
              const type = tx.type;
              if (type === 'Buy' || type === 'Sell') {
                if (lens === 'account') return; // do not include trades for account lens
              } else {
                if (!externalTypes.includes(type)) return;
              }
              const date = new Date(tx.date);
              if (isNaN(date.getTime())) return;
              txFlows.push(transactionFlowForIRR(tx));
              txDates.push(date);
            });

            // Net same-day flows before appending terminal value
            const { netFlows, netDates } = netCashFlowsByDate(txFlows, txDates);

            // Add current market value as final cash flow
            const accountCash = lens === 'account' ? (cashByAccountName.get(accountIdToName.get(row.grouping_id) || '') || 0) : 0;
            if (metrics.marketValue > 0 || accountCash > 0) {
              netFlows.push(metrics.marketValue + accountCash);
              netDates.push(new Date());
            }

            if (netFlows.length < 2 || netDates.some(d => isNaN(d.getTime()))) {
              annualizedReturnPct = 0;
              irrSkipped = true;
            } else {
              try {
                const debugFlows = netDates.map((d, i) => ({ date: netDates[i].toISOString(), flow: netFlows[i] }));
                console.debug(`Group ${row.grouping_id} cash flows:`, debugFlows);
              } catch (e) {
                console.debug(`Group ${row.grouping_id} cash flows:`, netFlows, netDates.map(d => d.toISOString()));
              }
              const irr = calculateIRR(netFlows, netDates);
              annualizedReturnPct = isNaN(irr) ? 0 : irr * 100;
              try {
                console.debug(`Group ${row.grouping_id} IRR:`, isNaN(irr) ? 'NaN' : irr, 'annualized_pct:', annualizedReturnPct);
              } catch (e) {
                /* swallow */
              }
            }
          }

          return {
            ...row,
            ...summary,
            unrealized_gain: metrics.unrealized,
            market_value: metrics.marketValue,
            quantity: metrics.quantity,
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
          const txFlows: number[] = [];
          const txDates: Date[] = [];
          const externalTypes = ['Deposit', 'Withdrawal', 'Dividend', 'Interest'];

          transactionsData.forEach((tx: any) => {
            if (!externalTypes.includes(tx.type)) return; // total IRR considers external flows only
            const date = new Date(tx.date);
            if (isNaN(date.getTime())) return;
            txFlows.push(transactionFlowForIRR(tx));
            txDates.push(date);
          });

          // Net same-day flows
          const { netFlows, netDates } = netCashFlowsByDate(txFlows, txDates);

          // Terminal value (what everything is worth today)
          if (totalPortfolioValue + totalCash > 0) {
            netFlows.push(totalPortfolioValue + totalCash);
            netDates.push(new Date());
          }

          if (netFlows.length < 2 || netDates.some(d => isNaN(d.getTime()))) {
            totalAnnualizedReturnPct = 0;
          } else {
            try {
              const debugAll = netDates.map((d, i) => ({ date: netDates[i].toISOString(), flow: netFlows[i] }));
              console.debug('Total portfolio EXTERNAL cash flows:', debugAll);
            } catch (e) {
              console.debug('Total portfolio EXTERNAL cash flows:', netFlows, netDates.map(d => d.toISOString()));
            }
            const irr = calculateIRR(netFlows, netDates);
            totalAnnualizedReturnPct = isNaN(irr) ? 0 : irr * 100;
          }
        }

        if (currentRequestId !== requestIdRef.current) return; // stale response guard

        setSummaries(enhanced);
        setTotalOriginalInvestment(totalOriginalInvestment);
        setTotalAnnualizedReturnPct(totalAnnualizedReturnPct);
      } catch (err) {
        console.error('Performance fetch error:', err);
      } finally {
        setLoading(false);
      }
    };

    fetchData();
  }, [lens, supabase, router, searchParams, refreshCounter]);

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
                {formatUSDWhole(totals.market_value)}
              </p>
            </div>
            <div className="text-center">
              <CardTitle className="break-words">Net Gain/Loss</CardTitle>
              <p className={cn("text-2xl font-bold mt-2 break-words", totalNet >= 0 ? "text-green-600" : "text-red-600")}>
                {formatUSDWhole(totalNet)} {totalNet >= 0 ? '▲' : '▼'}
              </p>
            </div>
            <div className="text-center space-y-2 text-lg">
              <div>
                <p className="text-sm text-muted-foreground break-words">Unrealized G/L</p>
                <p className={cn("font-bold break-words", totalUnrealized >= 0 ? "text-green-600" : "text-red-600")}>
                  {formatUSDWhole(totalUnrealized)}
                </p>
              </div>
              <div>
                <p className="text-sm text-muted-foreground break-words">Realized G/L</p>
                <p className={cn("font-bold break-words", totals.realized_gain >= 0 ? "text-green-600" : "text-red-600")}>
                  {formatUSDWhole(totals.realized_gain)}
                </p>
              </div>
              <div>
                <p className="text-sm text-muted-foreground break-words">Income</p>
                <p className={cn("font-bold break-words", totals.dividends >= 0 ? "text-green-600" : "text-red-600")}>
                  {formatUSDWhole(totals.dividends)}
                </p>
              </div>
            </div>
            <div className="text-center space-y-2 text-lg">
              <div>
                <p className="text-sm text-muted-foreground break-words">Total Return %</p>
                <p className={cn("font-bold break-words", totalReturnPct >= 0 ? "text-green-600" : "text-red-600")}>
                  {formatPctTenth(totalReturnPct)}
                </p>
              </div>
              <div>
                <p className="text-sm text-muted-foreground break-words">Annualized IRR</p>
                <p className={cn("font-bold break-words", totalAnnualizedReturnPct >= 0 ? "text-green-600" : "text-red-600")}>
                  {formatPctTenth(totalAnnualizedReturnPct)}
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
      <div className="overflow-x-auto overscroll-x-contain [-webkit-overflow-scrolling:touch]">
        <Table className="w-full min-w-[1080px] table-fixed">
          {lens === 'asset' ? (
            <colgroup>
              <col className="w-[22%]" />
              <col className="w-[10%]" />
              <col className="w-[10%]" />
              <col className="w-[11%]" />
              <col className="w-[11%]" />
              <col className="w-[10%]" />
              <col className="w-[10%]" />
              <col className="w-[10%]" />
              <col className="w-[8%]" />
              <col className="w-[8%]" />
            </colgroup>
          ) : (
            <colgroup>
              <col className="w-[26%]" />
              <col className="w-[12%]" />
              <col className="w-[12%]" />
              <col className="w-[12%]" />
              <col className="w-[10%]" />
              <col className="w-[10%]" />
              <col className="w-[9%]" />
              <col className="w-[9%]" />
            </colgroup>
          )}
          <TableHeader>
            <TableRow>
              <TableHead 
                className="cursor-pointer hover:bg-muted/50 select-none px-3 sm:px-4"
                onClick={() => handleSort('display_name')}
              >
                <div className="flex items-center">
                  <span className="truncate">{lens.replace('_', ' ').toUpperCase()}</span>
                  {getSortIcon('display_name')}
                </div>
              </TableHead>
              {lens === 'asset' && (
                <TableHead 
                  className="text-right cursor-pointer hover:bg-muted/50 select-none px-3 sm:px-4"
                  onClick={() => handleSort('quantity')}
                >
                  <div className="flex items-center justify-end whitespace-nowrap">
                    Quantity
                    {getSortIcon('quantity')}
                  </div>
                </TableHead>
              )}
              {lens === 'asset' && (
                <TableHead 
                  className="text-right cursor-pointer hover:bg-muted/50 select-none px-3 sm:px-4"
                  onClick={() => handleSort('current_price')}
                >
                  <div className="flex items-center justify-end whitespace-nowrap">
                    Current Price
                    {getSortIcon('current_price')}
                  </div>
                </TableHead>
              )}
              <TableHead 
                className="text-right cursor-pointer hover:bg-muted/50 select-none px-3 sm:px-4"
                onClick={() => handleSort('market_value')}
              >
                <div className="flex items-center justify-end whitespace-nowrap">
                  Market Value
                  {getSortIcon('market_value')}
                </div>
              </TableHead>
              <TableHead 
                className="text-right cursor-pointer hover:bg-muted/50 select-none px-3 sm:px-4"
                onClick={() => handleSort('unrealized_gain')}
              >
                <div className="flex items-center justify-end whitespace-nowrap">
                  <span>Unrealized G/L</span>
                  {getSortIcon('unrealized_gain')}
                </div>
              </TableHead>
              <TableHead 
                className="text-right cursor-pointer hover:bg-muted/50 select-none px-3 sm:px-4"
                onClick={() => handleSort('realized_gain')}
              >
                <div className="flex items-center justify-end whitespace-nowrap">
                  <span>Realized G/L</span>
                  {getSortIcon('realized_gain')}
                </div>
              </TableHead>
              <TableHead 
                className="text-right cursor-pointer hover:bg-muted/50 select-none px-3 sm:px-4"
                onClick={() => handleSort('dividends')}
              >
                <div className="flex items-center justify-end whitespace-nowrap">
                  Dividends
                  {getSortIcon('dividends')}
                </div>
              </TableHead>
              <TableHead 
                className="text-right cursor-pointer hover:bg-muted/50 select-none font-bold px-3 sm:px-4"
                onClick={() => handleSort('net_gain')}
              >
                <Tooltip>
                  <TooltipTrigger asChild>
                    <div className="flex items-center justify-end whitespace-nowrap">
                      <span>Net Gain/Loss</span>
                      {getSortIcon('net_gain')}
                    </div>
                  </TooltipTrigger>
                  <TooltipContent>
                    <p>Total net gain or loss including unrealized gains/losses, realized gains, and income (dividends/interest).</p>
                  </TooltipContent>
                </Tooltip>
              </TableHead>
              <TableHead 
                className="text-right cursor-pointer hover:bg-muted/50 select-none font-bold px-3 sm:px-4"
                onClick={() => handleSort('total_return_pct')}
              >
                <Tooltip>
                  <TooltipTrigger asChild>
                    <div className="flex items-center justify-end whitespace-nowrap">
                      <span>Total Return %</span>
                      {getSortIcon('total_return_pct')}
                    </div>
                  </TooltipTrigger>
                  <TooltipContent>
                    <p>Total return percentage based on net gain divided by total cost basis (simple return, not annualized).</p>
                  </TooltipContent>
                </Tooltip>
              </TableHead>
              <TableHead 
                className="text-right cursor-pointer hover:bg-muted/50 select-none font-bold px-3 sm:px-4"
                onClick={() => handleSort('annualized_return_pct')}
              >
                <Tooltip>
                  <TooltipTrigger asChild>
                    <div className="flex items-center justify-end whitespace-nowrap">
                      <span>Annualized IRR</span>
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
                <TableCell colSpan={lens === 'asset' ? 10 : 8} className="text-center py-8">
                  Loading...
                </TableCell>
              </TableRow>
            ) : sortedSummaries.length === 0 ? (
              <TableRow>
                <TableCell colSpan={lens === 'asset' ? 10 : 8} className="text-center py-8 text-muted-foreground">
                  No data yet for this lens. Add transactions to populate performance.
                </TableCell>
              </TableRow>
            ) : (
              <>
                {sortedSummaries.map((row) => (
                  <TableRow key={row.grouping_id} className={lens === 'asset' && row.market_value === 0 ? "opacity-50" : ""}>
                    <TableCell className="font-medium px-3 sm:px-4 align-top">
                      {lens === 'asset' ? (
                        <div className="flex flex-col">
                          <span className="font-bold truncate">{row.display_name.split(' - ')[0]}</span>
                          {row.display_name.includes(' - ') && <span className="text-muted-foreground truncate">{row.display_name.split(' - ')[1]}</span>}
                        </div>
                      ) : <span className="truncate block">{row.display_name}</span>}
                    </TableCell>
                    {lens === 'asset' && (
                      <TableCell className="px-3 sm:px-4 text-right tabular-nums whitespace-nowrap">{Number(row.quantity || 0).toLocaleString(undefined, { maximumFractionDigits: 6 })}</TableCell>
                    )}
                    {lens === 'asset' && (
                      <TableCell className="px-3 sm:px-4 text-right tabular-nums whitespace-nowrap">
                        {row.current_price != null ? formatUSD(row.current_price) : '-'}
                      </TableCell>
                    )}
                    <TableCell className="px-3 sm:px-4 text-right tabular-nums whitespace-nowrap">{formatUSD(row.market_value)}</TableCell>
                    <TableCell
                      className={cn(
                        "px-3 sm:px-4 text-right tabular-nums whitespace-nowrap",
                        row.unrealized_gain > 0 ? "text-green-600" : row.unrealized_gain < 0 ? "text-red-600" : ""
                      )}
                    >
                      {formatUSD(row.unrealized_gain)}
                    </TableCell>
                    <TableCell
                      className={cn(
                        "px-3 sm:px-4 text-right tabular-nums whitespace-nowrap",
                        row.realized_gain > 0 ? "text-green-600" : row.realized_gain < 0 ? "text-red-600" : ""
                      )}
                    >
                      {formatUSD(row.realized_gain)}
                    </TableCell>
                    <TableCell className="px-3 sm:px-4 text-right tabular-nums whitespace-nowrap">{formatUSD(row.dividends)}</TableCell>
                    <TableCell
                      className={cn(
                        "px-3 sm:px-4 text-right font-medium tabular-nums whitespace-nowrap",
                        row.net_gain > 0 ? "text-green-600" : row.net_gain < 0 ? "text-red-600" : ""
                      )}
                    >
                      {formatUSD(row.net_gain)}
                    </TableCell>
                    <TableCell
                      className={cn(
                        "px-3 sm:px-4 text-right font-medium tabular-nums whitespace-nowrap",
                        row.total_return_pct > 0 ? "text-green-600" : row.total_return_pct < 0 ? "text-red-600" : ""
                      )}
                    >
                      {row.total_return_pct.toFixed(2)}%
                    </TableCell>
                    <TableCell
                      className={cn(
                        "px-3 sm:px-4 text-right font-medium tabular-nums whitespace-nowrap",
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
                  <TableCell className="px-3 sm:px-4 font-bold">Total</TableCell>
                  {lens === 'asset' && <TableCell className="px-3 sm:px-4 text-right">-</TableCell>}
                  {lens === 'asset' && <TableCell className="px-3 sm:px-4 text-right">-</TableCell>}
                  <TableCell className="px-3 sm:px-4 text-right font-bold tabular-nums whitespace-nowrap">{formatUSD(totals.market_value)}</TableCell>
                  <TableCell 
                    className={cn(
                      "px-3 sm:px-4 text-right font-bold tabular-nums whitespace-nowrap",
                      totals.unrealized_gain > 0 ? "text-green-600" : totals.unrealized_gain < 0 ? "text-red-600" : ""
                    )}
                  >
                    {formatUSD(totals.unrealized_gain)}
                  </TableCell>
                  <TableCell className="px-3 sm:px-4 text-right font-bold tabular-nums whitespace-nowrap">{formatUSD(totals.realized_gain)}</TableCell>
                  <TableCell className="px-3 sm:px-4 text-right font-bold tabular-nums whitespace-nowrap">{formatUSD(totals.dividends)}</TableCell>
                  <TableCell 
                    className={cn(
                      "px-3 sm:px-4 text-right font-bold tabular-nums whitespace-nowrap",
                      totals.net_gain > 0 ? "text-green-600" : totals.net_gain < 0 ? "text-red-600" : ""
                    )}
                  >
                    {formatUSD(totals.net_gain)}
                  </TableCell>
                  <TableCell 
                    className={cn(
                      "px-3 sm:px-4 text-right font-bold tabular-nums whitespace-nowrap",
                      totalReturnPct > 0 ? "text-green-600" : totalReturnPct < 0 ? "text-red-600" : ""
                    )}
                  >
                    {totalReturnPct.toFixed(2)}%
                  </TableCell>
                  <TableCell 
                    className={cn(
                      "px-3 sm:px-4 text-right font-bold tabular-nums whitespace-nowrap",
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