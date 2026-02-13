'use client';

import { useState, useEffect } from 'react';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from 'recharts';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
// import { Badge } from '@/components/ui/badge';

const LENSES = [
  { value: 'total', label: 'Total Portfolio' },
  { value: 'asset', label: 'Asset' },
  { value: 'asset_type', label: 'Asset Type' },
  { value: 'asset_subtype', label: 'Asset Sub-Type' },
  { value: 'sub_portfolio', label: 'Sub-Portfolio' },
  { value: 'account', label: 'Account' },
  { value: 'geography', label: 'Geography' },
  { value: 'size_tag', label: 'Size' },
  { value: 'factor_tag', label: 'Factor' },
];

export default function PerformancePage() {
  const [lens, setLens] = useState('total');
  const [aggregate, setAggregate] = useState(true);
  const [data, setData] = useState({ series: [], metrics: [], benchmarks: null });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const fetchData = async () => {
      setLoading(true);
      setError(null);
      try {
        const res = await fetch('/api/reports/performance/time-series', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ lens, aggregate }),
        });
        if (!res.ok) throw new Error(await res.text());
        const json = await res.json();
        setData(json);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Fetch error');
      } finally {
        setLoading(false);
      }
    };

    fetchData();
  }, [lens, aggregate]);

  if (loading) return <div className="p-8 text-center">Loading performance...</div>;
  if (error) return <div className="p-8 text-center text-red-600">Error: {error}</div>;

  return (
    <div className="p-8 max-w-7xl mx-auto space-y-8">
      <div>
        <h1 className="text-3xl font-bold mb-4">Performance Reports v1.1</h1>
        <p className="text-muted-foreground">Lenses and aggregation consistent with rebalancing/holdings.</p>
      </div>

      <div className="flex flex-wrap gap-4 items-end bg-muted/20 p-6 rounded-xl">
        <div className="flex-1 min-w-[200px]">
          <Label className="text-xs uppercase font-bold mb-1 block">Lens</Label>
          <Select value={lens} onValueChange={setLens}>
            <SelectTrigger className="w-full md:w-56">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {LENSES.map(l => (
                <SelectItem key={l.value} value={l.value}>
                  {l.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="flex items-center gap-2 p-2 border rounded bg-background">
          <Switch checked={aggregate} onCheckedChange={setAggregate} />
          <Label className="text-sm cursor-pointer whitespace-nowrap">Aggregate</Label>
        </div>
        <Button variant="outline" size="sm">Refresh</Button>
      </div>

      <Card>
        <CardContent className="p-0">
          <ResponsiveContainer width="100%" height={500}>
            <LineChart data={data.series}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="date" />
              <YAxis />
              <Tooltip />
              <Legend />
              <Line type="monotone" dataKey="mwr" stroke="#8884d8" name="MWR (%)" />
              <Line type="monotone" dataKey="twr" stroke="#82ca9d" name="TWR (%)" />
              {data.benchmarks && <Line type="monotone" dataKey="benchmark" stroke="#ff7300" name="Benchmark" />}
            </LineChart>
          </ResponsiveContainer>
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-lg">Totals</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              <div className="flex justify-between">
                <span>Total Return</span>
                <span className="px-2 py-1 bg-primary text-primary-foreground text-xs rounded">12.5%</span>
              </div>
              <div className="flex justify-between">
                <span>Annualized IRR</span>
                <Badge>8.2%</Badge>
              </div>
            </div>
          </CardContent>
        </Card>
        {/* G/L Income accordions */}
      </div>
    </div>
  );
}
