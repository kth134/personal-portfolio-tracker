'use client';

import { useState, useEffect } from 'react';
import {
  PieChart, Pie, Cell, ResponsiveContainer, Tooltip, Legend,
} from 'recharts';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { Table, TableHeader, TableRow, TableHead, TableBody, TableCell } from '@/components/ui/table';
import { Popover, PopoverTrigger, PopoverContent } from '@/components/ui/popover';
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from '@/components/ui/command';
import { Check, ChevronsUpDown } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { formatUSD } from '@/lib/formatters';
import { refreshAssetPrices } from '@/app/dashboard/portfolio/actions';
import { cn } from '@/lib/utils';
import { createClient } from '@/lib/supabase/client';
import { useRouter } from 'next/navigation';

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

export default function DashboardHome() {
  const supabase = createClient();
  const router = useRouter();

  // Core states from original
  const [lens, setLens] = useState('total');
  const [availableValues, setAvailableValues] = useState<string[]>([]);
  const [selectedValues, setSelectedValues] = useState<string[]>([]);
  const [aggregate, setAggregate] = useState(true);
  const [allocations, setAllocations] = useState<any[]>([]);
  const [drillItems, setDrillItems] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [valuesLoading, setValuesLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [refreshMessage, setRefreshMessage] = useState<string | null>(null);
  const [performanceTotals, setPerformanceTotals] = useState<any>(null);

  // MFA states
  const [mfaStatus, setMfaStatus] = useState<'checking' | 'prompt' | 'verified' | 'none'>('checking');
  const [mfaCode, setMfaCode] = useState('');
  const [mfaError, setMfaError] = useState<string | null>(null);

  // Fetch distinct values for lens
  useEffect(() => {
    if (lens === 'total') {
      setAvailableValues([]);
      setSelectedValues([]);
      return;
    }

    const fetchValues = async () => {
      setValuesLoading(true);
      try {
        const res = await fetch('/api/dashboard/values', {
          method: 'POST',
          body: JSON.stringify({ lens }),
        });
        if (!res.ok) throw new Error(`Failed to fetch values: ${res.status}`);
        const data = await res.json();
        const vals = data.values || [];
        setAvailableValues(vals);
        setSelectedValues(vals); // default to all
      } catch (err) {
        console.error('Failed to load lens values:', err);
      } finally {
        setValuesLoading(false);
      }
    };
    fetchValues();
  }, [lens]);

  // MFA check on mount
  useEffect(() => {
    const checkMfa = async () => {
      try {
        const { data: aalData, error: aalErr } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
        if (aalErr) throw aalErr;
        const { currentLevel, nextLevel } = aalData ?? {};
        if (currentLevel === 'aal1' && nextLevel === 'aal2') {
          setMfaStatus('prompt');
        } else {
          setMfaStatus('verified');
        }
      } catch (err) {
        console.error('AAL check failed:', err);
        setMfaStatus('none');
      }
    };

    checkMfa();
  }, []);

  // Load data when MFA verified or when dependencies change
  useEffect(() => {
    if (mfaStatus === 'verified') {
      loadDashboardData();
    }
  }, [mfaStatus, lens, selectedValues, aggregate]);

  const loadDashboardData = async () => {
    setLoading(true);

    const payload = {
      lens,
      selectedValues: lens === 'total' ? [] : selectedValues,
      aggregate,
    };

    try {
      const allocRes = await fetch('/api/dashboard/allocations', { method: 'POST', body: JSON.stringify(payload), cache: 'no-store' });

      if (!allocRes.ok) throw new Error(`Allocations fetch failed: ${allocRes.status}`);

      const allocData = await allocRes.json();

      setAllocations(allocData.allocations || []);

      // Fetch performance totals
      const { data: { user } } = await supabase.auth.getUser();
      const userId = user?.id;
      if (userId) {
        // Fetch all tax lots to calculate total original investment
        const { data: allLotsData } = await supabase
          .from('tax_lots')
          .select('cost_basis_per_unit, quantity, remaining_quantity')
          .eq('user_id', userId);

        const totalOriginalInvestment = allLotsData?.reduce((sum, lot) => {
          return sum + (Number(lot.cost_basis_per_unit) * Number(lot.quantity || lot.remaining_quantity));
        }, 0) || 0;

        // Fetch performance summaries for all assets
        const { data: summaries } = await supabase
          .from('performance_summaries')
          .select('realized_gain, dividends, interest, fees, unrealized_gain, market_value, net_gain')
          .eq('user_id', userId)
          .eq('grouping_type', 'asset');

        // Sum all summaries for totals
        const totals = summaries?.reduce(
          (acc, row) => ({
            market_value: acc.market_value + (row.market_value || 0),
            unrealized_gain: acc.unrealized_gain + (row.unrealized_gain || 0),
            realized_gain: acc.realized_gain + (row.realized_gain || 0),
            dividends: acc.dividends + (row.dividends || 0),
            net_gain: acc.net_gain + (row.net_gain || 0),
          }),
          { market_value: 0, unrealized_gain: 0, realized_gain: 0, dividends: 0, net_gain: 0 }
        ) || { market_value: 0, unrealized_gain: 0, realized_gain: 0, dividends: 0, net_gain: 0 };

        const totalReturnPct = totalOriginalInvestment > 0 ? (totals.net_gain / totalOriginalInvestment) * 100 : 0;

        setPerformanceTotals({
          market_value: totals.market_value,
          net_gain: totals.net_gain,
          total_return_pct: totalReturnPct,
          unrealized_gain: totals.unrealized_gain,
          realized_gain: totals.realized_gain,
          dividends: totals.dividends,
        });
      }
    } catch (err) {
      console.error('Dashboard data fetch failed:', err);
    } finally {
      setLoading(false);
    }
  };

  const handleRefresh = async () => {
    setRefreshing(true);
    setRefreshMessage(null);
    try {
      const result = await refreshAssetPrices();
      setRefreshMessage(result.message || 'Prices refreshed successfully!');
      // Refetch data
      loadDashboardData();
    } catch (err) {
      console.error('Refresh failed:', err);
      setRefreshMessage('Error refreshing prices. Check console.');
    } finally {
      setRefreshing(false);
    }
  };

  const toggleValue = (value: string) => {
    setSelectedValues(prev =>
      prev.includes(value) ? prev.filter(v => v !== value) : [...prev, value]
    );
  };

  const handlePieClick = (data: any) => {
    setDrillItems(data.items || []);
  };

  const handleMfaVerify = async () => {
    setMfaError(null);
    try {
      const { data: factors } = await supabase.auth.mfa.listFactors();
      const factor = factors?.totp?.find(f => f.status === 'verified');
      if (!factor?.id) throw new Error('No verified TOTP factor found');

      const { error } = await supabase.auth.mfa.challengeAndVerify({
        factorId: factor.id,
        code: mfaCode.trim(),
      });

      if (error) throw error;

      setMfaStatus('verified');
    } catch (err: any) {
      setMfaError(err.message || 'Verification failed');
    }
  };

  // ── Render ──────────────────────────────────────────────────────────────

  if (mfaStatus === 'checking') {
    return <div className="container mx-auto p-6 text-center">Checking security...</div>;
  }

  if (mfaStatus === 'prompt') {
    return (
      <div className="container mx-auto max-w-md p-6 space-y-6">
        <h1 className="text-2xl font-bold">Verify Your Identity</h1>
        <p className="text-muted-foreground">Enter the 6-digit code from your authenticator app</p>
        <Input
          placeholder="000000"
          value={mfaCode}
          onChange={(e: any) => setMfaCode(e.target.value)}
          maxLength={6}
          className="text-center text-2xl tracking-widest"
        />
        {mfaError && <p className="text-red-500 text-sm">{mfaError}</p>}
        <Button onClick={handleMfaVerify} className="w-full" disabled={!mfaCode.trim()}>
          Verify
        </Button>
        <p className="text-sm text-center text-muted-foreground">
          Need to set up MFA? Go to <a href="/settings/mfa" className="underline">Settings → MFA</a>
        </p>
      </div>
    );
  }

  // Normal dashboard view (MFA cleared)
  return (
    <main className="container mx-auto p-6">
      <div className="flex justify-between items-center mb-8">
        <h1 className="text-4xl font-bold">Portfolio Dashboard</h1>
        <Button variant="outline" size="sm" asChild>
          <a href="/settings/mfa">MFA Settings</a>
        </Button>
      </div>

      {/* Full controls section – moved to above allocation card */}
      {loading ? (
        <div className="text-center py-12">Loading portfolio data...</div>
      ) : selectedValues.length === 0 && lens !== 'total' ? (
        <div className="text-center py-12 text-muted-foreground">Select at least one value to view data.</div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
          <div>
            <div className="flex justify-start mb-4">
              <Button onClick={handleRefresh} disabled={refreshing}>
                {refreshing ? 'Refreshing...' : 'Refresh Prices'}
              </Button>
              {refreshMessage && <span className="ml-4 text-sm text-green-600">{refreshMessage}</span>}
            </div>
            <Card className="mt-6 cursor-pointer" onClick={() => router.push('/dashboard/performance')}>
              <CardHeader>
                <CardTitle className="text-center text-4xl">Portfolio Performance Summary</CardTitle>
                <div className="grid grid-cols-2 gap-8 mt-6">
                  <div className="space-y-8">
                    <div>
                      <CardTitle>Total Portfolio Value</CardTitle>
                      <p className="text-2xl font-bold text-black mt-2">
                        {performanceTotals ? formatUSD(performanceTotals.market_value) : 'Loading...'}
                      </p>
                    </div>
                    <div>
                      <CardTitle>Net Gain/Loss</CardTitle>
                      <p className={cn("text-2xl font-bold mt-2", performanceTotals?.net_gain >= 0 ? "text-green-600" : "text-red-600")}>
                        {performanceTotals ? formatUSD(performanceTotals.net_gain) : 'Loading...'}
                      </p>
                    </div>
                    <div>
                      <CardTitle>Total Return %</CardTitle>
                      <p className={cn("text-2xl font-bold mt-2", performanceTotals?.total_return_pct >= 0 ? "text-green-600" : "text-red-600")}>
                        {performanceTotals ? `${performanceTotals.total_return_pct.toFixed(2)}%` : 'Loading...'}
                      </p>
                    </div>
                  </div>
                  <div className="space-y-8">
                    <div>
                      <CardTitle>Unrealized Gain</CardTitle>
                      <p className={cn("text-2xl font-bold mt-2", performanceTotals?.unrealized_gain >= 0 ? "text-green-600" : "text-red-600")}>
                        {performanceTotals ? formatUSD(performanceTotals.unrealized_gain) : 'Loading...'}
                      </p>
                    </div>
                    <div>
                      <CardTitle>Realized Gain</CardTitle>
                      <p className={cn("text-2xl font-bold mt-2", performanceTotals?.realized_gain >= 0 ? "text-green-600" : "text-red-600")}>
                        {performanceTotals ? formatUSD(performanceTotals.realized_gain) : 'Loading...'}
                      </p>
                    </div>
                    <div>
                      <CardTitle>Income</CardTitle>
                      <p className={cn("text-2xl font-bold mt-2", performanceTotals?.dividends >= 0 ? "text-green-600" : "text-red-600")}>
                        {performanceTotals ? formatUSD(performanceTotals.dividends) : 'Loading...'}
                      </p>
                    </div>
                  </div>
                </div>
              </CardHeader>
            </Card>
          </div>

          <div>
            {/* Holdings slicers and aggregate toggle - right aligned */}
            <div className="flex flex-wrap gap-4 justify-end items-end mb-4">
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

              {/* Multi-Select Values */}
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

              {/* Aggregate Toggle */}
              {lens !== 'total' && selectedValues.length > 1 && (
                <div className="flex items-center gap-2">
                  <Switch checked={aggregate} onCheckedChange={setAggregate} />
                  <Label>Aggregate selected</Label>
                </div>
              )}
            </div>
            <Card className="mt-6 cursor-pointer mb-4" onClick={() => router.push('/dashboard/portfolio')}>
              <CardHeader>
                <CardTitle className="text-center text-4xl">
                  Current Allocation {aggregate ? '(Aggregated)' : '(Separate Comparison)'}
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="grid grid-cols-1 gap-8">
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
                            onClick={(data) => handlePieClick(data)}
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

                {drillItems.length > 0 && (
                  <div className="mt-8">
                    <h3 className="text-lg font-semibold mb-4">Holdings in Selected Slice</h3>
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Ticker</TableHead>
                          <TableHead>Name</TableHead>
                          <TableHead className="text-right">Quantity</TableHead>
                          <TableHead className="text-right">Value</TableHead>
                          <TableHead className="text-right">Net Gain</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {drillItems.map((item: any) => (
                          <TableRow key={item.ticker}>
                            <TableCell>{item.ticker}</TableCell>
                            <TableCell>{item.name || '-'}</TableCell>
                            <TableCell className="text-right">{item.quantity.toFixed(8)}</TableCell>
                            <TableCell className="text-right">{formatUSD(item.value)}</TableCell>
                            <TableCell className="text-right">{formatUSD(item.net_gain)}</TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                )}
              </CardContent>
            </Card>
          </div>
        </div>
      )}
    </main>
  );
}