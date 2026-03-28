'use client';

import { useState, useEffect, useCallback } from 'react';
import type { ChangeEvent, ReactNode } from 'react';
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
import { Check, ChevronsUpDown, ChevronDown, RefreshCw } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { refreshAssetPrices } from '@/app/dashboard/portfolio/actions';
import { cn } from '@/lib/utils';
import { createClient } from '@/lib/supabase/client';
import { useRouter } from 'next/navigation';
import { calculateIRR, calculateCashBalances, transactionFlowForIRR, netCashFlowsByDate, fetchAllUserTransactions } from '@/lib/finance';

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

type SelectOption = { value: string; label: string };

type AllocationChartPoint = {
  value: number;
  subkey: string;
};

type AllocationSlice = {
  key: string;
  data: AllocationChartPoint[];
};

type PerformanceTotals = {
  market_value: number;
  net_gain: number;
  total_return_pct: number;
  irr_pct: number;
  unrealized_gain: number;
  realized_gain: number;
  dividends: number;
};

type PerformanceSummaryTotals = {
  realized_gain: number;
  dividends: number;
  interest: number;
  fees: number;
};

type Relation<T> = T | T[] | null;

type AssetRelation = {
  id?: string;
  ticker?: string | null;
  name?: string | null;
  asset_type?: string | null;
  asset_subtype?: string | null;
  geography?: string | null;
  size_tag?: string | null;
  factor_tag?: string | null;
  sub_portfolio_id?: string | null;
};

type AccountRelation = {
  name?: string | null;
};

type TaxLotRow = {
  asset_id: string;
  account_id: string | null;
  remaining_quantity: number | string | null;
  cost_basis_per_unit: number | string | null;
  quantity: number | string | null;
  asset: Relation<AssetRelation>;
};

type AssetPriceRow = {
  ticker: string;
  price: number | string | null;
  timestamp: string;
};

type PerformanceSummaryRow = {
  realized_gain: number | null;
  dividends: number | null;
  interest: number | null;
  fees: number | null;
};

type RecentTransactionRow = {
  id: string;
  date: string;
  type: string;
  amount: number | string;
  funding_source?: string | null;
  notes?: string | null;
  asset: AssetRelation | null;
  account: AccountRelation | null;
};

type RebalancingSubPortfolio = {
  id: string;
  name: string;
  target_allocation: number;
};

type RebalancingCurrentAllocation = {
  sub_portfolio_id: string | null;
  current_value: number;
  action: string;
  current_percentage?: number | null;
  implied_overall_target?: number | null;
  drift_percentage: number;
};

type RebalancingData = {
  totalValue: number;
  currentAllocations: RebalancingCurrentAllocation[];
  subPortfolios: RebalancingSubPortfolio[];
};

type IrrTransaction = Parameters<typeof transactionFlowForIRR>[0] & {
  type: string;
  date: string;
};

const unwrapRelation = <T,>(value: Relation<T> | undefined): T | null => {
  if (Array.isArray(value)) return value[0] ?? null;
  return value ?? null;
};

const normalizeRecentTransaction = (tx: {
  id: string;
  date: string;
  type: string;
  amount: number | string;
  funding_source?: string | null;
  notes?: string | null;
  asset?: Relation<AssetRelation>;
  account?: Relation<AccountRelation>;
}): RecentTransactionRow => ({
  ...tx,
  asset: unwrapRelation(tx.asset),
  account: unwrapRelation(tx.account),
});

const formatUSDWhole = (value: number | null | undefined) => {
  const num = Math.round(Number(value) || 0);
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(num);
};
const formatPctTenth = (value: number | null | undefined) => `${(Number(value) || 0).toFixed(1)}%`;

const RADIAN = Math.PI / 180;

type PiePercentageLabelProps = {
  cx?: number;
  cy?: number;
  midAngle?: number;
  innerRadius?: number;
  outerRadius?: number;
  percent?: number;
};

const renderPiePercentageLabel = ({
  cx = 0,
  cy = 0,
  midAngle = 0,
  innerRadius = 0,
  outerRadius = 0,
  percent = 0,
}: PiePercentageLabelProps) => {
  if (!percent || percent < 0.04) return null;

  const radius = innerRadius + (outerRadius - innerRadius) * 0.58;
  const x = cx + radius * Math.cos(-midAngle * RADIAN);
  const y = cy + radius * Math.sin(-midAngle * RADIAN);

  return (
    <text
      x={x}
      y={y}
      fill="white"
      textAnchor={x > cx ? 'start' : 'end'}
      dominantBaseline="central"
      className="text-[11px] font-semibold"
    >
      {`${(percent * 100).toFixed(1)}%`}
    </text>
  );
};

function MetricChip({ label, value, valueClassName }: { label: string; value: string; valueClassName?: string }) {
  return (
    <div className="rounded border border-zinc-300 bg-white px-2 py-1 text-center">
      <div className="text-zinc-500">{label}</div>
      <div className={cn('font-semibold tabular-nums leading-tight', valueClassName)}>{value}</div>
    </div>
  );
}

