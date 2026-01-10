'use client';

import { useState, useEffect } from 'react';
import {
  PieChart, Pie, Cell, ResponsiveContainer, Tooltip, Legend,
  LineChart, Line, XAxis, YAxis, CartesianGrid,
} from 'recharts';
import { format, startOfYear, startOfQuarter, startOfMonth, startOfWeek, subYears, subQuarters } from 'date-fns';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { Table, TableHeader, TableRow, TableHead, TableBody, TableCell } from '@/components/ui/table';
import { Popover, PopoverTrigger, PopoverContent } from '@/components/ui/popover';
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from '@/components/ui/command';
import { Calendar } from '@/components/ui/calendar';
import { CalendarIcon, Check, ChevronsUpDown } from 'lucide-react';
import { formatUSD } from '@/lib/formatters';
import { refreshAssetPrices } from '@/app/dashboard/portfolio/actions';
import { cn } from '@/lib/utils';

const COLORS = ['#3b82f6', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6', '#ec4899', '#06b6d4', '#14b8a6', '#f97316', '#a855f7'];

const LENSES = [
  { value: 'total', label: 'Total Portfolio' },
  { value: 'sub_portfolio', label: 'Sub-Portfolio' },
  { value: 'account', label: 'Account' },
  { value: 'asset_type', label: 'Asset Type' },
  { value: 'asset_subtype', label: 'Asset Sub-Type' },
  { value: 'geography', label: 'Geography' },
  { value: 'size_tag', label: 'Size' },
  { value: 'factor_tag', label: 'Factor' },
];

const PRESETS = [
  { value: 'today', label: 'Today' },
  { value: 'wtd', label: 'Week to Date' },
  { value: 'mtd', label: 'Month to Date' },
  { value: 'qtd', label: 'Quarter to Date' },
  { value: 'prev_q', label: 'Previous Quarter' },
  { value: 'ytd', label: 'Year to Date' },
  { value: 'prev_y', label: 'Previous Year' },
  { value: '3y', label: 'Trailing 3 Years' },
  { value: '5y', label: 'Trailing 5 Years' },
];

export default function DashboardHome() {
  const [lens, setLens] = useState('total');
  const [availableValues, setAvailableValues] = useState<string[]>([]);
  const [selectedValues, setSelectedValues] = useState<string[]>([]);
  const [aggregate, setAggregate] = useState(true);
  const [preset, setPreset] = useState('ytd');
  const [customStart, setCustomStart] = useState<Date | undefined>(undefined);
  const [customEnd, setCustomEnd] = useState<Date | undefined>(undefined);
  const [metric, setMetric] = useState<'twr' | 'mwr'>('twr');
  const [showBenchmarks, setShowBenchmarks] = useState(false);
  const [allocations, setAllocations] = useState<any[]>([]); // array of {key, value, percentage, net_gain, items?}
  const [performance, setPerformance] = useState<any>(null);
  const [drillItems, setDrillItems] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [valuesLoading, setValuesLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);

  // Fetch distinct values when lens changes
  useEffect(() => {
    if (lens === 'total') {
      setAvailableValues([]);
      setSelectedValues([]);
      return;
    }
    const fetchValues = async () => {
      setValuesLoading(true);
      const res = await fetch('/api/dashboard/values', {
        method: 'POST',
        body: JSON.stringify({ lens }),
      });
      const data = await res.json();
      setAvailableValues(data.values || []);
      setSelectedValues(data.values || []); // default all
      setValuesLoading(false);
    };
    fetchValues();
  }, [lens]);

  const handleRefresh = async () => {
    setRefreshing(true);
    await refreshAssetPrices();
    window.location.reload();
  };

  useEffect(() => {
    const fetchData = async () => {
      setLoading(true);
      const today = new Date();
      let start = customStart || today;
      let end = customEnd || today;

      if (!customStart && !customEnd) {
        switch (preset) {
          case 'today': start = today; break;
          case 'wtd': start = startOfWeek(today); break;
          case 'mtd': start = startOfMonth(today); break;
          case 'qtd': start = startOfQuarter(today); break;
          case 'prev_q': 
            const prevQStart = subQuarters(startOfQuarter(today), 1);
            start = prevQStart;
            end = subQuarters(startOfQuarter(today), 1);
            break;
          case 'ytd': start = startOfYear(today); break;
          case 'prev_y': 
            start = subYears(startOfYear(today), 1);
            end = subYears(startOfYear(today), 1);
            break;
          case '3y': start = subYears(today, 3); break;
          case '5y': start = subYears(today, 5); break;
        }
      }

      const startStr = format(start, 'yyyy-MM-dd');
      const endStr = format(end, 'yyyy-MM-dd');

      const payload = {
        lens,
        selectedValues: lens === 'total' ? [] : selectedValues,
        aggregate,
        start: startStr,
        end: endStr,
        metric,
        benchmarks: showBenchmarks,
      };

      const [allocRes, perfRes] = await Promise.all([
        fetch('/api/dashboard/allocations', { method: 'POST', body: JSON.stringify(payload) }),
        fetch('/api/dashboard/performance', { method: 'POST', body: JSON.stringify(payload) }),
      ]);

      const allocData = await allocRes.json();
      const perfData = await perfRes.json();

      setAllocations(allocData.allocations || []);
      setPerformance(perfData);
      setLoading(false);
    };

    if (lens === 'total' || selectedValues.length > 0) {
      fetchData();
    }
  }, [lens, selectedValues, aggregate, preset, customStart, customEnd, metric, showBenchmarks]);

  const toggleValue = (value: string) => {
    setSelectedValues(prev =>
      prev.includes(value) ? prev.filter(v => v !== value) : [...prev, value]
    );
  };

  const handlePieClick = (data: any, index: number) => {
    // In separate mode, data is per slice
    setDrillItems(data.items || []);
  };

  return (
    <main className="container mx-auto p-6">
      <h1 className="text-4xl font-bold mb-8">Portfolio Dashboard</h1>

      <div className="flex flex-wrap gap-4 mb-8 items-end">
        {/* Lens */}
        <div>
          <Label className="text-sm font-medium">Slice by</Label>
          <Select value={lens} onValueChange={setLens}>
            <SelectTrigger className="w-56">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {LENSES.map(l => (
                <SelectItem key={l.value} value={l.value}>{l.label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {/* Multi-Select Values (disabled for total) */}
        {lens !== 'total' && (
          <div className="min-w-64">
            <Label className="text-sm font-medium">
              Select {LENSES.find(l => l.value === lens)?.label}s {valuesLoading && '(loading...)'}
            </Label>
            <Popover>
              <PopoverTrigger asChild>
                <Button variant="outline" className="w-full justify-between">
                  {selectedValues.length === availableValues.length ? 'All selected' :
                   selectedValues.length === 0 ? 'None selected' :
                   `${selectedValues.length} selected`}
                  <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-full p-0">
                <Command>
                  <CommandInput placeholder="Search..." />
                  <CommandList>
                    <CommandEmpty>No values found.</CommandEmpty>
                    <CommandGroup>
                      {availableValues.map(val => (
                        <CommandItem key={val} onSelect={() => toggleValue(val)}>
                          <Check className={cn("mr-2 h-4 w-4", selectedValues.includes(val) ? "opacity-100" : "opacity-0")} />
                          {val || 'Untagged'}
                        </CommandItem>
                      ))}
                    </CommandGroup>
                  </CommandList>
                </Command>
              </PopoverContent>
            </Popover>
          </div>
        )}

        {/* Aggregate Toggle (only if multiple selected and lens not total) */}
        {lens !== 'total' && selectedValues.length > 1 && (
          <div className="flex items-center gap-2">
            <Switch checked={aggregate} onCheckedChange={setAggregate} />
            <Label>Aggregate selected</Label>
          </div>
        )}

        {/* Period Preset & Custom Dates */}
        <div>
          <Label className="text-sm font-medium">Period Preset</Label>
          <Select value={preset} onValueChange={setPreset}>
            <SelectTrigger className="w-48">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {PRESETS.map(p => (
                <SelectItem key={p.value} value={p.value}>{p.label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div>
          <Label className="text-sm font-medium">Custom Start</Label>
          <Popover>
            <PopoverTrigger asChild>
              <Button variant="outline">
                <CalendarIcon className="mr-2 h-4 w-4" />
                {customStart ? format(customStart, 'PPP') : 'Select'}
              </Button>
            </PopoverTrigger>
            <PopoverContent><Calendar mode="single" selected={customStart} onSelect={setCustomStart} /></PopoverContent>
          </Popover>
        </div>

        <div>
          <Label className="text-sm font-medium">Custom End</Label>
          <Popover>
            <PopoverTrigger asChild>
              <Button variant="outline">
                <CalendarIcon className="mr-2 h-4 w-4" />
                {customEnd ? format(customEnd, 'PPP') : 'Select'}
              </Button>
            </PopoverTrigger>
            <PopoverContent><Calendar mode="single" selected={customEnd} onSelect={setCustomEnd} /></PopoverContent>
          </Popover>
        </div>

        {/* Metric & Benchmarks */}
        <div>
          <Label className="text-sm font-medium">Return Metric</Label>
          <Select value={metric} onValueChange={(v: 'twr' | 'mwr') => setMetric(v)}>
            <SelectTrigger className="w-40">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="twr">TWR</SelectItem>
              <SelectItem value="mwr">MWR</SelectItem>
            </SelectContent>
          </Select>
        </div>

        <div className="flex items-center gap-2">
          <Switch checked={showBenchmarks} onCheckedChange={setShowBenchmarks} />
          <Label>Show Benchmarks</Label>
        </div>

        <Button onClick={handleRefresh} disabled={refreshing}>
          {refreshing ? 'Refreshing...' : 'Refresh Prices'}
        </Button>
      </div>

      {/* Disclaimer Tooltip */}
      <Popover>
        <PopoverTrigger asChild>
          <Button variant="ghost" size="sm" className="mb-4">ℹ️ Note on slicing</Button>
        </PopoverTrigger>
        <PopoverContent>
          <p className="text-sm">
            Performance attribution assumes asset tags (sub-portfolio, geography, etc.) have been stable over time.
            If you have moved assets between categories, historical gains may be attributed to the current tag.
          </p>
        </PopoverContent>
      </Popover>

      {loading ? (
        <p>Loading...</p>
      ) : selectedValues.length === 0 && lens !== 'total' ? (
        <p>Select at least one value to view data.</p>
      ) : (
        <>
          {/* Allocations */}
          <Card className="mb-8">
            <CardHeader>
              <CardTitle>
                Current Allocation {aggregate ? '(Aggregated)' : '(Separate Comparison)'}
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className={cn("gap-8", aggregate ? "grid md:grid-cols-1" : "grid md:grid-cols-2 lg:grid-cols-3")}>
                {allocations.map((slice, idx) => (
                  <div key={idx} className="space-y-4">
                    <h4 className="font-medium text-center">{slice.key}</h4>
                    <ResponsiveContainer width="100%" height={300}>
                      <PieChart>
                        <Pie
                          data={slice.data}
                          dataKey="value"
                          nameKey="subkey"
                          outerRadius={100}
                          label={({ percent }) => percent ? `${(percent * 100).toFixed(1)}%` : ''}
                          onClick={(data) => handlePieClick(data, idx)}
                        >
                          {slice.data.map((_: any, i: number) => (
                            <Cell key={`cell-${i}`} fill={COLORS[i % COLORS.length]} />
                          ))}
                        </Pie>
                        <Tooltip formatter={(v: number | undefined) => v !== undefined ? formatUSD(v) : ''} />
                        <Legend />
                      </PieChart>
                    </ResponsiveContainer>
                  </div>
                ))}
              </div>

              {/* Holdings Table (from clicked pie) */}
              {drillItems.length > 0 && (
                <div className="mt-8">
                  <h3 className="text-lg font-semibold mb-4">Holdings in Selected Slice</h3>
                  <Table>{/* same as before, using drillItems */}</Table>
                </div>
              )}
            </CardContent>
          </Card>

          {/* Performance */}
          <Card>
            <CardHeader>
              <CardTitle>Performance ({preset.toUpperCase()} • {metric.toUpperCase()})</CardTitle>
            </CardHeader>
            <CardContent>
              <ResponsiveContainer width="100%" height={400}>
                <LineChart data={performance?.series || []}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="date" />
                  <YAxis tickFormatter={(v) => `${v}%`} />
                  <Tooltip formatter={(v: number | undefined) => v !== undefined ? `${v.toFixed(2)}%` : ''} />
                  <Legend />
                  {performance?.lines?.map((line: any, i: number) => (
                    <Line
                      key={i}
                      type="monotone"
                      dataKey={line.key}
                      stroke={COLORS[i % COLORS.length]}
                      name={line.name}
                      dot={false}
                    />
                  ))}
                  {showBenchmarks && performance?.benchmarks?.SPX && (
                    <Line type="monotone" dataKey="SPX" stroke="#10b981" name="S&P 500" />
                  )}
                  {/* similar for others */}
                </LineChart>
              </ResponsiveContainer>

              {/* Metrics Table – one row per slice if separate */}
              <Table className="mt-8">
                {/* Headers */}
                <TableBody>
                  {performance?.metrics?.map((m: any) => (
                    <TableRow key={m.key}>
                      <TableCell>{m.key} - Total Return</TableCell>
                      <TableCell className="text-right">{(m.totalReturn * 100).toFixed(2)}%</TableCell>
                      {/* Add annualized, netGain similarly */}
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </>
      )}
    </main>
  );
}