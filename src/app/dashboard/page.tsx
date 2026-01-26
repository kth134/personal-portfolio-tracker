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

// Portfolio Details Card Component - handles its own loading state
function PortfolioDetailsCard({ lens, selectedValues, aggregate, refreshing }: {
  lens: string;
  selectedValues: string[];
  aggregate: boolean;
  refreshing: boolean;
}) {
  const [allocations, setAllocations] = useState<any[]>([]);
  const [allocationsLoading, setAllocationsLoading] = useState(false);
  const router = useRouter();

  // Load allocations data when dependencies change
  useEffect(() => {
    const loadAllocations = async () => {
      setAllocationsLoading(true);
      try {
        const payload = {
          lens,
          selectedValues: lens === 'total' ? [] : selectedValues,
          aggregate,
        };

        const allocRes = await fetch('/api/dashboard/allocations', {
          method: 'POST',
          body: JSON.stringify(payload),
          cache: 'no-store'
        });

        if (!allocRes.ok) throw new Error(`Allocations fetch failed: ${allocRes.status}`);
        const allocData = await allocRes.json();

        setAllocations(allocData.allocations || []);
      } catch (err) {
        console.error('Allocations fetch failed:', err);
        setAllocations([]);
      } finally {
        setAllocationsLoading(false);
      }
    };

    loadAllocations();
  }, [lens, selectedValues, aggregate]);

  const handlePieClick = (data: any) => {
    // Handle pie chart clicks for drilling down
    console.log('Pie clicked:', data);
  };

  if (allocationsLoading) {
    return (
      <Card className="cursor-pointer" onClick={() => router.push('/dashboard/portfolio')}>
        <CardHeader>
          <CardTitle className="text-center text-4xl">Portfolio Details</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="text-center py-8">Loading allocations...</div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="cursor-pointer" onClick={() => router.push('/dashboard/portfolio')}>
      <CardHeader>
        <CardTitle className="text-center text-4xl">Portfolio Details</CardTitle>
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
      </CardContent>
    </Card>
  );
}

export default function DashboardHome() {
  const supabase = createClient();
  const router = useRouter();

  // Core states from original
  const [lens, setLens] = useState('total');
  const [availableValues, setAvailableValues] = useState<{value: string, label: string}[]>([]);
  const [selectedValues, setSelectedValues] = useState<string[]>([]);
  const [aggregate, setAggregate] = useState(true);
  const [loading, setLoading] = useState(true);
  const [valuesLoading, setValuesLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [refreshMessage, setRefreshMessage] = useState<string | null>(null);
  const [performanceTotals, setPerformanceTotals] = useState<any>(null);
  const [recentTransactions, setRecentTransactions] = useState<any[]>([]);
  const [rebalancingData, setRebalancingData] = useState<any>(null);
  const [rebalancingLoading, setRebalancingLoading] = useState(true);

  // MFA states
  const [mfaStatus, setMfaStatus] = useState<'checking' | 'prompt' | 'verified' | 'none'>('checking');
  const [mfaCode, setMfaCode] = useState('');
  const [mfaError, setMfaError] = useState<string | null>(null);

  // MFA setup prompt states
  const [showMfaSetupPrompt, setShowMfaSetupPrompt] = useState(false);
  const [dontAskAgain, setDontAskAgain] = useState(false);

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
        const vals: {value: string, label: string}[] = data.values || [];
        setAvailableValues(vals);
        setSelectedValues(vals.map(item => item.value)); // default to all
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
        } else if (currentLevel === 'aal1') {
          // MFA not set up, check if we should show setup prompt
          const hasOptedOut = localStorage.getItem('mfa-setup-opted-out') === 'true';
          const promptShownThisSession = sessionStorage.getItem('mfa-setup-prompt-shown') === 'true';
          if (!hasOptedOut && !promptShownThisSession) {
            setShowMfaSetupPrompt(true);
            sessionStorage.setItem('mfa-setup-prompt-shown', 'true');
          }
          setMfaStatus('verified'); // Allow access but show prompt
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

  // Load data when MFA verified
  useEffect(() => {
    if (mfaStatus === 'verified') {
      loadDashboardData();
    }
  }, [mfaStatus]);

  const loadDashboardData = async () => {
    setLoading(true);

    try {
      // Fetch performance totals
      const { data: { user } } = await supabase.auth.getUser();
      const userId = user?.id;
      if (userId) {
        // Fetch all tax lots to calculate total original investment and market values
        const { data: allLotsData } = await supabase
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

        const totalOriginalInvestment = allLotsData?.reduce((sum, lot) => {
          return sum + (Number(lot.cost_basis_per_unit) * Number(lot.quantity || lot.remaining_quantity));
        }, 0) || 0;

        const openLots = allLotsData?.filter(lot => lot.remaining_quantity > 0) || [];
        const tickers = [
          ...new Set(
            openLots.map((lot: any) => {
              const asset = Array.isArray(lot.asset) ? lot.asset[0] : lot.asset;
              return asset?.ticker;
            }).filter(Boolean)
          ),
        ];

        const { data: pricesData } = await supabase
          .from('asset_prices')
          .select('ticker, price, timestamp')
          .in('ticker', tickers)
          .order('timestamp', { ascending: false });

        const latestPrices = new Map<string, number>();
        pricesData?.forEach((p: any) => {
          if (!latestPrices.has(p.ticker)) {
            latestPrices.set(p.ticker, Number(p.price));
          }
        });

        let marketValue = 0;
        let costBasis = 0;
        openLots.forEach((lot: any) => {
          const asset = Array.isArray(lot.asset) ? lot.asset[0] : lot.asset;
          const qty = Number(lot.remaining_quantity);
          const price = latestPrices.get(asset?.ticker || '') || 0;
          marketValue += qty * price;
          costBasis += qty * Number(lot.cost_basis_per_unit);
        });

        const unrealized = marketValue - costBasis;

        // Fetch performance summaries for all assets to sum realized, dividends, etc.
        const { data: summaries } = await supabase
          .from('performance_summaries')
          .select('realized_gain, dividends, interest, fees')
          .eq('user_id', userId)
          .eq('grouping_type', 'asset');

        const summaryTotals = summaries?.reduce(
          (acc, row) => ({
            realized_gain: acc.realized_gain + (row.realized_gain || 0),
            dividends: acc.dividends + (row.dividends || 0),
            interest: acc.interest + (row.interest || 0),
            fees: acc.fees + (row.fees || 0),
          }),
          { realized_gain: 0, dividends: 0, interest: 0, fees: 0 }
        ) || { realized_gain: 0, dividends: 0, interest: 0, fees: 0 };

        const net = unrealized + summaryTotals.realized_gain + summaryTotals.dividends + summaryTotals.interest;
        const totalReturnPct = totalOriginalInvestment > 0 ? (net / totalOriginalInvestment) * 100 : 0;

        // Calculate IRR
        let totalIrrPct = 0;
        const { data: transactionsData } = await supabase
          .from('transactions')
          .select('date, type, amount, fees, funding_source, notes, account_id')
          .eq('user_id', userId)
          .order('date');

        if (transactionsData && transactionsData.length > 0) {
          // Compute cash balances for terminal value
          const cashBalances = new Map<string, number>()
          transactionsData.forEach((tx: any) => {
            if (!tx.account_id) return
            const current = cashBalances.get(tx.account_id) || 0
            let delta = 0
            const amt = Number(tx.amount || 0)
            const fee = Number(tx.fees || 0)
            switch (tx.type) {
              case 'Buy':
                delta -= (Math.abs(amt) + fee)
                break
              case 'Sell':
                delta += (amt - fee)
                break
              case 'Dividend':
                delta += amt
                break
              case 'Interest':
                delta += amt
                break
              case 'Deposit':
                delta += amt
                break
              case 'Withdrawal':
                delta -= Math.abs(amt)
                break
            }
            const newBalance = current + delta
            cashBalances.set(tx.account_id, newBalance)
          })
          const totalCash = Array.from(cashBalances.values()).reduce((sum, bal) => sum + bal, 0)

          // Calculate IRR cash flows
          const allCashFlows: number[] = [];
          const allFlowDates: Date[] = [];

          transactionsData.forEach((tx: any) => {
            let flow = 0;
            if (tx.type === 'Buy') {
              flow = (tx.amount || 0) - (tx.fees || 0);
            } else if (tx.type === 'Deposit') {
              flow = (tx.amount || 0) - (tx.fees || 0);
            } else if (tx.type === 'Withdrawal') {
              flow = -(Math.abs(tx.amount || 0)) - (tx.fees || 0);
            }
            if (flow !== 0 && tx.date) {
              const date = new Date(tx.date);
              if (!isNaN(date.getTime())) {
                allCashFlows.push(flow);
                allFlowDates.push(date);
              }
            }
          });

          // Terminal value
          if (marketValue + totalCash > 0) {
            allCashFlows.push(marketValue + totalCash);
            allFlowDates.push(new Date());
          }

          if (allCashFlows.length >= 2 && allFlowDates.every(d => !isNaN(d.getTime()))) {
            const irr = calculateIRR(allCashFlows, allFlowDates);
            totalIrrPct = isNaN(irr) ? 0 : irr * 100;
          }
        }

        setPerformanceTotals({
          market_value: marketValue,
          net_gain: net,
          total_return_pct: totalReturnPct,
          irr_pct: totalIrrPct,
          unrealized_gain: unrealized,
          realized_gain: summaryTotals.realized_gain,
          dividends: summaryTotals.dividends,
        });

        // Fetch recent transactions
        const { data: recentTransactions } = await supabase
          .from('transactions')
          .select(`
            id,
            date,
            type,
            amount,
            funding_source,
            notes,
            asset:assets (ticker),
            account:accounts (name)
          `)
          .eq('user_id', userId)
          .order('date', { ascending: false })
          .limit(20); // Fetch more to account for filtering

        // Filter out auto-created deposits for external buys
        const filteredTransactions = recentTransactions?.filter(tx => 
          !(tx.type === 'Deposit' && tx.notes === 'Auto-deposit for external buy')
        ).slice(0, 10) || [];

        setRecentTransactions(filteredTransactions);

        // Fetch rebalancing data
        try {
          const rebalancingRes = await fetch('/api/rebalancing');
          if (rebalancingRes.ok) {
            const rebalancingData = await rebalancingRes.json();
            setRebalancingData(rebalancingData);
          }
        } catch (err) {
          console.error('Rebalancing data fetch failed:', err);
        }
      }
    } catch (err) {
      console.error('Dashboard data fetch failed:', err);
    } finally {
      setLoading(false);
      setRebalancingLoading(false);
    }
  };

  const handleRefresh = async () => {
    setRefreshing(true);
    setRefreshMessage(null);
    try {
      const result = await refreshAssetPrices();
      setRefreshMessage(result.message || 'Prices refreshed successfully!');
      // Refetch data without triggering global loading
      await loadDashboardDataForRefresh();
    } catch (err) {
      console.error('Refresh failed:', err);
      setRefreshMessage('Error refreshing prices. Check console.');
    } finally {
      setRefreshing(false);
    }
  };

  const loadDashboardDataForRefresh = async () => {
    try {
      // Fetch performance totals
      const { data: { user } } = await supabase.auth.getUser();
      const userId = user?.id;
      if (userId) {
        // Fetch all tax lots to calculate total original investment and market values
        const { data: allLotsData } = await supabase
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

        const totalOriginalInvestment = allLotsData?.reduce((sum, lot) => {
          return sum + (Number(lot.cost_basis_per_unit) * Number(lot.quantity || lot.remaining_quantity));
        }, 0) || 0;

        const openLots = allLotsData?.filter(lot => lot.remaining_quantity > 0) || [];
        const tickers = [
          ...new Set(
            openLots.map((lot: any) => {
              const asset = Array.isArray(lot.asset) ? lot.asset[0] : lot.asset;
              return asset?.ticker;
            }).filter(Boolean)
          ),
        ];

        const { data: pricesData } = await supabase
          .from('asset_prices')
          .select('ticker, price, timestamp')
          .in('ticker', tickers)
          .order('timestamp', { ascending: false });

        const latestPrices = new Map<string, number>();
        pricesData?.forEach((p: any) => {
          if (!latestPrices.has(p.ticker)) {
            latestPrices.set(p.ticker, Number(p.price));
          }
        });

        let marketValue = 0;
        let costBasis = 0;
        openLots.forEach((lot: any) => {
          const asset = Array.isArray(lot.asset) ? lot.asset[0] : lot.asset;
          const qty = Number(lot.remaining_quantity);
          const price = latestPrices.get(asset?.ticker || '') || 0;
          marketValue += qty * price;
          costBasis += qty * Number(lot.cost_basis_per_unit);
        });

        const unrealized = marketValue - costBasis;

        // Fetch performance summaries for all assets to sum realized, dividends, etc.
        const { data: summaries } = await supabase
          .from('performance_summaries')
          .select('realized_gain, dividends, interest, fees')
          .eq('user_id', userId)
          .eq('grouping_type', 'asset');

        const summaryTotals = summaries?.reduce(
          (acc, row) => ({
            realized_gain: acc.realized_gain + (row.realized_gain || 0),
            dividends: acc.dividends + (row.dividends || 0),
            interest: acc.interest + (row.interest || 0),
            fees: acc.fees + (row.fees || 0),
          }),
          { realized_gain: 0, dividends: 0, interest: 0, fees: 0 }
        ) || { realized_gain: 0, dividends: 0, interest: 0, fees: 0 };

        const net = unrealized + summaryTotals.realized_gain + summaryTotals.dividends + summaryTotals.interest;
        const totalReturnPct = totalOriginalInvestment > 0 ? (net / totalOriginalInvestment) * 100 : 0;

        // Calculate IRR
        let totalIrrPct = 0;
        const { data: transactionsData } = await supabase
          .from('transactions')
          .select('date, type, amount, fees, funding_source, notes, account_id')
          .eq('user_id', userId)
          .order('date');

        if (transactionsData && transactionsData.length > 0) {
          // Compute cash balances for terminal value
          const cashBalances = new Map<string, number>()
          transactionsData.forEach((tx: any) => {
            if (!tx.account_id) return
            const current = cashBalances.get(tx.account_id) || 0
            let delta = 0
            const amt = Number(tx.amount || 0)
            const fee = Number(tx.fees || 0)
            switch (tx.type) {
              case 'Buy':
                delta -= (Math.abs(amt) + fee)
                break
              case 'Sell':
                delta += (amt - fee)
                break
              case 'Dividend':
                delta += amt
                break
              case 'Interest':
                delta += amt
                break
              case 'Deposit':
                delta += amt
                break
              case 'Withdrawal':
                delta -= Math.abs(amt)
                break
            }
            const newBalance = current + delta
            cashBalances.set(tx.account_id, newBalance)
          })
          const totalCash = Array.from(cashBalances.values()).reduce((sum, bal) => sum + bal, 0)

          // Calculate IRR cash flows
          const allCashFlows: number[] = [];
          const allFlowDates: Date[] = [];

          transactionsData.forEach((tx: any) => {
            let flow = 0;
            if (tx.type === 'Buy') {
              flow = (tx.amount || 0) - (tx.fees || 0);
            } else if (tx.type === 'Deposit') {
              flow = (tx.amount || 0) - (tx.fees || 0);
            } else if (tx.type === 'Withdrawal') {
              flow = -(Math.abs(tx.amount || 0)) - (tx.fees || 0);
            }
            if (flow !== 0 && tx.date) {
              const date = new Date(tx.date);
              if (!isNaN(date.getTime())) {
                allCashFlows.push(flow);
                allFlowDates.push(date);
              }
            }
          });

          // Terminal value
          if (marketValue + totalCash > 0) {
            allCashFlows.push(marketValue + totalCash);
            allFlowDates.push(new Date());
          }

          if (allCashFlows.length >= 2 && allFlowDates.every(d => !isNaN(d.getTime()))) {
            const irr = calculateIRR(allCashFlows, allFlowDates);
            totalIrrPct = isNaN(irr) ? 0 : irr * 100;
          }
        }

        setPerformanceTotals({
          market_value: marketValue,
          net_gain: net,
          total_return_pct: totalReturnPct,
          irr_pct: totalIrrPct,
          unrealized_gain: unrealized,
          realized_gain: summaryTotals.realized_gain,
          dividends: summaryTotals.dividends,
        });

        // Fetch recent transactions
        const { data: recentTransactions } = await supabase
          .from('transactions')
          .select(`
            id,
            date,
            type,
            amount,
            funding_source,
            notes,
            asset:assets (ticker),
            account:accounts (name)
          `)
          .eq('user_id', userId)
          .order('date', { ascending: false })
          .limit(20); // Fetch more to account for filtering

        // Filter out auto-created deposits for external buys
        const filteredTransactions = recentTransactions?.filter(tx => 
          !(tx.type === 'Deposit' && tx.notes === 'Auto-deposit for external buy')
        ).slice(0, 10) || [];

        setRecentTransactions(filteredTransactions);
      }
    } catch (err) {
      console.error('Dashboard data refresh failed:', err);
    }
  };

  const toggleValue = (value: string) => {
    setSelectedValues(prev =>
      prev.includes(value) ? prev.filter(v => v !== value) : [...prev, value]
    );
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

  const handleMfaSetupYes = () => {
    if (dontAskAgain) {
      localStorage.setItem('mfa-setup-opted-out', 'true');
    }
    window.location.href = '/settings/mfa';
  };

  const handleMfaSetupNo = () => {
    if (dontAskAgain) {
      localStorage.setItem('mfa-setup-opted-out', 'true');
    }
    setShowMfaSetupPrompt(false);
  };

  // ── Render ──────────────────────────────────────────────────────────────

  if (mfaStatus === 'checking') {
    return <div className="container mx-auto p-6 text-center">Checking security...</div>;
  }

  if (showMfaSetupPrompt) {
    return (
      <div className="container mx-auto max-w-md p-6 space-y-6">
        <h1 className="text-2xl font-bold">Enhance Your Security</h1>
        <p className="text-muted-foreground">
          Would you like to set up Multi-Factor Authentication (MFA) for added security on future logins?
        </p>
        <div className="space-y-4">
          <div className="flex items-center space-x-2">
            <input
              type="checkbox"
              id="dont-ask-again"
              checked={dontAskAgain}
              onChange={(e) => setDontAskAgain(e.target.checked)}
              className="rounded"
            />
            <label htmlFor="dont-ask-again" className="text-sm text-muted-foreground">
              Don't ask me this again
            </label>
          </div>
          <div className="flex space-x-3">
            <Button onClick={handleMfaSetupYes} className="flex-1">
              Yes, Set Up MFA
            </Button>
            <Button onClick={handleMfaSetupNo} variant="outline" className="flex-1">
              Not Now
            </Button>
          </div>
        </div>
      </div>
    );
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
      <div className="mb-8">
        <div className="text-center mb-6">
          <h1 className="text-4xl font-bold">Portfolio Dashboard</h1>
        </div>

        {/* Controls section - Desktop only */}
        <div className="hidden md:flex justify-between items-center">
          <div className="flex items-center gap-4">
            <Button onClick={handleRefresh} disabled={refreshing}>
              {refreshing ? 'Refreshing...' : 'Refresh Prices'}
            </Button>
            {refreshMessage && <span className="text-sm text-green-600">{refreshMessage}</span>}
          </div>

          <div className="flex flex-wrap gap-4 items-center">
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
                          {availableValues.map(item => (
                            <CommandItem key={item.value} onSelect={() => toggleValue(item.value)}>
                              <Check className={cn("mr-2 h-4 w-4", selectedValues.includes(item.value) ? "opacity-100" : "opacity-0")} />
                              {item.label}
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
        </div>

        {/* Mobile Refresh Prices Button - above Performance card */}
        <div className="md:hidden mb-8">
          <div className="flex items-center justify-center gap-4">
            <Button onClick={handleRefresh} disabled={refreshing}>
              {refreshing ? 'Refreshing...' : 'Refresh Prices'}
            </Button>
            {refreshMessage && <span className="text-sm text-green-600">{refreshMessage}</span>}
          </div>
        </div>
      </div>
      {loading ? (
        <div className="text-center py-12">Loading portfolio data...</div>
      ) : selectedValues.length === 0 && lens !== 'total' && !valuesLoading ? (
        <div className="text-center py-12 text-muted-foreground">Select at least one value to view data.</div>
      ) : (
        <>
          {/* Desktop Layout */}
          <div className="hidden md:block">
          <div className="grid grid-cols-2 gap-8">
            <div className="space-y-8">
              <Card className="cursor-pointer" onClick={() => router.push('/dashboard/performance')}>
                <CardHeader>
                  <CardTitle className="text-center text-4xl">Performance</CardTitle>
                  <div className="text-center mt-4">
                    <CardTitle className="text-lg">Total Portfolio Value</CardTitle>
                    <p className="text-3xl font-bold text-black mt-2">
                      {performanceTotals ? formatUSD(performanceTotals.market_value) : 'Loading...'}
                    </p>
                  </div>
                  <div className="grid grid-cols-2 gap-8 mt-6">
                    <div className="space-y-6">
                      <div className="text-center">
                        <CardTitle>Net Gain/Loss</CardTitle>
                        <p className={cn("text-2xl font-bold mt-2", performanceTotals?.net_gain >= 0 ? "text-green-600" : "text-red-600")}>
                          {performanceTotals ? formatUSD(performanceTotals.net_gain) : 'Loading...'}
                        </p>
                      </div>
                      <div className="text-center">
                        <CardTitle>Total Return %</CardTitle>
                        <p className={cn("text-2xl font-bold mt-2", performanceTotals?.total_return_pct >= 0 ? "text-green-600" : "text-red-600")}>
                          {performanceTotals ? `${performanceTotals.total_return_pct.toFixed(2)}%` : 'Loading...'}
                        </p>
                      </div>
                      <div className="text-center">
                        <CardTitle>Annualized IRR</CardTitle>
                        <p className={cn("text-2xl font-bold mt-2", (performanceTotals?.irr_pct || 0) >= 0 ? "text-green-600" : "text-red-600")}>
                          {performanceTotals ? `${(performanceTotals.irr_pct || 0).toFixed(2)}%` : 'Loading...'}
                        </p>
                      </div>
                    </div>
                    <div className="space-y-6">
                      <div className="text-center">
                        <CardTitle>Unrealized G/L</CardTitle>
                        <p className={cn("text-2xl font-bold mt-2", performanceTotals?.unrealized_gain >= 0 ? "text-green-600" : "text-red-600")}>
                          {performanceTotals ? formatUSD(performanceTotals.unrealized_gain) : 'Loading...'}
                        </p>
                      </div>
                      <div className="text-center">
                        <CardTitle>Realized G/L</CardTitle>
                        <p className={cn("text-2xl font-bold mt-2", performanceTotals?.realized_gain >= 0 ? "text-green-600" : "text-red-600")}>
                          {performanceTotals ? formatUSD(performanceTotals.realized_gain) : 'Loading...'}
                        </p>
                      </div>
                      <div className="text-center">
                        <CardTitle>Income</CardTitle>
                        <p className={cn("text-2xl font-bold mt-2", performanceTotals?.dividends >= 0 ? "text-green-600" : "text-red-600")}>
                          {performanceTotals ? formatUSD(performanceTotals.dividends) : 'Loading...'}
                        </p>
                      </div>
                    </div>
                  </div>
                </CardHeader>
              </Card>
              <Card className="cursor-pointer" onClick={() => router.push('/dashboard/strategy?tab=rebalancing')}>
                <CardHeader>
                  <CardTitle className="text-center text-4xl">Strategy</CardTitle>
                </CardHeader>
                <CardContent>
                  {rebalancingLoading ? (
                    <p>Loading strategy data...</p>
                  ) : rebalancingData ? (
                    <div className="space-y-4">
                      {/* Top Metrics in 3 columns */}
                      <div className="grid grid-cols-3 gap-4">
                        <div className="text-center">
                          <h4 className="font-semibold text-sm text-muted-foreground">Portfolio Drift</h4>
                          <div className="grid grid-cols-2 gap-2 mt-2">
                            <div className="text-center">
                              <p className="text-xs text-muted-foreground">Sub-Portfolio</p>
                              <p className="text-sm font-bold">
                                {(() => {
                                  // Calculate sub-portfolio relative drift from target allocations
                                  const subPortfolioAllocations: { [key: string]: number } = {}
                                  rebalancingData.currentAllocations.forEach((item: any) => {
                                    const subId = item.sub_portfolio_id || 'unassigned'
                                    subPortfolioAllocations[subId] = (subPortfolioAllocations[subId] || 0) + item.current_value
                                  })

                                  let totalWeightedDrift = 0
                                  let totalValue = 0

                                  rebalancingData.subPortfolios.forEach((sp: any) => {
                                    const currentValue = subPortfolioAllocations[sp.id] || 0
                                    const currentAllocation = rebalancingData.totalValue > 0 ? (currentValue / rebalancingData.totalValue) * 100 : 0
                                    const targetAllocation = sp.target_allocation
                                    
                                    // Calculate relative drift: |(actual - target) / target|
                                    const relativeDrift = targetAllocation > 0 ? Math.abs((currentAllocation - targetAllocation) / targetAllocation) : 0
                                    
                                    totalWeightedDrift += relativeDrift * currentValue
                                    totalValue += currentValue
                                  })

                                  return (totalValue > 0 ? totalWeightedDrift / totalValue * 100 : 0).toFixed(2) + '%'
                                })()}
                              </p>
                            </div>
                            <div className="text-center">
                              <p className="text-xs text-muted-foreground">Asset</p>
                              <p className="text-sm font-bold">
                                {(() => {
                                  const assetDrift = rebalancingData.totalValue > 0 
                                    ? rebalancingData.currentAllocations.reduce((sum: number, item: any) => {
                                        const weight = item.current_value / rebalancingData.totalValue
                                        return sum + (Math.abs(item.drift_percentage) * weight)
                                      }, 0)
                                    : 0
                                  return assetDrift.toFixed(2) + '%'
                                })()}
                              </p>
                            </div>
                          </div>
                        </div>
                        <div className="text-center">
                          <h4 className="font-semibold text-sm text-muted-foreground">Rebalance Needed</h4>
                          <p className="text-xl font-bold">
                            {rebalancingData.currentAllocations.some((item: any) => item.action !== 'hold') ? (
                              <span className="text-yellow-600">Yes</span>
                            ) : (
                              'No'
                            )}
                          </p>
                        </div>
                        <div className="text-center">
                          <h4 className="font-semibold text-sm text-muted-foreground">Magnitude of Rebalance Actions (Net)</h4>
                          <p className={cn("text-xl font-bold", rebalancingData.cashNeeded > 0 ? "text-red-600" : "text-green-600")}>
                            {formatUSD(Math.abs(rebalancingData.cashNeeded))}
                          </p>
                        </div>
                      </div>

                      {/* Sub-Portfolios Table */}
                      <div>
                        <h4 className="font-semibold mb-2">Sub-Portfolios</h4>
                        <div className="max-h-48 overflow-y-auto overflow-x-auto">
                          <Table>
                            <TableHeader>
                              <TableRow>
                                <TableHead className="text-center break-words">Name</TableHead>
                                <TableHead className="text-center break-words">Current Value</TableHead>
                                <TableHead className="text-center break-words">Target Allocation</TableHead>
                                <TableHead className="text-center break-words">Actual Allocation</TableHead>
                                <TableHead className="text-center break-words">Asset-Level Drift</TableHead>
                              </TableRow>
                            </TableHeader>
                            <TableBody>
                              {(() => {
                                // Group allocations by sub_portfolio_id
                                const grouped = new Map()
                                rebalancingData.currentAllocations.forEach((item: any) => {
                                  const key = item.sub_portfolio_id || 'unassigned'
                                  if (!grouped.has(key)) grouped.set(key, [])
                                  grouped.get(key).push(item)
                                })

                                // Calculate sub-portfolio data and sort by current value descending
                                const subPortfolios = Array.from(grouped.entries()).map(([id, allocations]) => {
                                  const subPortfolio = rebalancingData.subPortfolios.find((sp: any) => sp.id === id)
                                  const name = subPortfolio?.name || 'Unassigned'
                                  const target = subPortfolio?.target_allocation || 0
                                  const currentValue = allocations.reduce((sum: number, item: any) => sum + item.current_value, 0)
                                  const currentPct = rebalancingData.totalValue > 0 ? (currentValue / rebalancingData.totalValue) * 100 : 0
                                  const assetLevelDrift = currentValue > 0 ? allocations.reduce((sum: number, item: any) => sum + (Math.abs(item.drift_percentage) * item.current_value), 0) / currentValue : 0
                                  return { name, target, currentValue, currentPct, assetLevelDrift }
                                }).sort((a, b) => b.currentValue - a.currentValue)

                                return subPortfolios.map((sp, idx) => (
                                  <TableRow key={idx}>
                                    <TableCell className="text-center font-medium break-words">{sp.name}</TableCell>
                                    <TableCell className="text-center break-words">{formatUSD(sp.currentValue)}</TableCell>
                                    <TableCell className="text-center break-words">{sp.target.toFixed(1)}%</TableCell>
                                    <TableCell className="text-center break-words">{sp.currentPct.toFixed(1)}%</TableCell>
                                    <TableCell className="text-center break-words">{sp.assetLevelDrift.toFixed(1)}%</TableCell>
                                  </TableRow>
                                ))
                              })()}
                            </TableBody>
                          </Table>
                        </div>
                      </div>
                    </div>
                  ) : (
                    <p>Failed to load strategy data</p>
                  )}
                </CardContent>
              </Card>
            </div>

            {/* Mobile Slicers - positioned between Strategy and Portfolio Details */}
            <div className="md:hidden mt-8 mb-8">
              <div className="flex flex-wrap gap-4 items-center justify-end">
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
                              {availableValues.map(item => (
                                <CommandItem key={item.value} onSelect={() => toggleValue(item.value)}>
                                  <Check className={cn("mr-2 h-4 w-4", selectedValues.includes(item.value) ? "opacity-100" : "opacity-0")} />
                                {item.label}
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
          </div>

          <div className="space-y-8">
            <PortfolioDetailsCard lens={lens} selectedValues={selectedValues} aggregate={aggregate} refreshing={refreshing} />
              <Card className="cursor-pointer" onClick={() => router.push('/dashboard/transactions')}>
                <CardHeader>
                  <CardTitle className="text-center text-4xl">Recent Activity</CardTitle>
                </CardHeader>
                <CardContent>
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead className="text-center">Date</TableHead>
                        <TableHead className="text-center">Account</TableHead>
                        <TableHead className="text-center">Ticker</TableHead>
                        <TableHead className="text-center">Type</TableHead>
                        <TableHead className="text-center">Amount</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {recentTransactions.map((tx) => (
                        <TableRow key={tx.id}>
                          <TableCell className="text-center">{tx.date}</TableCell>
                          <TableCell className="text-center">{tx.account?.name || ''}</TableCell>
                          <TableCell className="text-center">{tx.asset?.ticker || ''}</TableCell>
                          <TableCell className="text-center">{tx.type}</TableCell>
                          <TableCell className="text-center">{formatUSD(tx.amount)}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </CardContent>
              </Card>
            </div>
          </div>
        </div>

        {/* Mobile Layout */}
        <div className="md:hidden">
          <div className="space-y-8">
            <Card className="cursor-pointer" onClick={() => router.push('/dashboard/performance')}>
              <CardHeader>
                <CardTitle className="text-center text-4xl">Performance</CardTitle>
                <div className="text-center mt-4">
                  <CardTitle className="text-lg">Total Portfolio Value</CardTitle>
                  <p className="text-3xl font-bold text-black mt-2">
                    {performanceTotals ? formatUSD(performanceTotals.market_value) : 'Loading...'}
                  </p>
                </div>
                <div className="grid grid-cols-2 gap-8 mt-6">
                  <div className="space-y-6">
                    <div className="text-center">
                      <CardTitle>Net Gain/Loss</CardTitle>
                      <p className={cn("text-2xl font-bold mt-2", performanceTotals?.net_gain >= 0 ? "text-green-600" : "text-red-600")}>
                        {performanceTotals ? formatUSD(performanceTotals.net_gain) : 'Loading...'}
                      </p>
                    </div>
                    <div className="text-center">
                      <CardTitle>Total Return %</CardTitle>
                      <p className={cn("text-2xl font-bold mt-2", performanceTotals?.total_return_pct >= 0 ? "text-green-600" : "text-red-600")}>
                        {performanceTotals ? `${performanceTotals.total_return_pct.toFixed(2)}%` : 'Loading...'}
                      </p>
                    </div>
                    <div className="text-center">
                      <CardTitle>Annualized IRR</CardTitle>
                      <p className={cn("text-2xl font-bold mt-2", (performanceTotals?.irr_pct || 0) >= 0 ? "text-green-600" : "text-red-600")}>
                        {performanceTotals ? `${(performanceTotals.irr_pct || 0).toFixed(2)}%` : 'Loading...'}
                      </p>
                    </div>
                  </div>
                  <div className="space-y-6">
                    <div className="text-center">
                      <CardTitle>Unrealized G/L</CardTitle>
                      <p className={cn("text-2xl font-bold mt-2", performanceTotals?.unrealized_gain >= 0 ? "text-green-600" : "text-red-600")}>
                        {performanceTotals ? formatUSD(performanceTotals.unrealized_gain) : 'Loading...'}
                      </p>
                    </div>
                    <div className="text-center">
                      <CardTitle>Realized G/L</CardTitle>
                      <p className={cn("text-2xl font-bold mt-2", performanceTotals?.realized_gain >= 0 ? "text-green-600" : "text-red-600")}>
                        {performanceTotals ? formatUSD(performanceTotals.realized_gain) : 'Loading...'}
                      </p>
                    </div>
                    <div className="text-center">
                      <CardTitle>Income</CardTitle>
                      <p className={cn("text-2xl font-bold mt-2", performanceTotals?.dividends >= 0 ? "text-green-600" : "text-red-600")}>
                        {performanceTotals ? formatUSD(performanceTotals.dividends) : 'Loading...'}
                      </p>
                    </div>
                  </div>
                </div>
              </CardHeader>
            </Card>
            <Card className="cursor-pointer" onClick={() => router.push('/dashboard/strategy?tab=rebalancing')}>
              <CardHeader>
                <CardTitle className="text-center text-4xl">Strategy</CardTitle>
              </CardHeader>
              <CardContent>
                {rebalancingLoading ? (
                  <p>Loading strategy data...</p>
                ) : rebalancingData ? (
                  <div className="space-y-4">
                    {/* Top Metrics in 3 columns */}
                    <div className="grid grid-cols-3 gap-4">
                      <div className="text-center">
                        <h4 className="font-semibold text-sm text-muted-foreground">Portfolio Drift</h4>
                        <div className="grid grid-cols-2 gap-2 mt-2">
                          <div className="text-center">
                            <p className="text-xs text-muted-foreground">Sub-Portfolio</p>
                            <p className="text-sm font-bold">
                              {(() => {
                                // Calculate sub-portfolio relative drift from target allocations
                                const subPortfolioAllocations: { [key: string]: number } = {}
                                rebalancingData.currentAllocations.forEach((item: any) => {
                                  const subId = item.sub_portfolio_id || 'unassigned'
                                  subPortfolioAllocations[subId] = (subPortfolioAllocations[subId] || 0) + item.current_value
                                })

                                let totalWeightedDrift = 0
                                let totalValue = 0

                                rebalancingData.subPortfolios.forEach((sp: any) => {
                                  const currentValue = subPortfolioAllocations[sp.id] || 0
                                  const currentAllocation = rebalancingData.totalValue > 0 ? (currentValue / rebalancingData.totalValue) * 100 : 0
                                  const targetAllocation = sp.target_allocation
                                  
                                  // Calculate relative drift: |(actual - target) / target|
                                  const relativeDrift = targetAllocation > 0 ? Math.abs((currentAllocation - targetAllocation) / targetAllocation) : 0
                                  
                                  totalWeightedDrift += relativeDrift * currentValue
                                  totalValue += currentValue
                                })

                                return (totalValue > 0 ? totalWeightedDrift / totalValue * 100 : 0).toFixed(2) + '%'
                              })()}
                            </p>
                          </div>
                          <div className="text-center">
                            <p className="text-xs text-muted-foreground">Asset</p>
                            <p className="text-sm font-bold">
                              {(() => {
                                const assetDrift = rebalancingData.totalValue > 0 
                                  ? rebalancingData.currentAllocations.reduce((sum: number, item: any) => {
                                      const weight = item.current_value / rebalancingData.totalValue
                                      return sum + (Math.abs(item.drift_percentage) * weight)
                                    }, 0)
                                  : 0
                                return assetDrift.toFixed(2) + '%'
                              })()}
                            </p>
                          </div>
                        </div>
                      </div>
                      <div className="text-center">
                        <h4 className="font-semibold text-sm text-muted-foreground">Rebalance Needed</h4>
                        <p className="text-xl font-bold">
                          {rebalancingData.currentAllocations.some((item: any) => item.action !== 'hold') ? (
                            <span className="text-yellow-600">Yes</span>
                          ) : (
                            'No'
                          )}
                        </p>
                      </div>
                      <div className="text-center">
                        <h4 className="font-semibold text-sm text-muted-foreground">Magnitude of Rebalance Actions (Net)</h4>
                        <p className={cn("text-xl font-bold", rebalancingData.cashNeeded > 0 ? "text-red-600" : "text-green-600")}>
                          {formatUSD(Math.abs(rebalancingData.cashNeeded))}
                        </p>
                      </div>
                    </div>

                    {/* Sub-Portfolios Table */}
                    <div>
                      <h4 className="font-semibold mb-2">Sub-Portfolios</h4>
                      <div className="max-h-48 overflow-y-auto overflow-x-auto">
                        <Table>
                          <TableHeader>
                            <TableRow>
                              <TableHead className="text-center break-words">Name</TableHead>
                              <TableHead className="text-center break-words">Current Value</TableHead>
                              <TableHead className="text-center break-words">Target Allocation</TableHead>
                              <TableHead className="text-center break-words">Actual Allocation</TableHead>
                              <TableHead className="text-center break-words">Asset-Level Drift</TableHead>
                            </TableRow>
                          </TableHeader>
                          <TableBody>
                            {(() => {
                              // Group allocations by sub_portfolio_id
                              const grouped = new Map()
                              rebalancingData.currentAllocations.forEach((item: any) => {
                                const key = item.sub_portfolio_id || 'unassigned'
                                if (!grouped.has(key)) grouped.set(key, [])
                                grouped.get(key).push(item)
                              })

                              // Calculate sub-portfolio data and sort by current value descending
                              const subPortfolios = Array.from(grouped.entries()).map(([id, allocations]) => {
                                const subPortfolio = rebalancingData.subPortfolios.find((sp: any) => sp.id === id)
                                const name = subPortfolio?.name || 'Unassigned'
                                const target = subPortfolio?.target_allocation || 0
                                const currentValue = allocations.reduce((sum: number, item: any) => sum + item.current_value, 0)
                                const currentPct = rebalancingData.totalValue > 0 ? (currentValue / rebalancingData.totalValue) * 100 : 0
                                const assetLevelDrift = currentValue > 0 ? allocations.reduce((sum: number, item: any) => sum + (Math.abs(item.drift_percentage) * item.current_value), 0) / currentValue : 0
                                return { name, target, currentValue, currentPct, assetLevelDrift }
                              }).sort((a, b) => b.currentValue - a.currentValue)

                              return subPortfolios.map((sp, idx) => (
                                <TableRow key={idx}>
                                  <TableCell className="text-center font-medium break-words">{sp.name}</TableCell>
                                  <TableCell className="text-center break-words">{formatUSD(sp.currentValue)}</TableCell>
                                  <TableCell className="text-center break-words">{sp.target.toFixed(1)}%</TableCell>
                                  <TableCell className="text-center break-words">{sp.currentPct.toFixed(1)}%</TableCell>
                                  <TableCell className="text-center break-words">{sp.assetLevelDrift.toFixed(1)}%</TableCell>
                                </TableRow>
                              ))
                            })()}
                          </TableBody>
                        </Table>
                      </div>
                    </div>
                  </div>
                ) : (
                  <p>Failed to load strategy data</p>
                )}
              </CardContent>
            </Card>

            {/* Mobile Slicers - positioned between Strategy and Portfolio Details */}
            <div className="mt-8 mb-8">
              <div className="flex flex-wrap gap-4 items-center justify-center">
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
                              {availableValues.map(item => (
                                <CommandItem key={item.value} onSelect={() => toggleValue(item.value)}>
                                  <Check className={cn("mr-2 h-4 w-4", selectedValues.includes(item.value) ? "opacity-100" : "opacity-0")} />
                                  {item.label}
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
            </div>

            <PortfolioDetailsCard lens={lens} selectedValues={selectedValues} aggregate={aggregate} refreshing={refreshing} />
            <Card className="cursor-pointer" onClick={() => router.push('/dashboard/transactions')}>
              <CardHeader>
                <CardTitle className="text-center text-4xl">Recent Activity</CardTitle>
              </CardHeader>
              <CardContent>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="text-center">Date</TableHead>
                      <TableHead className="text-center">Account</TableHead>
                      <TableHead className="text-center">Ticker</TableHead>
                      <TableHead className="text-center">Type</TableHead>
                      <TableHead className="text-center">Amount</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {recentTransactions.map((tx) => (
                      <TableRow key={tx.id}>
                        <TableCell className="text-center">{tx.date}</TableCell>
                        <TableCell className="text-center">{tx.account?.name || ''}</TableCell>
                        <TableCell className="text-center">{tx.asset?.ticker || ''}</TableCell>
                        <TableCell className="text-center">{tx.type}</TableCell>
                        <TableCell className="text-center">{formatUSD(tx.amount)}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          </div>
        </div>
        </>
      )}
    </main>
  );
}