function DashboardSection({
  title,
  defaultOpen = false,
  mobileDefaultOpen,
  desktopDefaultOpen,
  children,
}: {
  title: string;
  defaultOpen?: boolean;
  mobileDefaultOpen?: boolean;
  desktopDefaultOpen?: boolean;
  children: ReactNode;
}) {
  const [isOpen, setIsOpen] = useState(() => {
    if (typeof window === 'undefined') return defaultOpen;

    return window.matchMedia('(max-width: 767px)').matches
      ? (mobileDefaultOpen ?? defaultOpen)
      : (desktopDefaultOpen ?? defaultOpen);
  });

  return (
    <details
      open={isOpen}
      onToggle={(event) => setIsOpen(event.currentTarget.open)}
      className="group rounded-xl border bg-background shadow-sm overflow-hidden"
    >
      <summary className="flex cursor-pointer list-none items-center justify-between gap-3 bg-zinc-50/70 px-4 py-3">
        <span className="text-xl font-bold">{title}</span>
        <span className="inline-flex items-center gap-2 text-[11px] font-semibold uppercase tracking-wide text-zinc-500">
          <span className="hidden sm:inline">Expand / Collapse</span>
          <ChevronDown className="h-4 w-4 transition-transform group-open:rotate-180" />
        </span>
      </summary>
      <div className="px-4 pb-4 space-y-4">{children}</div>
    </details>
  );
}

// use centralized calculateIRR and normalizeTransactionToFlow from src/lib/finance

