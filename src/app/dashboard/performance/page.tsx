'use client';

import { useState, useEffect } from 'react';
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
import { formatUSD } from '@/lib/formatters';
import { cn } from '@/lib/utils';

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

export default function PerformancePage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const supabase = createClient();

  const initialLens = searchParams.get('lens') || 'asset';
  const [lens, setLens] = useState(initialLens);
  const [summaries, setSummaries] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchData = async () => {
      setLoading(true);
      try {
        // Update URL
        const newParams = new URLSearchParams(searchParams.toString());
        newParams.set('lens', lens);
        router.replace(`/dashboard/performance?${newParams.toString()}`, { scroll: false });

        const userId = (await supabase.auth.getUser()).data.user?.id;

        // Step 1: Fetch stored summaries (realized, dividends, etc.)
        let summaryQuery = supabase
          .from('performance_summaries')
          .select(`
            grouping_id,
            realized_gain,
            dividends,
            interest,
            fees
          `)
          .eq('user_id', userId)
          .eq('grouping_type', lens);

        const { data: summaryData, error: summaryError } = await summaryQuery;
        if (summaryError) throw summaryError;

        // Step 2: Fetch unrealized gains aggregated by the lens
        let unrealizedMap = new Map<string, number>();

        // Base query for unrealized: sum (remaining_qty * (current_price - cost_basis_per_unit))
        let unrealizedQuery = supabase
          .from('tax_lots')
          .select(`
            asset_id,
            account_id,
            remaining_quantity,
            cost_basis_per_unit,
            asset:assets (
              ticker,
              sub_portfolio_id,
              asset_type,
              asset_subtype,
              geography,
              size_tag,
              factor_tag
            )
          `)
          .gt('remaining_quantity', 0)
          .eq('user_id', userId);

        const { data: lotsData, error: lotsError } = await unrealizedQuery;
        if (lotsError) throw lotsError;

        // Fetch all latest prices
        const tickers = [...new Set(lotsData.map((lot: any) => lot.asset.ticker))];
        const { data: pricesData } = await supabase
          .from('asset_prices')
          .select('ticker, price')
          .in('ticker', tickers)
          .order('timestamp', { ascending: false });

        const latestPrices = new Map((pricesData || []).map((p: any) => [p.ticker, p.price]));

        // Aggregate unrealized by lens
        lotsData.forEach((lot: any) => {
          const qty = Number(lot.remaining_quantity);
          const basisPer = Number(lot.cost_basis_per_unit);
          const price = latestPrices.get(lot.asset.ticker) || 0;
          const unrealThis = qty * (price - basisPer);

          let groupId: string | null = null;
          switch (lens) {
            case 'asset':
              groupId = lot.asset_id;
              break;
            case 'account':
              groupId = lot.account_id;
              break;
            case 'sub_portfolio':
              groupId = lot.asset.sub_portfolio_id;
              break;
            case 'asset_type':
              groupId = lot.asset.asset_type;
              break;
            case 'asset_subtype':
              groupId = lot.asset.asset_subtype;
              break;
            case 'geography':
              groupId = lot.asset.geography;
              break;
            case 'size_tag':
              groupId = lot.asset.size_tag;
              break;
            case 'factor_tag':
              groupId = lot.asset.factor_tag;
              break;
          }

          if (groupId) {
            unrealizedMap.set(groupId, (unrealizedMap.get(groupId) || 0) + unrealThis);
          }
        });

        // Step 3: Combine summaries + unrealized + display names
        let enhanced = [];
        for (const row of summaryData) {
          const unrealized = unrealizedMap.get(row.grouping_id) || 0;
          const net = unrealized + (row.realized_gain || 0) + (row.dividends || 0) + (row.interest || 0) - (row.fees || 0);

          // Fetch display name (human-readable)
          let displayName = row.grouping_id;
          if (lens === 'asset') {
            const { data: asset } = await supabase.from('assets').select('ticker, name').eq('id', row.grouping_id).single();
            displayName = asset ? `${asset.ticker}${asset.name ? ` - ${asset.name}` : ''}` : row.grouping_id;
          } else if (lens === 'account') {
            const { data: account } = await supabase.from('accounts').select('name').eq('id', row.grouping_id).single();
            displayName = account?.name || row.grouping_id;
          } else if (lens === 'sub_portfolio') {
            const { data: sub } = await supabase.from('sub_portfolios').select('name').eq('id', row.grouping_id).single();
            displayName = sub?.name || row.grouping_id;
          } else {
            // Tags: use the tag value directly as name
            displayName = row.grouping_id;
          }

          enhanced.push({
            ...row,
            unrealized_gain: unrealized,
            net_gain: net,
            display_name: displayName,
          });
        }

        setSummaries(enhanced);
      } catch (err) {
        console.error('Performance fetch error:', err);
      } finally {
        setLoading(false);
      }
    };

    fetchData();
  }, [lens]);

  const totalNet = summaries.reduce((sum, r) => sum + r.net_gain, 0);
  const totalUnrealized = summaries.reduce((sum, r) => sum + r.unrealized_gain, 0);

  return (
    <main className="p-8">
      <div className="flex justify-between items-center mb-8">
        <h1 className="text-3xl font-bold">Performance Reports</h1>
        <div className="flex items-center gap-4">
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
      </div>

      <Card className="mb-8">
        <CardHeader>
          <CardTitle>Net Gain/Loss Summary</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            <div>
              <p className="text-sm text-muted-foreground">Net Gain/Loss</p>
              <p className={cn("text-2xl font-bold", totalNet >= 0 ? "text-green-600" : "text-red-600")}>
                {formatUSD(totalNet)} {totalNet >= 0 ? '▲' : '▼'}
              </p>
            </div>
            <div>
              <p className="text-sm text-muted-foreground">Unrealized Gain/Loss</p>
              <p className={cn("text-2xl font-bold", totalUnrealized >= 0 ? "text-green-600" : "text-red-600")}>
                {formatUSD(totalUnrealized)} {totalUnrealized >= 0 ? '▲' : '▼'}
              </p>
            </div>
            <div>
              <p className="text-sm text-muted-foreground">Realized + Income - Fees</p>
              <p className="text-2xl font-bold">
                {formatUSD(totalNet - totalUnrealized)}
              </p>
            </div>
          </div>
        </CardContent>
      </Card>

      <div className="overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{lens.replace('_', ' ').toUpperCase()}</TableHead>
              <TableHead className="text-right">Unrealized G/L</TableHead>
              <TableHead className="text-right">Realized Gain</TableHead>
              <TableHead className="text-right">Dividends</TableHead>
              <TableHead className="text-right">Interest</TableHead>
              <TableHead className="text-right">Fees</TableHead>
              <TableHead className="text-right font-bold">Net Gain/Loss</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {loading ? (
              <TableRow>
                <TableCell colSpan={7} className="text-center py-8">
                  Loading...
                </TableCell>
              </TableRow>
            ) : summaries.length === 0 ? (
              <TableRow>
                <TableCell colSpan={7} className="text-center py-8 text-muted-foreground">
                  No data yet for this lens. Add transactions to populate performance.
                </TableCell>
              </TableRow>
            ) : (
              summaries.map((row) => (
                <TableRow key={row.grouping_id}>
                  <TableCell className="font-medium">{row.display_name}</TableCell>
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
                  <TableCell className="text-right">{formatUSD(row.interest)}</TableCell>
                  <TableCell className="text-right">{formatUSD(-row.fees)}</TableCell>
                  <TableCell
                    className={cn(
                      "text-right font-medium",
                      row.net_gain > 0 ? "text-green-600" : row.net_gain < 0 ? "text-red-600" : ""
                    )}
                  >
                    {formatUSD(row.net_gain)}
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>
    </main>
  );
}