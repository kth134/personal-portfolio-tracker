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
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [refreshMessage, setRefreshMessage] = useState<string | null>(null);

  // Sorting state
  const [sortColumn, setSortColumn] = useState<string>('display_name');
  const [sortDirection, setSortDirection] = useState<'asc' | 'desc'>('asc');

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

        // 1. Fetch stored performance summaries (realized, income, fees)
        const { data: summaryData, error: summaryError } = await supabase
          .from('performance_summaries')
          .select('grouping_id, realized_gain, dividends, interest, fees')
          .eq('user_id', userId)
          .eq('grouping_type', lens);

        if (summaryError) throw summaryError;

        // 2. Fetch all open tax lots + joined asset data
        const { data: lotsData, error: lotsError } = await supabase
          .from('tax_lots')
          .select(`
            asset_id,
            account_id,
            remaining_quantity,
            cost_basis_per_unit,
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
          .gt('remaining_quantity', 0)
          .eq('user_id', userId);

        if (lotsError) throw lotsError;

        // 3. Get unique tickers and latest prices
        const tickers = [
          ...new Set(
            (lotsData || [])
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

        // Fixed: Build latestPrices by setting only if not set (first encounter is latest per ticker)
        const latestPrices = new Map<string, number>();
        pricesData?.forEach((p: any) => {
          if (!latestPrices.has(p.ticker)) {
            latestPrices.set(p.ticker, Number(p.price));
          }
        });

        // 4. Aggregate by lens: unrealized gain + current market value
        const metricsMap = new Map<string, { unrealized: number; marketValue: number; currentPrice?: number }>();

        lotsData?.forEach((lot: any) => {
          const asset = Array.isArray(lot.asset) ? lot.asset[0] : lot.asset;

          const qty   = Number(lot.remaining_quantity);
          const basis = Number(lot.cost_basis_per_unit);
          const price = latestPrices.get(asset?.ticker || '') || 0;

          const unrealThis   = qty * (price - basis);
          const marketThis   = qty * price;

          let groupId: string | null = null;

          switch (lens) {
            case 'asset':           groupId = lot.asset_id; break;
            case 'account':         groupId = lot.account_id; break;
            case 'sub_portfolio':   groupId = asset?.sub_portfolio_id || null; break;
            case 'asset_type':      groupId = asset?.asset_type || null; break;
            case 'asset_subtype':   groupId = asset?.asset_subtype || null; break;
            case 'geography':       groupId = asset?.geography || null; break;
            case 'size_tag':        groupId = asset?.size_tag || null; break;
            case 'factor_tag':      groupId = asset?.factor_tag || null; break;
          }

          if (!groupId) return;

          const current = metricsMap.get(groupId) || { unrealized: 0, marketValue: 0 };
          current.unrealized  += unrealThis;
          current.marketValue += marketThis;

          // For asset lens only → store current price (we take the first/last seen)
          if (lens === 'asset' && !current.currentPrice) {
            current.currentPrice = price;
          }

          metricsMap.set(groupId, current);
        });

        // 5. Combine with summaries + human-readable names
        const enhanced = await Promise.all(
          (summaryData || []).map(async (row: any) => {
            const metrics = metricsMap.get(row.grouping_id) || { unrealized: 0, marketValue: 0, currentPrice: undefined };

            const net =
              metrics.unrealized +
              (row.realized_gain || 0) +
              (row.dividends || 0) +
              (row.interest || 0);

            let displayName = row.grouping_id;

            if (lens === 'asset') {
              const { data: asset } = await supabase
                .from('assets')
                .select('ticker, name')
                .eq('id', row.grouping_id)
                .single();
              displayName = asset ? `${asset.ticker}${asset.name ? ` - ${asset.name}` : ''}` : row.grouping_id;
            } else if (lens === 'account') {
              const { data: acc } = await supabase
                .from('accounts')
                .select('name')
                .eq('id', row.grouping_id)
                .single();
              displayName = acc?.name || row.grouping_id;
            } else if (lens === 'sub_portfolio') {
              const { data: sub } = await supabase
                .from('sub_portfolios')
                .select('name')
                .eq('id', row.grouping_id)
                .single();
              displayName = sub?.name || row.grouping_id;
            } else {
              // tags → use as-is
              displayName = row.grouping_id || '(untagged)';
            }

            return {
              ...row,
              display_name: displayName,
              unrealized_gain: metrics.unrealized,
              market_value: metrics.marketValue,
              current_price: metrics.currentPrice,
              net_gain: net,
            };
          })
        );

        setSummaries(enhanced);
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

  return (
    <main className="p-8">
      <div className="mb-8">
        <h1 className="text-3xl font-bold">Performance Reports</h1>
      </div>
      <Card className="mb-8">
        <CardHeader>
          <CardTitle className="text-center">Portfolio Performance Summary</CardTitle>
          <div className="grid grid-cols-3 items-center mt-6">
            <div>
              <CardTitle>Total Portfolio Value</CardTitle>
              <p className="text-2xl font-bold text-black mt-2">
                {formatUSD(totals.market_value)}
              </p>
            </div>
            <div className="text-center">
              <CardTitle>Net Gain/Loss</CardTitle>
              <p className={cn("text-2xl font-bold mt-2", totalNet >= 0 ? "text-green-600" : "text-red-600")}>
                {formatUSD(totalNet)} {totalNet >= 0 ? '▲' : '▼'}
              </p>
            </div>
            <div className="text-right space-y-1 text-sm">
              <div className="text-center">
                <p className="text-xs text-muted-foreground">Unrealized G/L</p>
                <p className={cn("font-medium", totalUnrealized >= 0 ? "text-green-600" : "text-red-600")}>
                  {formatUSD(totalUnrealized)}
                </p>
              </div>
              <div className="text-center">
                <p className="text-xs text-muted-foreground">Realized G/L</p>
                <p className={cn("font-medium", totals.realized_gain >= 0 ? "text-green-600" : "text-red-600")}>
                  {formatUSD(totals.realized_gain)}
                </p>
              </div>
              <div className="text-center">
                <p className="text-xs text-muted-foreground">Income</p>
                <p className={cn("font-medium", totals.dividends >= 0 ? "text-green-600" : "text-red-600")}>
                  {formatUSD(totals.dividends)}
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
                className="cursor-pointer hover:bg-muted/50 select-none"
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
                  Unrealized G/L
                  {getSortIcon('unrealized_gain')}
                </div>
              </TableHead>
              <TableHead 
                className="text-right cursor-pointer hover:bg-muted/50 select-none"
                onClick={() => handleSort('realized_gain')}
              >
                <div className="flex items-center justify-end">
                  Realized Gain
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
                <div className="flex items-center justify-end">
                  Net Gain/Loss
                  {getSortIcon('net_gain')}
                </div>
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {loading ? (
              <TableRow>
                <TableCell colSpan={lens === 'asset' ? 7 : 6} className="text-center py-8">
                  Loading...
                </TableCell>
              </TableRow>
            ) : sortedSummaries.length === 0 ? (
              <TableRow>
                <TableCell colSpan={lens === 'asset' ? 7 : 6} className="text-center py-8 text-muted-foreground">
                  No data yet for this lens. Add transactions to populate performance.
                </TableCell>
              </TableRow>
            ) : (
              <>
                {sortedSummaries.map((row) => (
                  <TableRow key={row.grouping_id}>
                    <TableCell className="font-medium">{row.display_name}</TableCell>
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
                    <TableCell className="text-right">{formatUSD(row.realized_gain)}</TableCell>
                    <TableCell className="text-right">{formatUSD(row.dividends)}</TableCell>
                    <TableCell
                      className={cn(
                        "text-right font-medium",
                        row.net_gain > 0 ? "text-green-600" : row.net_gain < 0 ? "text-red-600" : ""
                      )}
                    >
                      {formatUSD(row.net_gain)}
                    </TableCell>
                  </TableRow>
                ))}
                {/* Total row */}
                <TableRow className="border-t-2 font-semibold bg-muted/50">
                  <TableCell className="font-bold">Total</TableCell>
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
                </TableRow>
              </>
            )}
          </TableBody>
        </Table>
      </div>
    </main>
  );
}

export default PerformanceContent;