// Portfolio Details Card Component - handles its own loading state
function PortfolioDetailsCard({ lens, selectedValues, aggregate }: {
  lens: string;
  selectedValues: string[];
  aggregate: boolean;
}) {
  const [allocations, setAllocations] = useState<AllocationSlice[]>([]);
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
        const allocData = await allocRes.json() as { allocations?: AllocationSlice[] };

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

  const handlePieClick = (_data?: unknown) => {
    // Handle pie chart clicks for drilling down
  };

  if (allocationsLoading) {
    return (
      <Card className="cursor-pointer rounded-xl border shadow-sm" onClick={() => router.push('/dashboard/portfolio')}>
        <CardHeader>
          <CardTitle className="text-center text-2xl">Portfolio Details</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="text-center py-8">Loading allocations...</div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="cursor-pointer rounded-xl border shadow-sm" onClick={() => router.push('/dashboard/portfolio')}>
      <CardHeader>
        <CardTitle className="text-center text-2xl">Portfolio Details</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="grid grid-cols-1 gap-8">
          {allocations.map((slice, idx) => (
            <div key={idx} className="space-y-4">
              <h4 className="font-medium text-center">{slice.key}</h4>
              <ResponsiveContainer width="100%" height={320}>
                <PieChart margin={{ top: 8, right: 12, left: 12, bottom: 28 }}>
                  <Pie
                    data={slice.data}
                    dataKey="value"
                    nameKey="subkey"
                    outerRadius={88}
                    label={renderPiePercentageLabel}
                    labelLine={false}
                    onClick={(data) => handlePieClick(data)}
                  >
                    {slice.data.map((_, i: number) => (
                      <Cell key={`cell-${i}`} fill={COLORS[i % COLORS.length]} />
                    ))}
                  </Pie>
                  <Tooltip formatter={(v: number | undefined) => v !== undefined ? formatUSDWhole(v) : ''} />
                  <Legend
                    verticalAlign="bottom"
                    align="center"
                    iconSize={10}
                    wrapperStyle={{ paddingTop: 14, fontSize: '12px', lineHeight: '16px' }}
                  />
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
  const [supabase] = useState(() => createClient());
  const router = useRouter();

  // Core states from original
  const [lens, setLens] = useState('total');
  const [availableValues, setAvailableValues] = useState<SelectOption[]>([]);
  const [selectedValues, setSelectedValues] = useState<string[]>([]);
  const [aggregate, setAggregate] = useState(true);
  const [loading, setLoading] = useState(true);
  const [valuesLoading, setValuesLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [refreshMessage, setRefreshMessage] = useState<string | null>(null);
  const [performanceTotals, setPerformanceTotals] = useState<PerformanceTotals | null>(null);
  const [recentTransactions, setRecentTransactions] = useState<RecentTransactionRow[]>([]);
  const [rebalancingData, setRebalancingData] = useState<RebalancingData | null>(null);
  const [rebalancingLoading, setRebalancingLoading] = useState(true);

  // MFA states
  const [mfaStatus, setMfaStatus] = useState<'checking' | 'prompt' | 'verified' | 'none'>('checking');
  const [mfaCode, setMfaCode] = useState('');
  const [mfaError, setMfaError] = useState<string | null>(null);

  // MFA setup prompt states
  const [showMfaSetupPrompt, setShowMfaSetupPrompt] = useState(false);
  const [dontAskAgain, setDontAskAgain] = useState(false);

  const getSelectionValue = useCallback(
    (item: SelectOption) => ((lens === 'account' || lens === 'sub_portfolio') ? (item.label ?? item.value) : item.value),
    [lens]
  );

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
        const data = await res.json() as { values?: SelectOption[] };
        const vals: SelectOption[] = data.values || [];
        setAvailableValues(vals);
        setSelectedValues(Array.from(new Set(vals.map(item => getSelectionValue(item))))); // default to all
      } catch (err) {
        console.error('Failed to load lens values:', err);
      } finally {
        setValuesLoading(false);
      }
    };
    fetchValues();
  }, [getSelectionValue, lens]);

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
  }, [supabase]);

  const loadDashboardData = useCallback(async () => {
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

        const typedLots = (allLotsData ?? []) as TaxLotRow[];
        const openLots = typedLots.filter(lot => Number(lot.remaining_quantity) > 0);
        const tickers = [
          ...new Set(
            openLots.map((lot) => {
              const asset = unwrapRelation(lot.asset);
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
        const typedPrices = (pricesData ?? []) as AssetPriceRow[];
        typedPrices.forEach((p) => {
          if (!latestPrices.has(p.ticker)) {
            latestPrices.set(p.ticker, Number(p.price));
          }
        });

        let marketValue = 0;
        let costBasis = 0;
        openLots.forEach((lot) => {
          const asset = unwrapRelation(lot.asset);
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

        const typedSummaries = (summaries ?? []) as PerformanceSummaryRow[];
        const summaryTotals = typedSummaries.reduce<PerformanceSummaryTotals>(
          (acc, row) => ({
            realized_gain: acc.realized_gain + (row.realized_gain || 0),
            dividends: acc.dividends + (row.dividends || 0),
            interest: acc.interest + (row.interest || 0),
            fees: acc.fees + (row.fees || 0),
          }),
          { realized_gain: 0, dividends: 0, interest: 0, fees: 0 }
        );

        const net = unrealized + summaryTotals.realized_gain + summaryTotals.dividends + summaryTotals.interest;
        const totalReturnPct = totalOriginalInvestment > 0 ? (net / totalOriginalInvestment) * 100 : 0;

        // Calculate IRR
        let totalIrrPct = 0;
        const transactionsData = await fetchAllUserTransactions() as IrrTransaction[] | null;

        if (transactionsData && transactionsData.length > 0) {
          // Compute cash balances for terminal value using centralized helper
          const { totalCash } = calculateCashBalances(transactionsData);

          // Build external-only cash flows (Deposits/Withdrawals/Dividend/Interest)
          // using canonical IRR sign mapping and net same-day flows before solving.
          const externalTypes = ['Deposit', 'Withdrawal', 'Dividend', 'Interest'];
          const txFlows: number[] = [];
          const txDates: Date[] = [];
          transactionsData.forEach((tx) => {
            if (!externalTypes.includes(tx.type)) return; // total IRR considers external flows only
            const date = new Date(tx.date);
            if (isNaN(date.getTime())) return;
            txFlows.push(transactionFlowForIRR(tx));
            txDates.push(date);
          });

          // Net same-day flows to reduce noise and match PerformanceContent behavior
          const { netFlows, netDates } = netCashFlowsByDate(txFlows, txDates);

          // Terminal value (what everything is worth today)
          if (marketValue + totalCash > 0) {
            netFlows.push(marketValue + totalCash);
            netDates.push(new Date());
          }

          if (netFlows.length >= 2 && netDates.every(d => !isNaN(d.getTime()))) {
            const irr = calculateIRR(netFlows, netDates);
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
        const filteredTransactions = ((recentTransactions ?? []) as Array<{
          id: string;
          date: string;
          type: string;
          amount: number | string;
          funding_source?: string | null;
          notes?: string | null;
          asset?: Relation<AssetRelation>;
          account?: Relation<AccountRelation>;
        }>).filter(tx => 
          !(tx.type === 'Deposit' && tx.notes === 'Auto-deposit for external buy')
        ).slice(0, 10).map(normalizeRecentTransaction);

        setRecentTransactions(filteredTransactions);

        // Fetch rebalancing data
        try {
          const rebalancingRes = await fetch('/api/rebalancing');
          if (rebalancingRes.ok) {
            const rebalancingData = await rebalancingRes.json() as RebalancingData;
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
  }, [supabase]);

  // Load data when MFA verified
  useEffect(() => {
    if (mfaStatus === 'verified') {
      loadDashboardData();
    }
  }, [loadDashboardData, mfaStatus]);

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

  const loadDashboardDataForRefresh = useCallback(async () => {
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

        const typedLots = (allLotsData ?? []) as TaxLotRow[];
        const openLots = typedLots.filter(lot => Number(lot.remaining_quantity) > 0);
        const tickers = [
          ...new Set(
            openLots.map((lot) => {
              const asset = unwrapRelation(lot.asset);
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
        const typedPrices = (pricesData ?? []) as AssetPriceRow[];
        typedPrices.forEach((p) => {
          if (!latestPrices.has(p.ticker)) {
            latestPrices.set(p.ticker, Number(p.price));
          }
        });

        let marketValue = 0;
        let costBasis = 0;
        openLots.forEach((lot) => {
          const asset = unwrapRelation(lot.asset);
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

        const typedSummaries = (summaries ?? []) as PerformanceSummaryRow[];
        const summaryTotals = typedSummaries.reduce<PerformanceSummaryTotals>(
          (acc, row) => ({
            realized_gain: acc.realized_gain + (row.realized_gain || 0),
            dividends: acc.dividends + (row.dividends || 0),
            interest: acc.interest + (row.interest || 0),
            fees: acc.fees + (row.fees || 0),
          }),
          { realized_gain: 0, dividends: 0, interest: 0, fees: 0 }
        );

        const net = unrealized + summaryTotals.realized_gain + summaryTotals.dividends + summaryTotals.interest;
        const totalReturnPct = totalOriginalInvestment > 0 ? (net / totalOriginalInvestment) * 100 : 0;

        // Calculate IRR (use same canonical logic as PerformanceContent)
        let totalIrrPct = 0;
        const txRes = await fetch(`/api/transactions?start=&end=`);
        const txJson = await txRes.json() as { transactions?: IrrTransaction[] };
        const transactionsData = txJson?.transactions || [];

        if (transactionsData && transactionsData.length > 0) {
          // Compute cash balances for terminal value using centralized helper
          const { totalCash } = calculateCashBalances(transactionsData);

          // Build external-only cash flows (Deposits/Withdrawals/Dividend/Interest)
          const externalTypes = ['Deposit', 'Withdrawal', 'Dividend', 'Interest'];
          const txFlows: number[] = [];
          const txDates: Date[] = [];
          transactionsData.forEach((tx) => {
            if (!externalTypes.includes(tx.type)) return; // total IRR considers external flows only
            const date = new Date(tx.date);
            if (isNaN(date.getTime())) return;
            txFlows.push(transactionFlowForIRR(tx));
            txDates.push(date);
          });

          // Net same-day flows
          const { netFlows, netDates } = netCashFlowsByDate(txFlows, txDates);

          // Terminal value
          if (marketValue + totalCash > 0) {
            netFlows.push(marketValue + totalCash);
            netDates.push(new Date());
          }

          if (netFlows.length >= 2 && netDates.every((d: Date) => !isNaN(d.getTime()))) {
            const irr = calculateIRR(netFlows, netDates);
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
        const filteredTransactions = ((recentTransactions ?? []) as Array<{
          id: string;
          date: string;
          type: string;
          amount: number | string;
          funding_source?: string | null;
          notes?: string | null;
          asset?: Relation<AssetRelation>;
          account?: Relation<AccountRelation>;
        }>).filter(tx => 
          !(tx.type === 'Deposit' && tx.notes === 'Auto-deposit for external buy')
        ).slice(0, 10).map(normalizeRecentTransaction);

        setRecentTransactions(filteredTransactions);
      }
    } catch (err) {
      console.error('Dashboard data refresh failed:', err);
    }
  }, [supabase]);

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
    } catch (err: unknown) {
      setMfaError(err instanceof Error ? err.message : 'Verification failed');
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

  const rebalanceNeeded = !!rebalancingData?.currentAllocations?.some((item) => item.action !== 'hold');
  const strategySubPortfolios = rebalancingData ? (() => {
    const grouped = new Map<string, RebalancingCurrentAllocation[]>();

    rebalancingData.currentAllocations.forEach((item) => {
      const key = item.sub_portfolio_id || 'unassigned';
      if (!grouped.has(key)) grouped.set(key, []);
      grouped.get(key)?.push(item);
    });

    return Array.from(grouped.entries()).map(([id, allocations]) => {
      const subPortfolio = rebalancingData.subPortfolios.find((sp) => sp.id === id);
      const name = subPortfolio?.name || 'Unassigned';
      const target = subPortfolio?.target_allocation || 0;
      const currentValue = allocations.reduce((sum: number, item) => sum + item.current_value, 0);
      const currentPct = rebalancingData.totalValue > 0 ? (currentValue / rebalancingData.totalValue) * 100 : 0;
      const assetLevelDrift = currentValue > 0
        ? allocations.reduce((sum: number, item) => sum + (Math.abs(item.drift_percentage) * item.current_value), 0) / currentValue
        : 0;

      return { id, name, target, currentValue, currentPct, assetLevelDrift };
    }).sort((a, b) => b.currentValue - a.currentValue);
  })() : [];

  const controlsPanel = (
    <div className="mb-2 flex flex-col items-start gap-3 md:flex-row md:items-end md:justify-between md:gap-4">
      <div className="flex items-center gap-3">
        <Button
          onClick={handleRefresh}
          disabled={refreshing}
          size="sm"
          className="bg-black text-white hover:bg-zinc-800 flex items-center h-9 px-4 transition-all shadow-black/20 font-bold"
        >
          <RefreshCw className={cn('w-4 h-4 mr-2', refreshing && 'animate-spin')} />
          {refreshing ? 'Refreshing...' : 'Refresh Prices'}
        </Button>
        {refreshMessage && <span className="text-sm text-green-600">{refreshMessage}</span>}
      </div>

      <div className="flex w-full flex-col gap-3 md:w-auto md:flex-row md:items-end md:gap-4">
        <div className="w-full max-w-xs md:w-56 md:max-w-none">
          <Label className="text-[10px] font-bold uppercase mb-1 block">Slice by</Label>
          <Select value={lens} onValueChange={setLens}>
            <SelectTrigger className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {LENSES.map(l => (
                <SelectItem key={l.value} value={l.value}>{l.label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {lens !== 'total' && (
          <div className="w-full max-w-sm md:w-72 md:max-w-none">
            <Label className="text-[10px] font-bold uppercase mb-1 block">
              Select {LENSES.find(l => l.value === lens)?.label}s {valuesLoading && '(loading...)'}
            </Label>
            <Popover>
              <PopoverTrigger asChild>
                <Button variant="outline" className="w-full justify-between bg-background">
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
                        <CommandItem key={item.value} onSelect={() => toggleValue(getSelectionValue(item))}>
                          <Check className={cn('mr-2 h-4 w-4', selectedValues.includes(getSelectionValue(item)) ? 'opacity-100' : 'opacity-0')} />
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

        {lens !== 'total' && selectedValues.length > 1 && (
          <div className="flex items-center gap-2 rounded-md border bg-background p-2">
            <Switch checked={aggregate} onCheckedChange={setAggregate} />
            <Label>Aggregate selected</Label>
          </div>
        )}
      </div>
    </div>
  );

  const performanceCard = (
    <Card className="cursor-pointer rounded-xl border shadow-sm" onClick={() => router.push('/dashboard/performance')}>
      <CardHeader>
        <CardTitle className="text-center text-2xl">Performance</CardTitle>
        <div className="text-center mt-4 rounded-lg border bg-white p-3">
          <CardTitle className="text-sm uppercase tracking-wide text-muted-foreground">Total Portfolio Value</CardTitle>
          <p className="text-2xl font-bold mt-2 font-mono tabular-nums">
            {performanceTotals ? formatUSDWhole(performanceTotals.market_value) : 'Loading...'}
          </p>
        </div>
        <div className="grid grid-cols-2 gap-4 mt-6">
          <div className="space-y-4">
            <div className="text-center rounded-lg border bg-card p-3">
              <CardTitle className="text-sm">Net Gain/Loss</CardTitle>
              <p className={cn('text-xl font-bold mt-2 tabular-nums', Number(performanceTotals?.net_gain ?? 0) >= 0 ? 'text-green-600' : 'text-red-600')}>
                {performanceTotals ? formatUSDWhole(performanceTotals.net_gain) : 'Loading...'}
              </p>
            </div>
            <div className="text-center rounded-lg border bg-card p-3">
              <CardTitle className="text-sm">Total Return %</CardTitle>
              <p className={cn('text-xl font-bold mt-2 tabular-nums', Number(performanceTotals?.total_return_pct ?? 0) >= 0 ? 'text-green-600' : 'text-red-600')}>
                {performanceTotals ? formatPctTenth(performanceTotals.total_return_pct) : 'Loading...'}
              </p>
            </div>
            <div className="text-center rounded-lg border bg-card p-3">
              <CardTitle className="text-sm">Annualized IRR</CardTitle>
              <p className={cn('text-xl font-bold mt-2 tabular-nums', (performanceTotals?.irr_pct || 0) >= 0 ? 'text-green-600' : 'text-red-600')}>
                {performanceTotals ? formatPctTenth(performanceTotals.irr_pct || 0) : 'Loading...'}
              </p>
            </div>
          </div>
          <div className="space-y-4">
            <div className="text-center rounded-lg border bg-card p-3">
              <CardTitle className="text-sm">Unrealized G/L</CardTitle>
              <p className={cn('text-xl font-bold mt-2 tabular-nums', Number(performanceTotals?.unrealized_gain ?? 0) >= 0 ? 'text-green-600' : 'text-red-600')}>
                {performanceTotals ? formatUSDWhole(performanceTotals.unrealized_gain) : 'Loading...'}
              </p>
            </div>
            <div className="text-center rounded-lg border bg-card p-3">
              <CardTitle className="text-sm">Realized G/L</CardTitle>
              <p className={cn('text-xl font-bold mt-2 tabular-nums', Number(performanceTotals?.realized_gain ?? 0) >= 0 ? 'text-green-600' : 'text-red-600')}>
                {performanceTotals ? formatUSDWhole(performanceTotals.realized_gain) : 'Loading...'}
              </p>
            </div>
            <div className="text-center rounded-lg border bg-card p-3">
              <CardTitle className="text-sm">Income</CardTitle>
              <p className={cn('text-xl font-bold mt-2 tabular-nums', Number(performanceTotals?.dividends ?? 0) >= 0 ? 'text-green-600' : 'text-red-600')}>
                {performanceTotals ? formatUSDWhole(performanceTotals.dividends) : 'Loading...'}
              </p>
            </div>
          </div>
        </div>
      </CardHeader>
    </Card>
  );

  const strategyCard = (
    <Card className="cursor-pointer rounded-xl border shadow-sm" onClick={() => router.push('/dashboard/portfolio?tab=rebalancing')}>
      <CardHeader>
        <CardTitle className="text-center text-2xl">Strategy</CardTitle>
      </CardHeader>
      <CardContent>
        {rebalancingLoading ? (
          <p>Loading strategy data...</p>
        ) : rebalancingData ? (
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-4 items-stretch">
              <div className="text-center h-full rounded-md border p-3">
                <h4 className="font-semibold text-sm text-muted-foreground">Portfolio Drift</h4>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 sm:gap-2 mt-2">
                  <div className="text-center">
                    <p className="text-xs text-muted-foreground">Sub-Portfolio</p>
                    <p className="text-lg sm:text-xl font-bold leading-tight break-words tabular-nums">
                      {(() => {
                        const subPortfolioAllocations: { [key: string]: number } = {}
                        rebalancingData.currentAllocations.forEach((item) => {
                          const subId = item.sub_portfolio_id || 'unassigned'
                          subPortfolioAllocations[subId] = (subPortfolioAllocations[subId] || 0) + item.current_value
                        })

                        let totalWeightedDrift = 0
                        let totalValue = 0

                        rebalancingData.subPortfolios.forEach((sp) => {
                          const currentValue = subPortfolioAllocations[sp.id] || 0
                          const currentAllocation = rebalancingData.totalValue > 0 ? (currentValue / rebalancingData.totalValue) * 100 : 0
                          const targetAllocation = sp.target_allocation
                          const relativeDrift = targetAllocation > 0 ? Math.abs((currentAllocation - targetAllocation) / targetAllocation) : 0
                          totalWeightedDrift += relativeDrift * currentValue
                          totalValue += currentValue
                        })

                        return (totalValue > 0 ? totalWeightedDrift / totalValue * 100 : 0).toFixed(1) + '%'
                      })()}
                    </p>
                  </div>
                  <div className="text-center">
                    <p className="text-xs text-muted-foreground">Asset</p>
                    <p className="text-lg sm:text-xl font-bold leading-tight break-words tabular-nums">
                      {(() => {
                        const assetDrift = rebalancingData.totalValue > 0
                          ? rebalancingData.currentAllocations.reduce((sum: number, item) => {
                            const weight = item.current_value / rebalancingData.totalValue
                            const currentPct = item.current_percentage || 0
                            const implied = item.implied_overall_target || 0
                            const rel = implied > 0 ? Math.abs((currentPct - implied) / implied) * 100 : (currentPct === 0 ? 0 : Infinity)
                            return sum + (rel * weight)
                          }, 0)
                          : 0
                        return assetDrift.toFixed(1) + '%'
                      })()}
                    </p>
                  </div>
                </div>
              </div>
              <div className="text-center h-full rounded-md border p-3 flex min-h-[132px] flex-col items-center justify-center gap-3">
                <h4 className="font-semibold text-sm text-muted-foreground">Rebalance Needed</h4>
                <p className="flex min-h-[2rem] items-center justify-center text-xl font-bold">
                  {rebalancingData.currentAllocations.some((item) => item.action !== 'hold') ? (
                    <span className="text-red-600">Yes</span>
                  ) : (
                    'No'
                  )}
                </p>
              </div>
            </div>

            <div>
              <div className="md:hidden space-y-3">
                {strategySubPortfolios.map((sp) => (
                  <div key={sp.id} className="rounded-lg border bg-background p-3 shadow-sm">
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <div className="font-semibold leading-tight break-words">{sp.name}</div>
                        <div className="text-xs text-muted-foreground">Current Value</div>
                      </div>
                      <div className="text-right">
                        <div className="text-sm font-semibold tabular-nums">{formatUSDWhole(sp.currentValue)}</div>
                      </div>
                    </div>
                    <div className="mt-2 grid grid-cols-3 gap-2 text-[11px]">
                      <MetricChip label="Target" value={`${sp.target.toFixed(1)}%`} valueClassName="text-blue-700" />
                      <MetricChip label="Actual" value={`${sp.currentPct.toFixed(1)}%`} />
                      <MetricChip label="Asset Drift" value={`${sp.assetLevelDrift.toFixed(1)}%`} valueClassName={sp.assetLevelDrift > 0 ? 'text-red-600' : 'text-zinc-700'} />
                    </div>
                  </div>
                ))}
              </div>

              <div className="hidden md:block max-h-48 overflow-y-auto">
                <Table className="w-full min-w-[760px] table-fixed" containerClassName="overscroll-x-contain">
                  <colgroup>
                    <col className="w-[32%]" />
                    <col className="w-[20%]" />
                    <col className="w-[16%]" />
                    <col className="w-[16%]" />
                    <col className="w-[16%]" />
                  </colgroup>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="px-3 sm:px-4 text-left">Sub-Portfolio</TableHead>
                      <TableHead className="px-3 sm:px-4 text-right">Current Value</TableHead>
                      <TableHead className="px-3 sm:px-4 text-right">Target Allocation</TableHead>
                      <TableHead className="px-3 sm:px-4 text-right">Actual Allocation</TableHead>
                      <TableHead className="px-3 sm:px-4 text-right">Asset-Level Drift</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {strategySubPortfolios.map((sp, idx) => (
                        <TableRow key={idx}>
                          <TableCell className="px-3 sm:px-4 text-left font-medium truncate">{sp.name}</TableCell>
                          <TableCell className="px-3 sm:px-4 text-right tabular-nums whitespace-nowrap">{formatUSDWhole(sp.currentValue)}</TableCell>
                          <TableCell className="px-3 sm:px-4 text-right tabular-nums whitespace-nowrap">{sp.target.toFixed(1)}%</TableCell>
                          <TableCell className="px-3 sm:px-4 text-right tabular-nums whitespace-nowrap">{sp.currentPct.toFixed(1)}%</TableCell>
                          <TableCell className="px-3 sm:px-4 text-right tabular-nums whitespace-nowrap">{sp.assetLevelDrift.toFixed(1)}%</TableCell>
                        </TableRow>
                    ))}
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
  );

  const recentTable = (
    <>
      <div className="md:hidden space-y-3">
        {recentTransactions.map((tx) => (
          <div key={tx.id} className="rounded-lg border bg-background p-3 shadow-sm">
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <div className="font-semibold leading-tight">{tx.asset?.ticker || tx.type}</div>
                <div className="text-xs text-muted-foreground truncate">{tx.account?.name || 'External / Cash Flow'}</div>
              </div>
              <div className="text-right">
                <div className="text-sm font-semibold tabular-nums">{formatUSDWhole(Number(tx.amount))}</div>
                <div className="text-[11px] text-muted-foreground">{tx.date}</div>
              </div>
            </div>
            <div className="mt-2 grid grid-cols-2 gap-2 text-[11px]">
              <MetricChip label="Type" value={tx.type} valueClassName="text-xs leading-tight break-words" />
              <MetricChip label="Date" value={tx.date} valueClassName="text-xs" />
            </div>
          </div>
        ))}
      </div>

      <div className="hidden md:block">
    <Table className="w-full min-w-[620px] table-fixed" containerClassName="overscroll-x-contain">
      <colgroup>
        <col className="w-[18%]" />
        <col className="w-[26%]" />
        <col className="w-[14%]" />
        <col className="w-[20%]" />
        <col className="w-[22%]" />
      </colgroup>
      <TableHeader>
        <TableRow>
          <TableHead className="px-3 sm:px-4 text-left">Date</TableHead>
          <TableHead className="px-3 sm:px-4 text-left">Account</TableHead>
          <TableHead className="px-3 sm:px-4 text-left">Ticker</TableHead>
          <TableHead className="px-3 sm:px-4 text-left">Type</TableHead>
          <TableHead className="px-3 sm:px-4 text-right">Amount</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {recentTransactions.map((tx) => (
          <TableRow key={tx.id}>
            <TableCell className="px-3 sm:px-4 text-left whitespace-nowrap">{tx.date}</TableCell>
            <TableCell className="px-3 sm:px-4 text-left truncate">{tx.account?.name || ''}</TableCell>
            <TableCell className="px-3 sm:px-4 text-left whitespace-nowrap">{tx.asset?.ticker || ''}</TableCell>
            <TableCell className="px-3 sm:px-4 text-left whitespace-nowrap">{tx.type}</TableCell>
            <TableCell className="px-3 sm:px-4 text-right tabular-nums whitespace-nowrap">{formatUSDWhole(Number(tx.amount))}</TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
      </div>
    </>
  );

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
              Don&apos;t ask me this again
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
          onChange={(e: ChangeEvent<HTMLInputElement>) => setMfaCode(e.target.value)}
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
    <main className="flex flex-col gap-4 p-4 max-w-[1600px] mx-auto overflow-x-hidden">
      <div className="text-center py-2">
        <h1 className="text-3xl font-bold">Portfolio Dashboard</h1>
      </div>

      <DashboardSection title="Dashboard Controls" defaultOpen desktopDefaultOpen mobileDefaultOpen={false}>
        {controlsPanel}
      </DashboardSection>

      {loading ? (
        <div className="text-center py-12 rounded-xl border bg-background shadow-sm">Loading portfolio data...</div>
      ) : selectedValues.length === 0 && lens !== 'total' && !valuesLoading ? (
        <div className="text-center py-12 text-muted-foreground rounded-xl border bg-background shadow-sm">Select at least one value to view data.</div>
      ) : (
        <>
          <DashboardSection title="Key KPIs" defaultOpen desktopDefaultOpen mobileDefaultOpen={false}>
            <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-4">
              <div className="bg-card p-4 rounded-lg border text-center shadow-sm">
                <Label className="text-[10px] uppercase font-bold text-muted-foreground">Portfolio Value</Label>
                <div className="text-xl font-bold font-mono tabular-nums mt-1">{formatUSDWhole(performanceTotals?.market_value)}</div>
              </div>
              <div className="bg-card p-4 rounded-lg border text-center shadow-sm">
                <Label className="text-[10px] uppercase font-bold text-muted-foreground">Net Gain/Loss</Label>
                <div className={cn('text-xl font-bold font-mono tabular-nums mt-1', Number(performanceTotals?.net_gain ?? 0) >= 0 ? 'text-green-600' : 'text-red-600')}>
                  {formatUSDWhole(performanceTotals?.net_gain)}
                </div>
              </div>
              <div className="bg-card p-4 rounded-lg border text-center shadow-sm">
                <Label className="text-[10px] uppercase font-bold text-muted-foreground">Total Return</Label>
                <div className={cn('text-xl font-bold font-mono tabular-nums mt-1', Number(performanceTotals?.total_return_pct ?? 0) >= 0 ? 'text-green-600' : 'text-red-600')}>
                  {formatPctTenth(performanceTotals?.total_return_pct)}
                </div>
              </div>
              <div className="bg-card p-4 rounded-lg border text-center shadow-sm">
                <Label className="text-[10px] uppercase font-bold text-muted-foreground">Rebalance Needed</Label>
                <div className={cn('text-xl font-bold tabular-nums mt-1', rebalanceNeeded ? 'text-red-600' : 'text-green-600')}>
                  {rebalanceNeeded ? 'Yes' : 'No'}
                </div>
              </div>
            </div>
          </DashboardSection>

          <div className="hidden md:grid md:grid-cols-2 gap-4">
            <div className="space-y-4">
              <DashboardSection title="Performance Snapshot" defaultOpen desktopDefaultOpen mobileDefaultOpen>
                {performanceCard}
              </DashboardSection>
              <DashboardSection title="Strategy Snapshot" defaultOpen desktopDefaultOpen mobileDefaultOpen={false}>
                {strategyCard}
              </DashboardSection>
            </div>

            <div className="space-y-4">
              <DashboardSection title="Portfolio Details" defaultOpen desktopDefaultOpen mobileDefaultOpen={false}>
                <PortfolioDetailsCard lens={lens} selectedValues={selectedValues} aggregate={aggregate} />
              </DashboardSection>
              <DashboardSection title="Recent Activity" defaultOpen desktopDefaultOpen mobileDefaultOpen={false}>
                <Card className="cursor-pointer rounded-xl border shadow-sm" onClick={() => router.push('/dashboard/activity?tab=transactions')}>
                  <CardHeader>
                    <CardTitle className="text-center text-2xl">Recent Activity</CardTitle>
                  </CardHeader>
                  <CardContent>{recentTable}</CardContent>
                </Card>
              </DashboardSection>
            </div>
          </div>

          <div className="md:hidden space-y-4">
            <DashboardSection title="Performance Snapshot" defaultOpen mobileDefaultOpen desktopDefaultOpen>
              {performanceCard}
            </DashboardSection>

            <DashboardSection title="Strategy Snapshot" defaultOpen={false} mobileDefaultOpen={false} desktopDefaultOpen>
              {strategyCard}
            </DashboardSection>

            <DashboardSection title="Portfolio Details" defaultOpen={false} mobileDefaultOpen={false} desktopDefaultOpen>
              <PortfolioDetailsCard lens={lens} selectedValues={selectedValues} aggregate={aggregate} />
            </DashboardSection>

            <DashboardSection title="Recent Activity" defaultOpen={false} mobileDefaultOpen={false} desktopDefaultOpen>
              <Card className="cursor-pointer rounded-xl border shadow-sm" onClick={() => router.push('/dashboard/activity?tab=transactions')}>
                <CardHeader>
                  <CardTitle className="text-center text-2xl">Recent Activity</CardTitle>
                </CardHeader>
                <CardContent>{recentTable}</CardContent>
              </Card>
            </DashboardSection>
          </div>
        </>
      )}
    </main>
  );
}