import { createClient } from '@/lib/supabase/server';
import { redirect } from 'next/navigation';
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
import { formatUSD } from '@/lib/formatters';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { cn } from '@/lib/utils';

type SummaryRow = {
  grouping_type: string;
  grouping_id: string;
  realized_gain: number;
  dividends: number;
  interest: number;
  fees: number;
  // Joined fields depending on type
  name?: string;           // e.g., asset ticker/name, account name, sub-portfolio name
};

export default async function PerformancePage({
  searchParams,
}: {
  searchParams: { lens?: string };
}) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect('/');

  const lens = searchParams.lens || 'asset'; // default to asset

  // Define join based on lens
  let query: any = supabase
    .from('performance_summaries')
    .select(`
      grouping_type,
      grouping_id,
      realized_gain,
      dividends,
      interest,
      fees
    `)
    .eq('user_id', user.id)
    .eq('grouping_type', lens);

  // Add joins and name field
  let nameField = 'name';
  if (lens === 'asset') {
    query = query.select(`
      ...,
      asset:assets!inner (ticker, name)
    `);
    nameField = 'asset.ticker || \' - \' || asset.name';
  } else if (lens === 'account') {
    query = query.select(`
      ...,
      account:accounts!inner (name)
    `);
    nameField = 'account.name';
  } else if (lens === 'sub_portfolio') {
    query = query.select(`
      ...,
      sub_portfolio:sub_portfolios!inner (name)
    `);
    nameField = 'sub_portfolio.name';
  } else if (lens === 'asset_type' || lens === 'asset_subtype' || lens === 'geography' || lens === 'size_tag' || lens === 'factor_tag') {
    // For tag-based lenses, join assets and group by the tag
    query = supabase
      .from('performance_summaries')
      .select(`
        grouping_type,
        grouping_id,
        realized_gain,
        dividends,
        interest,
        fees,
        asset:assets!inner (${lens})
      `)
      .eq('user_id', user.id)
      .eq('grouping_type', lens);
    nameField = `asset.${lens}`;
  }

  const { data: summaries, error } = await query;

  if (error) {
    console.error(error);
    return <div>Error loading performance data</div>;
  }

  // Calculate net gain per row
  const rows = summaries?.map((row: any) => {
    const net = 
      (row.realized_gain || 0) +
      (row.dividends || 0) +
      (row.interest || 0) -
      (row.fees || 0);

    return {
      ...row,
      net_gain: net,
      display_name: row.asset?.ticker 
        ? `${row.asset.ticker} ${row.asset.name ? `- ${row.asset.name}` : ''}`
        : row.account?.name || row.sub_portfolio?.name || row.asset?.[lens] || row.grouping_id,
    };
  }) || [];

  // Grand total net gain
  const totalNet = rows.reduce((sum: number, r: any) => sum + r.net_gain, 0);

  return (
    <main className="p-8">
      <div className="flex justify-between items-center mb-8">
        <h1 className="text-3xl font-bold">Performance Reports</h1>
        <div className="flex items-center gap-4">
          <span className="text-sm font-medium">View by:</span>
          <Select defaultValue={lens}>
            <SelectTrigger className="w-[180px]">
              <SelectValue placeholder="Select lens" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="asset">Asset</SelectItem>
              <SelectItem value="account">Account</SelectItem>
              <SelectItem value="sub_portfolio">Sub-Portfolio</SelectItem>
              <SelectItem value="asset_type">Asset Type</SelectItem>
              <SelectItem value="asset_subtype">Asset Subtype</SelectItem>
              <SelectItem value="geography">Geography</SelectItem>
              <SelectItem value="size_tag">Size</SelectItem>
              <SelectItem value="factor_tag">Factor/Style</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      <Card className="mb-8">
        <CardHeader>
          <CardTitle>Net Gain/Loss Summary</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="text-2xl font-bold">
            {formatUSD(totalNet)}
            <span className={totalNet >= 0 ? 'text-green-600' : 'text-red-600'}>
              {' '}
              {totalNet >= 0 ? '▲' : '▼'}
            </span>
          </div>
          <p className="text-sm text-muted-foreground">Across all {lens.replace('_', ' ')}s</p>
        </CardContent>
      </Card>

      <div className="overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{lens.replace('_', ' ').toUpperCase()}</TableHead>
              <TableHead className="text-right">Realized Gain</TableHead>
              <TableHead className="text-right">Dividends</TableHead>
              <TableHead className="text-right">Interest</TableHead>
              <TableHead className="text-right">Fees</TableHead>
              <TableHead className="text-right font-bold">Net Gain/Loss</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((row: any) => (
              <TableRow key={row.grouping_id}>
                <TableCell className="font-medium">{row.display_name || row.grouping_id}</TableCell>
                <TableCell className="text-right">{formatUSD(row.realized_gain)}</TableCell>
                <TableCell className="text-right">{formatUSD(row.dividends)}</TableCell>
                <TableCell className="text-right">{formatUSD(row.interest)}</TableCell>
                <TableCell className="text-right">{formatUSD(-row.fees)}</TableCell>
                <TableCell
                  className={cn(
                    'text-right font-medium',
                    row.net_gain > 0 ? 'text-green-600' : row.net_gain < 0 ? 'text-red-600' : ''
                  )}
                >
                  {formatUSD(row.net_gain)}
                </TableCell>
              </TableRow>
            ))}
            {rows.length === 0 && (
              <TableRow>
                <TableCell colSpan={6} className="text-center text-muted-foreground py-8">
                  No data yet for this lens. Add transactions to see performance.
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>

      {/* Placeholder for future TWR / MWR / Charts */}
      <div className="mt-12 grid gap-6 md:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Time-Weighted Return (TWR)</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold">Coming soon</div>
            <p className="text-sm text-muted-foreground mt-2">
              Requires historical snapshots (daily/monthly portfolio values).
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Money-Weighted Return (MWR / IRR)</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold">Coming soon</div>
            <p className="text-sm text-muted-foreground mt-2">
              Accounts for timing of deposits/withdrawals.
            </p>
          </CardContent>
        </Card>
      </div>
    </main>
  );
}