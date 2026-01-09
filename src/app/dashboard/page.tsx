// app/dashboard/page.tsx
'use client';

import { useEffect, useState } from 'react';
import {
  PieChart, Pie, Cell, ResponsiveContainer, Tooltip, Legend,
  LineChart, Line, XAxis, YAxis, CartesianGrid
} from 'recharts';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Button } from '@/components/ui/button';
import { Table, TableBody, TableCell, TableHeader, TableRow } from '@/components/ui/table';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { formatUSD } from '@/lib/formatters';
import { refreshAssetPrices } from '@/app/dashboard/portfolio/actions';

const COLORS = ['#3b82f6', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6', '#ec4899', '#06b6d4'];
const BENCHMARK_COLORS: Record<string, string> = {
  SPX: '#10b981',
  IXIC: '#f59e0b',
  BTCUSD: '#f97316'
};

export default function DashboardHome() {
  const [lens, setLens] = useState('sub_portfolio');
  const [period, setPeriod] = useState('1Y');
  const [metricType, setMetricType] = useState<'twr' | 'mwr'>('mwr');
  const [allocations, setAllocations] = useState<any[]>([]);
  const [performance, setPerformance] = useState<any>(null);
  const [drillItems, setDrillItems] = useState<any[]>([]);
  const [refreshing, setRefreshing] = useState(false);
  const [loading, setLoading] = useState(true);
const [error, setError] = useState<string | null>(null);
  // Fetch data on filter change
  useEffect(() => {
    const fetchData = async () => {
      const [allocRes, perfRes] = await Promise.all([
        fetch('/api/allocations', {
          method: 'POST',
          body: JSON.stringify({ lens })
        }),
        fetch('/api/performance', {
          method: 'POST',
          body: JSON.stringify({ period, lens, metricType })
        })
      ]);
      const fetchData = async () => {
      setLoading(true);
      setError(null);
      try {
        const [allocRes, perfRes] = await Promise.all([
          fetch('/api/allocations', { method: 'POST', body: JSON.stringify({ lens }) }),
          fetch('/api/performance', { method: 'POST', body: JSON.stringify({ period, lens, metricType }) })
        ]);

        if (!allocRes.ok) throw new Error(`Allocations API failed: ${allocRes.status}`);
        if (!perfRes.ok) throw new Error(`Performance API failed: ${perfRes.status}`);

        const allocData = await allocRes.json();
        console.log('Allocations response:', allocData); // Log
        setAllocations(allocData.allocations || []);

        const perfData = await perfRes.json();
        console.log('Performance response:', perfData); // Log
        setPerformance(perfData);

      } catch (err) {
        setError((err as Error).message);
        console.error('Fetch error:', err);
      } finally {
        setLoading(false);
      }
    };
      const allocData = await allocRes.json();
      setAllocations(allocData.allocations || []);

      const perfData = await perfRes.json();
      setPerformance(perfData);
    };

    fetchData();
  }, [lens, period, metricType]);

  const handleRefreshPrices = async () => {
    setRefreshing(true);
    await refreshAssetPrices();
    window.location.reload(); // Simple full refresh – keeps it reliable
    setRefreshing(false);
  };

  const handlePieClick = (data: any) => {
    setDrillItems(data.items || []);
  };

  return (
    <main className="container mx-auto p-6">
      <h1 className="text-4xl font-bold mb-8">Portfolio Dashboard</h1>

      {/* Controls */}
      <div className="flex flex-wrap gap-4 mb-8 items-end">
        <div>
          <label className="text-sm font-medium">Slice by</label>
          <Select value={lens} onValueChange={setLens}>
            <SelectTrigger className="w-48">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="asset_type">Asset Type</SelectItem>
              <SelectItem value="asset_subtype">Sub-Type</SelectItem>
              <SelectItem value="geography">Geography</SelectItem>
              <SelectItem value="factor_tag">Factor</SelectItem>
              <SelectItem value="size_tag">Size</SelectItem>
              <SelectItem value="sub_portfolio">Sub-Portfolio</SelectItem>
              <SelectItem value="account">Account</SelectItem>
            </SelectContent>
          </Select>
        </div>

        <div>
          <label className="text-sm font-medium">Period</label>
          <Select value={period} onValueChange={setPeriod}>
            <SelectTrigger className="w-40">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="1D">1 Day</SelectItem>
              <SelectItem value="1M">1 Month</SelectItem>
              <SelectItem value="1Y">1 Year</SelectItem>
              <SelectItem value="All">All Time</SelectItem>
            </SelectContent>
          </Select>
        </div>

        <div>
          <label className="text-sm font-medium">Return Metric</label>
          <Select value={metricType} onValueChange={(v: 'twr' | 'mwr') => setMetricType(v)}>
            <SelectTrigger className="w-40">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="twr">TWR</SelectItem>
              <SelectItem value="mwr">MWR</SelectItem>
            </SelectContent>
          </Select>
        </div>

        <Button onClick={handleRefreshPrices} disabled={refreshing}>
          {refreshing ? 'Refreshing...' : 'Refresh Prices'}
        </Button>
      </div>
{loading ? (
  <p>Loading portfolio data...</p>
) : error ? (
  <p className="text-red-500">Error: {error} (Check console for details)</p>
) : (
  <>
    {/* Existing Allocations Card */}
    <Card className="mb-8">...</Card>
    {/* Existing Performance Card */}
    <Card>...</Card>
  </>
)}
      {/* Allocations Section – preserved exactly from your current code */}
      <Card className="mb-8">
        <CardHeader>
          <CardTitle>Current Allocation ({lens.replace('_', ' ')})</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid md:grid-cols-2 gap-8">
            <ResponsiveContainer width="100%" height={400}>
              <PieChart>
                <Pie
                  data={allocations}
                  dataKey="percentage"
                  nameKey="key"
                  cx="50%"
                  cy="50%"
                  outerRadius={120}
                  label={({ percent }) => `${((percent ?? 0) * 100).toFixed(1)}%`}
                  onClick={handlePieClick}
                >
                  {allocations.map((_, i) => (
                    <Cell key={`cell-${i}`} fill={COLORS[i % COLORS.length]} />
                  ))}
                </Pie>
                <Tooltip formatter={(v) => (v !== undefined ? `${Number(v).toFixed(2)}%` : '')} />
                <Legend />
              </PieChart>
            </ResponsiveContainer>

            <Table>
              <TableHeader>
                <TableRow>
                  <TableCell>Category</TableCell>
                  <TableCell className="text-right">% </TableCell>
                  <TableCell className="text-right">Value</TableCell>
                  <TableCell className="text-right">Unrealized</TableCell>
                </TableRow>
              </TableHeader>
              <TableBody>
                {allocations.map(a => (
                  <TableRow key={a.key} className="cursor-pointer hover:bg-muted/50" onClick={() => handlePieClick(a)}>
                    <TableCell className="font-medium">{a.key}</TableCell>
                    <TableCell className="text-right">{a.percentage.toFixed(2)}%</TableCell>
                    <TableCell className="text-right">{formatUSD(a.value)}</TableCell>
                    <TableCell className="text-right">{formatUSD(a.unrealized)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>

          {drillItems.length > 0 && (
            <div className="mt-8">
              <h3 className="text-lg font-semibold mb-4">Holdings in selected slice</h3>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableCell>Ticker</TableCell>
                    <TableCell>Name</TableCell>
                    <TableCell className="text-right">Quantity</TableCell>
                    <TableCell className="text-right">Value</TableCell>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {drillItems.map((item: any) => (
                    <TableRow key={item.ticker}>
                      <TableCell>{item.ticker}</TableCell>
                      <TableCell>{item.name || '-'}</TableCell>
                      <TableCell className="text-right">{item.quantity.toFixed(4)}</TableCell>
                      <TableCell className="text-right">{formatUSD(item.value)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Performance Section – now with real line chart */}
      <Card>
        <CardHeader>
          <CardTitle>Performance ({period} • {metricType.toUpperCase()})</CardTitle>
        </CardHeader>
        <CardContent>
          <ResponsiveContainer width="100%" height={400}>
            <LineChart data={performance?.series || []}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="date" />
              <YAxis tickFormatter={(v) => `${v}%`} />
              <Tooltip formatter={(v) => (v !== undefined ? `${Number(v).toFixed(2)}%` : '')} />
              <Legend />
              <Line type="monotone" dataKey="portfolio" stroke="#3b82f6" strokeWidth={2} name="Portfolio" dot={false} />
              <Line type="monotone" dataKey="SPX" stroke={BENCHMARK_COLORS.SPX} name="S&P 500" dot={false} />
              <Line type="monotone" dataKey="IXIC" stroke={BENCHMARK_COLORS.IXIC} name="NASDAQ" dot={false} />
              <Line type="monotone" dataKey="BTCUSD" stroke={BENCHMARK_COLORS.BTCUSD} name="Bitcoin" dot={false} />
            </LineChart>
          </ResponsiveContainer>

          <Table className="mt-8">
            <TableHeader>
              <TableRow>
                <TableCell>Metric</TableCell>
                <TableCell className="text-right">Value</TableCell>
              </TableRow>
            </TableHeader>
            <TableBody>
              <TableRow>
                <TableCell className="font-medium">Total Return</TableCell>
                <TableCell className="text-right">
                  {performance?.totalReturn !== undefined ? `${(performance.totalReturn * 100).toFixed(2)}%` : '-'}
                </TableCell>
              </TableRow>
              <TableRow>
                <TableCell className="font-medium">Annualized Return</TableCell>
                <TableCell className="text-right">
                  {performance?.annualized !== undefined ? `${(performance.annualized * 100).toFixed(2)}%` : '-'}
                </TableCell>
              </TableRow>
              <TableRow>
                <TableCell className="font-medium">Unrealized Gain/Loss</TableCell>
                <TableCell className="text-right">{formatUSD(performance?.factors?.unrealized || 0)}</TableCell>
              </TableRow>
              <TableRow>
                <TableCell className="font-medium">Realized Gain/Loss</TableCell>
                <TableCell className="text-right">{formatUSD(performance?.factors?.realized || 0)}</TableCell>
              </TableRow>
              <TableRow>
                <TableCell className="font-medium">Dividends</TableCell>
                <TableCell className="text-right">{formatUSD(performance?.factors?.dividends || 0)}</TableCell>
              </TableRow>
              <TableRow>
                <TableCell className="font-medium">Fees</TableCell>
                <TableCell className="text-right">{formatUSD(performance?.factors?.fees || 0)}</TableCell>
              </TableRow>
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </main>
  );
}