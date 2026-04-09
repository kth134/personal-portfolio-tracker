'use client';

import { useState, useEffect, useCallback, useMemo } from 'react';
import type { ChangeEvent, ReactNode } from 'react';
import {
  PieChart, Pie, Cell, ResponsiveContainer, Tooltip, Legend, BarChart, Bar, XAxis, YAxis, CartesianGrid,
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
import { calculatePortfolioAssetAction } from '@/lib/rebalancing-logic';
import { DashboardPageShell } from '@/components/dashboard-shell';
import PortfolioValueBridge from '@/components/charts/PortfolioValueBridge';

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

const DRIFT_LENSES = [
  { value: 'total', label: 'Assets' },
  { value: 'sub_portfolio', label: 'Sub-Portfolio' },
  { value: 'asset_type', label: 'Asset Type' },
  { value: 'asset_subtype', label: 'Asset Sub-Type' },
  { value: 'size_tag', label: 'Size' },
  { value: 'geography', label: 'Geography' },
  { value: 'factor_tag', label: 'Factor' },
];

const getDriftLensTitle = (lens: string) => {
  if (lens === 'total') return 'Asset';
  const lensLabel = DRIFT_LENSES.find((item) => item.value === lens)?.label || 'Selection';
  return lensLabel.replace(/\s+/g, '-');
};

const getAllocationLensTitle = (lens: string) => {
  if (lens === 'total') return 'Asset';
  const lensLabel = LENSES.find((item) => item.value === lens)?.label || 'Selection';
  return lensLabel.replace(/\s+/g, '-');
};

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

type AllTimePerformanceSnapshot = {
  totals: PerformanceTotals;
  bridgeInput: PortfolioValueBridgeInput | null;
};

type PortfolioValueBridgeInput = {
  startValue: number;
  apiTerminalValue: number;
  netContributions: number;
  income: number;
  realized: number;
  unrealized: number;
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

type RecentActivityTotals = {
  buys: number;
  sells: number;
  income: number;
};

type RebalancingSubPortfolio = {
  id: string;
  name: string;
  target_allocation: number;
  upside_threshold?: number | null;
  downside_threshold?: number | null;
  band_mode?: boolean | number | null;
};

type RebalancingCurrentAllocation = {
  asset_id?: string;
  ticker?: string;
  name?: string;
  sub_portfolio_id: string | null;
  sub_portfolio_name?: string | null;
  asset_type?: string | null;
  asset_subtype?: string | null;
  geography?: string | null;
  size_tag?: string | null;
  factor_tag?: string | null;
  current_value: number;
  action: string;
  current_percentage?: number | null;
  implied_overall_target?: number | null;
  sub_portfolio_target_percentage?: number | null;
  asset_band_mode?: boolean | number | null;
  drift_percentage: number;
};

type DriftChartPoint = {
  ticker: string;
  drift_percentage: number;
  current_pct?: number;
  target_pct?: number;
};

type DriftChartSlice = {
  key: string;
  data: DriftChartPoint[];
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

const isFilteredRecentTransaction = (tx: {
  type: string;
  notes?: string | null;
}) => !(tx.type === 'Deposit' && tx.notes === 'Auto-deposit for external buy');

const EMPTY_RECENT_ACTIVITY_TOTALS: RecentActivityTotals = {
  buys: 0,
  sells: 0,
  income: 0,
};

const summarizeRecentActivity = (transactions: Array<{
  type: string;
  amount: number | string;
}>): RecentActivityTotals => transactions.reduce<RecentActivityTotals>((totals, tx) => {
  const amount = Math.abs(Number(tx.amount) || 0);
  if (tx.type === 'Buy') totals.buys += amount;
  if (tx.type === 'Sell') totals.sells += amount;
  if (tx.type === 'Dividend' || tx.type === 'Interest') totals.income += amount;
  return totals;
}, { ...EMPTY_RECENT_ACTIVITY_TOTALS });

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

const getAllTimePortfolioValueBridgeInput = ({
  terminalValue,
  income,
  realized,
  unrealized,
}: {
  terminalValue: number;
  income: number;
  realized: number;
  unrealized: number;
}): PortfolioValueBridgeInput | null => {
  const apiTerminalValue = Number(terminalValue) || 0;
  const normalizedIncome = Number(income) || 0;
  const normalizedRealized = Number(realized) || 0;
  const normalizedUnrealized = Number(unrealized) || 0;

  if (apiTerminalValue === 0 && normalizedIncome === 0 && normalizedRealized === 0 && normalizedUnrealized === 0) {
    return null;
  }

  return {
    startValue: 0,
    apiTerminalValue,
    netContributions: apiTerminalValue - normalizedIncome - normalizedRealized - normalizedUnrealized,
    income: normalizedIncome,
    realized: normalizedRealized,
    unrealized: normalizedUnrealized,
  };
};

const RADIAN = Math.PI / 180;

type PiePercentageLabelProps = {
  cx?: number;
  cy?: number;
  midAngle?: number;
  innerRadius?: number;
  outerRadius?: number;
  percent?: number;
  index?: number;
};

const renderPiePercentageLabel = ({
  cx = 0,
  cy = 0,
  midAngle = 0,
  outerRadius = 0,
  percent = 0,
  index = 0,
}: PiePercentageLabelProps) => {
  if (!percent || percent < 0.04) return null;

  const isRightSide = Math.cos(-midAngle * RADIAN) >= 0;
  const startRadius = outerRadius;
  const midRadius = outerRadius + 12;
  const labelRadius = outerRadius + 28 + (index % 2) * 6;
  const startX = cx + startRadius * Math.cos(-midAngle * RADIAN);
  const startY = cy + startRadius * Math.sin(-midAngle * RADIAN);
  const midX = cx + midRadius * Math.cos(-midAngle * RADIAN);
  const midY = cy + midRadius * Math.sin(-midAngle * RADIAN);
  const labelX = cx + labelRadius * Math.cos(-midAngle * RADIAN) + (isRightSide ? 14 : -14);
  const labelY = cy + labelRadius * Math.sin(-midAngle * RADIAN);
  const lineEndX = labelX + (isRightSide ? -4 : 4);

  return (
    <g>
      <path
        d={`M ${startX} ${startY} L ${midX} ${midY} L ${lineEndX} ${labelY}`}
        stroke="#71717a"
        strokeWidth="1"
        fill="none"
      />
      <text
        x={labelX}
        y={labelY}
        fill="#18181b"
        textAnchor={isRightSide ? 'start' : 'end'}
        dominantBaseline="central"
        className="text-[11px] font-semibold"
      >
        {`${(percent * 100).toFixed(1)}%`}
      </text>
    </g>
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

type DashboardSectionState = {
  keyKpis: boolean;
  performanceSnapshot: boolean;
  strategySnapshot: boolean;
  portfolioDetails: boolean;
  recentActivity: boolean;
};

function DashboardSection({
  title,
  isOpen,
  onOpenChange,
  className,
  bodyClassName,
  children,
}: {
  title: string;
  isOpen: boolean;
  onOpenChange: (nextOpen: boolean) => void;
  className?: string;
  bodyClassName?: string;
  children: ReactNode;
}) {
  return (
    <details
      open={isOpen}
      onToggle={(event) => onOpenChange(event.currentTarget.open)}
      className={cn('group overflow-hidden rounded-xl border bg-background shadow-sm', className)}
    >
      <summary className="dashboard-section-header">
        <span className="dashboard-section-header-title">{title}</span>
        <span className="dashboard-section-header-meta">
          <span className="hidden sm:inline">Expand / Collapse</span>
          <ChevronDown className="h-4 w-4 transition-transform group-open:rotate-180" />
        </span>
      </summary>
      <div className={cn('space-y-4 px-4 pb-4', bodyClassName)}>{children}</div>
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
    void _data;
    // Handle pie chart clicks for drilling down
  };

  if (allocationsLoading) {
    return (
      <Card className="cursor-pointer rounded-xl border shadow-sm" onClick={() => router.push('/dashboard/portfolio')}>
        <CardContent>
          <div className="text-center py-8">Loading allocations...</div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="cursor-pointer rounded-xl border shadow-sm" onClick={() => router.push('/dashboard/portfolio')}>
      <CardContent>
        <div className="grid grid-cols-1 gap-8">
          {allocations.map((slice, idx) => (
            <div key={idx} className="space-y-4">
              <h4 className="font-medium text-center">{lens === 'total' ? getAllocationLensTitle(lens) : aggregate && slice.key === 'Aggregated Selection' ? getAllocationLensTitle(lens) : slice.key} Allocation</h4>
              <ResponsiveContainer width="100%" height={360}>
                <PieChart margin={{ top: 8, right: 34, left: 34, bottom: 58 }}>
                  <Pie
                    data={slice.data}
                    dataKey="value"
                    nameKey="subkey"
                    outerRadius={82}
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
                    wrapperStyle={{ paddingTop: 18, fontSize: '12px', lineHeight: '16px' }}
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
  const [sectionState, setSectionState] = useState<DashboardSectionState>({
    keyKpis: true,
    performanceSnapshot: false,
    strategySnapshot: false,
    portfolioDetails: false,
    recentActivity: false,
  });

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
  const [performanceBridgeInput, setPerformanceBridgeInput] = useState<PortfolioValueBridgeInput | null>(null);
  const [recentTransactions, setRecentTransactions] = useState<RecentTransactionRow[]>([]);
  const [recentActivityTotals, setRecentActivityTotals] = useState<RecentActivityTotals>(EMPTY_RECENT_ACTIVITY_TOTALS);
  const [rebalancingData, setRebalancingData] = useState<RebalancingData | null>(null);
  const [rebalancingLoading, setRebalancingLoading] = useState(true);
  const [driftLens, setDriftLens] = useState('total');
  const [driftAvailableValues, setDriftAvailableValues] = useState<SelectOption[]>([]);
  const [driftSelectedValues, setDriftSelectedValues] = useState<string[]>([]);
  const [driftAggregate, setDriftAggregate] = useState(false);

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

  const fetchAllTimePerformanceSnapshot = useCallback(async (userId: string): Promise<AllTimePerformanceSnapshot> => {
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

    const income = summaryTotals.dividends + summaryTotals.interest;
    const net = unrealized + summaryTotals.realized_gain + income;
    const totalReturnPct = totalOriginalInvestment > 0 ? (net / totalOriginalInvestment) * 100 : 0;

    let totalIrrPct = 0;
    const transactionsData = await fetchAllUserTransactions() as IrrTransaction[] | null;

    if (transactionsData && transactionsData.length > 0) {
      const { totalCash } = calculateCashBalances(transactionsData);
      const externalTypes = ['Deposit', 'Withdrawal', 'Dividend', 'Interest'];
      const txFlows: number[] = [];
      const txDates: Date[] = [];

      transactionsData.forEach((tx) => {
        if (!externalTypes.includes(tx.type)) return;
        const date = new Date(tx.date);
        if (isNaN(date.getTime())) return;
        txFlows.push(transactionFlowForIRR(tx));
        txDates.push(date);
      });

      const { netFlows, netDates } = netCashFlowsByDate(txFlows, txDates);

      if (marketValue + totalCash > 0) {
        netFlows.push(marketValue + totalCash);
        netDates.push(new Date());
      }

      if (netFlows.length >= 2 && netDates.every(d => !isNaN(d.getTime()))) {
        const irr = calculateIRR(netFlows, netDates);
        totalIrrPct = isNaN(irr) ? 0 : irr * 100;
      }
    }

    return {
      totals: {
        market_value: marketValue,
        net_gain: net,
        total_return_pct: totalReturnPct,
        irr_pct: totalIrrPct,
        unrealized_gain: unrealized,
        realized_gain: summaryTotals.realized_gain,
        dividends: summaryTotals.dividends,
      },
      bridgeInput: getAllTimePortfolioValueBridgeInput({
        terminalValue: marketValue,
        income,
        realized: summaryTotals.realized_gain,
        unrealized,
      }),
    };
  }, [supabase]);

  const loadDashboardData = useCallback(async () => {
    setLoading(true);

    try {
      const { data: { user } } = await supabase.auth.getUser();
      const userId = user?.id;
      if (userId) {
        const performanceSnapshot = await fetchAllTimePerformanceSnapshot(userId);
        setPerformanceTotals(performanceSnapshot.totals);
        setPerformanceBridgeInput(performanceSnapshot.bridgeInput);

        const thirtyDaysAgo = new Date();
        thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
        const cutoffDate = thirtyDaysAgo.toISOString().slice(0, 10);

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

        const { data: recentActivityWindow } = await supabase
          .from('transactions')
          .select('type, amount, notes')
          .eq('user_id', userId)
          .gte('date', cutoffDate);

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
        }>).filter(isFilteredRecentTransaction).slice(0, 10).map(normalizeRecentTransaction);

        const filteredRecentActivityWindow = ((recentActivityWindow ?? []) as Array<{
          type: string;
          amount: number | string;
          notes?: string | null;
        }>).filter(isFilteredRecentTransaction);

        setRecentTransactions(filteredTransactions);
        setRecentActivityTotals(summarizeRecentActivity(filteredRecentActivityWindow));

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
  }, [fetchAllTimePerformanceSnapshot, supabase]);

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
      const { data: { user } } = await supabase.auth.getUser();
      const userId = user?.id;
      if (userId) {
        const performanceSnapshot = await fetchAllTimePerformanceSnapshot(userId);
        setPerformanceTotals(performanceSnapshot.totals);
        setPerformanceBridgeInput(performanceSnapshot.bridgeInput);

        const thirtyDaysAgo = new Date();
        thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
        const cutoffDate = thirtyDaysAgo.toISOString().slice(0, 10);

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

        const { data: recentActivityWindow } = await supabase
          .from('transactions')
          .select('type, amount, notes')
          .eq('user_id', userId)
          .gte('date', cutoffDate);

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
        }>).filter(isFilteredRecentTransaction).slice(0, 10).map(normalizeRecentTransaction);

        const filteredRecentActivityWindow = ((recentActivityWindow ?? []) as Array<{
          type: string;
          amount: number | string;
          notes?: string | null;
        }>).filter(isFilteredRecentTransaction);

        setRecentTransactions(filteredTransactions);
        setRecentActivityTotals(summarizeRecentActivity(filteredRecentActivityWindow));
      }
    } catch (err) {
      console.error('Dashboard data refresh failed:', err);
    }
  }, [fetchAllTimePerformanceSnapshot, supabase]);

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

  const normalizedRebalancingAllocations = useMemo(() => {
    if (!rebalancingData?.currentAllocations?.length) return [] as RebalancingCurrentAllocation[];

    return rebalancingData.currentAllocations.map((item) => {
      const subPortfolio = rebalancingData.subPortfolios.find((sp) => sp.id === item.sub_portfolio_id);
      const rawAssetBandMode = item.asset_band_mode;
      const effectiveBandMode = typeof rawAssetBandMode === 'boolean'
        ? rawAssetBandMode
        : rawAssetBandMode === 1
          ? true
          : rawAssetBandMode === 0
            ? false
            : !!subPortfolio?.band_mode;

      const calculation = calculatePortfolioAssetAction({
        currentValue: item.current_value,
        totalPortfolioValue: rebalancingData.totalValue,
        targetOverallPct: Number(item.implied_overall_target || 0),
        upsideThreshold: Math.abs(subPortfolio?.upside_threshold ?? 5),
        downsideThreshold: Math.abs(subPortfolio?.downside_threshold ?? 5),
        bandMode: effectiveBandMode,
      });

      return {
        ...item,
        current_percentage: calculation.currentOverallPct,
        drift_percentage: calculation.driftPercentage,
        action: calculation.action,
      };
    });
  }, [rebalancingData]);

  const rebalanceNeeded = normalizedRebalancingAllocations.some((item) => item.action !== 'hold');

  useEffect(() => {
    if (driftLens === 'total' || !normalizedRebalancingAllocations.length) {
      setDriftAvailableValues([]);
      setDriftSelectedValues([]);
      return;
    }

    const valuesMap = new Map<string, SelectOption>();
    normalizedRebalancingAllocations.forEach((item) => {
      let groupValue = 'Unknown';
      switch (driftLens) {
        case 'sub_portfolio':
          groupValue = item.sub_portfolio_name || 'Unassigned';
          break;
        case 'asset_type':
          groupValue = item.asset_type || 'Unknown';
          break;
        case 'asset_subtype':
          groupValue = item.asset_subtype || 'Unknown';
          break;
        case 'geography':
          groupValue = item.geography || 'Unknown';
          break;
        case 'size_tag':
          groupValue = item.size_tag || 'Unknown';
          break;
        case 'factor_tag':
          groupValue = item.factor_tag || 'Unknown';
          break;
        default:
          groupValue = 'Unknown';
      }

      if (!valuesMap.has(groupValue)) {
        valuesMap.set(groupValue, { value: groupValue, label: groupValue });
      }
    });

    const nextValues = Array.from(valuesMap.values()).sort((a, b) => a.label.localeCompare(b.label));
    setDriftAvailableValues(nextValues);
    setDriftSelectedValues((prev) => {
      const nextSet = new Set(nextValues.map((item) => item.value));
      const retained = prev.filter((value) => nextSet.has(value));
      return retained.length ? retained : nextValues.map((item) => item.value);
    });
  }, [driftLens, normalizedRebalancingAllocations]);

  const toggleDriftValue = (value: string) => {
    setDriftSelectedValues((prev) => (prev.includes(value) ? prev.filter((entry) => entry !== value) : [...prev, value]));
  };

  const getDriftColor = (drift: number, sliceData: DriftChartPoint[]) => {
    const maxAbs = Math.max(...sliceData.map((entry) => Math.abs(entry.drift_percentage)), 1);
    const ratio = Math.abs(drift) / maxAbs;
    if (drift >= 0) {
      if (ratio > 0.8) return '#064e3b';
      if (ratio > 0.5) return '#059669';
      if (ratio > 0.2) return '#34d399';
      return '#bbf7d0';
    }
    if (ratio > 0.8) return '#7f1d1d';
    if (ratio > 0.5) return '#dc2626';
    if (ratio > 0.2) return '#f87171';
    return '#fecaca';
  };

  const driftChartSlices = rebalancingData ? (() => {
    let base: DriftChartSlice[] = [];
    if (driftLens === 'total') {
      base = [{
        key: 'Portfolio',
        data: normalizedRebalancingAllocations.map((item) => ({
          ticker: item.ticker || item.name || 'Unknown',
          drift_percentage: Number(item.drift_percentage || 0),
          current_pct: Number(item.current_percentage || 0),
          target_pct: Number(item.implied_overall_target || 0),
        })),
      }];
    } else {
      const groupMap = new Map<string, RebalancingCurrentAllocation[]>();
      normalizedRebalancingAllocations.forEach((item) => {
        let groupKey = 'Unknown';
        switch (driftLens) {
          case 'sub_portfolio':
            groupKey = item.sub_portfolio_name || 'Unassigned';
            break;
          case 'asset_type':
            groupKey = item.asset_type || 'Unknown';
            break;
          case 'asset_subtype':
            groupKey = item.asset_subtype || 'Unknown';
            break;
          case 'geography':
            groupKey = item.geography || 'Unknown';
            break;
          case 'size_tag':
            groupKey = item.size_tag || 'Unknown';
            break;
          case 'factor_tag':
            groupKey = item.factor_tag || 'Unknown';
            break;
          default:
            groupKey = 'Unknown';
        }
        if (!groupMap.has(groupKey)) groupMap.set(groupKey, []);
        groupMap.get(groupKey)?.push(item);
      });

      base = Array.from(groupMap.entries())
        .filter(([groupKey]) => driftSelectedValues.length === 0 || driftSelectedValues.includes(groupKey))
        .map(([groupKey, items]) => ({
          key: groupKey,
          data: items.map((item) => ({
            ticker: item.ticker || item.name || 'Unknown',
            drift_percentage: Number(item.drift_percentage || 0),
            current_pct: Number(item.current_percentage || 0),
            target_pct: Number(item.implied_overall_target || 0),
          })),
        }));
    }

    if (driftAggregate && base.length > 1) {
      const points = base.map((group) => {
        const currentValue = group.data.reduce((sum, item) => sum + ((item.current_pct || 0) * rebalancingData.totalValue) / 100, 0);
        const currentPct = rebalancingData.totalValue > 0 ? (currentValue / rebalancingData.totalValue) * 100 : 0;
        const targetPct = group.data.reduce((sum, item) => sum + Number(item.target_pct || 0), 0);
        const drift = targetPct > 0 ? ((currentPct - targetPct) / targetPct) * 100 : 0;
        return { ticker: group.key, drift_percentage: drift, current_pct: currentPct, target_pct: targetPct };
      });
      base = [{ key: 'Aggregated Selection', data: points }];
    }

    return base.map((slice) => ({
      ...slice,
      data: [...slice.data].sort((a, b) => b.drift_percentage - a.drift_percentage),
    }));
  })() : [];

  const chartControlsPanel = (
    <div className="mt-1.5 mb-2.5 flex w-full flex-col gap-3 md:flex-row md:items-end md:gap-4">
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
  );

  const performanceCard = (
    <Card className="cursor-pointer rounded-xl border shadow-sm" onClick={() => router.push('/dashboard/performance')}>
      <CardHeader className="space-y-3 p-4 sm:p-5">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <div className="dashboard-metric-tile">
            <Label className="dashboard-metric-label">Total Portfolio Value</Label>
            <p className="dashboard-metric-value">
              {performanceTotals ? formatUSDWhole(performanceTotals.market_value) : 'Loading...'}
            </p>
          </div>
          <div className="dashboard-metric-tile">
            <Label className="dashboard-metric-label">Total Return %</Label>
            <p className={cn('dashboard-metric-value', Number(performanceTotals?.total_return_pct ?? 0) >= 0 ? 'text-green-600' : 'text-red-600')}>
              {performanceTotals ? formatPctTenth(performanceTotals.total_return_pct) : 'Loading...'}
            </p>
          </div>
          <div className="dashboard-metric-tile">
            <Label className="dashboard-metric-label">Annualized IRR</Label>
            <p className={cn('dashboard-metric-value', Number(performanceTotals?.irr_pct ?? 0) >= 0 ? 'text-green-600' : 'text-red-600')}>
              {performanceTotals ? formatPctTenth(performanceTotals.irr_pct) : 'Loading...'}
            </p>
          </div>
        </div>
        <div className="rounded-xl border bg-card px-3.5 pt-3.5 pb-1.5 sm:px-4 sm:pt-4 sm:pb-2" onClick={(event) => event.stopPropagation()}>
          <div className="mb-3">
            <CardTitle className="text-base">Portfolio Value Bridge</CardTitle>
            <p className="text-sm text-muted-foreground">Starting Value {'->'} Net Contributions {'->'} Income {'->'} Realized {'->'} Unrealized {'->'} Terminal Value</p>
          </div>
          {performanceBridgeInput ? (
            <PortfolioValueBridge input={performanceBridgeInput} compact />
          ) : (
            <div className="flex h-[196px] sm:h-[208px] items-center justify-center text-sm text-muted-foreground">
              Loading performance waterfall...
            </div>
          )}
        </div>
      </CardHeader>
    </Card>
  );

  const strategyCard = (
    <Card className="cursor-pointer rounded-xl border shadow-sm" onClick={() => router.push('/dashboard/portfolio?tab=rebalancing')}>
      <CardContent>
        {rebalancingLoading ? (
          <p>Loading strategy data...</p>
        ) : rebalancingData ? (
          <div className="space-y-4">
            <div className="grid grid-cols-1 gap-4 items-stretch sm:grid-cols-3">
              <div className="dashboard-metric-tile h-full">
                <Label className="dashboard-metric-label">Sub-Portfolio Drift</Label>
                <p className="dashboard-metric-value">
                  {(() => {
                    const subPortfolioAllocations: { [key: string]: number } = {}
                    normalizedRebalancingAllocations.forEach((item) => {
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
              <div className="dashboard-metric-tile h-full">
                <Label className="dashboard-metric-label">Asset Drift</Label>
                <p className="dashboard-metric-value">
                  {(() => {
                    const assetDrift = rebalancingData.totalValue > 0
                      ? normalizedRebalancingAllocations.reduce((sum: number, item) => {
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
              <div className="dashboard-metric-tile h-full">
                <Label className="dashboard-metric-label">Rebalance Needed</Label>
                <p className={cn('dashboard-metric-value', normalizedRebalancingAllocations.some((item) => item.action !== 'hold') ? 'text-red-600' : 'text-green-600')}>
                  {normalizedRebalancingAllocations.some((item) => item.action !== 'hold') ? (
                    <span>Yes</span>
                  ) : (
                    'No'
                  )}
                </p>
              </div>
            </div>

            <div className="rounded-xl border bg-card p-4 sm:p-5" onClick={(event) => event.stopPropagation()}>
              <div className="mb-6 flex flex-col items-start gap-3 md:flex-row md:items-end md:gap-4">
                <div className="w-full max-w-xs md:w-56 md:max-w-none">
                  <Label className="text-[10px] font-bold uppercase mb-1 block text-left">View Lens</Label>
                  <Select value={driftLens} onValueChange={setDriftLens}>
                    <SelectTrigger className="bg-background focus:ring-0">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {DRIFT_LENSES.map((lensOption) => (
                        <SelectItem key={lensOption.value} value={lensOption.value}>{lensOption.label}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                {driftLens !== 'total' && (
                  <div className="w-full max-w-sm md:w-64 md:max-w-none">
                    <Label className="text-[10px] font-bold uppercase mb-1 block text-left">Filter Selection</Label>
                    <Popover>
                      <PopoverTrigger asChild>
                        <Button variant="outline" className="w-full justify-between bg-background">
                          {driftSelectedValues.length} selected
                          <ChevronsUpDown className="w-4 h-4 ml-2 opacity-50" />
                        </Button>
                      </PopoverTrigger>
                      <PopoverContent className="w-64 p-0">
                        <Command>
                          <CommandInput placeholder="Search..." />
                          <CommandList>
                            <CommandEmpty>No values found.</CommandEmpty>
                            <CommandGroup className="max-h-64 overflow-y-auto">
                              {driftAvailableValues.map((value) => (
                                <CommandItem key={value.value} onSelect={() => toggleDriftValue(value.value)}>
                                  <Check className={cn('w-4 h-4 mr-2', driftSelectedValues.includes(value.value) ? 'opacity-100' : 'opacity-0')} />
                                  {value.label}
                                </CommandItem>
                              ))}
                            </CommandGroup>
                          </CommandList>
                        </Command>
                      </PopoverContent>
                    </Popover>
                  </div>
                )}
                {driftLens !== 'total' && driftSelectedValues.length > 1 && (
                  <div className="flex items-center gap-2 rounded-md border bg-background p-2">
                    <Switch checked={driftAggregate} onCheckedChange={setDriftAggregate} id="homepage-drift-aggregate" />
                    <Label htmlFor="homepage-drift-aggregate" className="text-xs cursor-pointer">Aggregate</Label>
                  </div>
                )}
              </div>

              {driftChartSlices.length ? (
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                  {driftChartSlices.map((slice, idx) => (
                    <div key={`${slice.key}-${idx}`} className={cn('dashboard-chart-panel space-y-4 p-6', driftChartSlices.length === 1 && 'lg:col-span-2')}>
                      <h3 className="dashboard-contrast-pill bg-zinc-950 text-center">{driftLens === 'total' ? getDriftLensTitle(driftLens) : driftAggregate && slice.key === 'Aggregated Selection' ? getDriftLensTitle(driftLens) : slice.key} Drift Analysis</h3>
                      <div className="h-[380px]">
                        <ResponsiveContainer width="100%" height="100%">
                          <BarChart data={slice.data} layout="vertical" margin={{ left: 10, right: 30 }}>
                            <CartesianGrid strokeDasharray="3 3" horizontal={false} />
                            <XAxis type="number" unit="%" fontSize={10} axisLine={false} tickLine={false} />
                            <YAxis dataKey="ticker" type="category" interval={0} fontSize={9} width={56} />
                            <Tooltip formatter={(value: number | string | undefined) => [`${Number(value ?? 0).toFixed(1)}%`, 'Drift']} />
                            <Bar dataKey="drift_percentage">
                              {slice.data.map((entry, entryIndex) => (
                                <Cell key={`${slice.key}-${entry.ticker}-${entryIndex}`} fill={getDriftColor(entry.drift_percentage, slice.data)} />
                              ))}
                            </Bar>
                          </BarChart>
                        </ResponsiveContainer>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="flex h-[220px] items-center justify-center rounded-lg border border-dashed text-sm text-muted-foreground">
                  No drift data available for the current selection.
                </div>
              )}
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
      <div className="space-y-2 mb-4">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <div className="dashboard-metric-tile">
            <Label className="dashboard-metric-label">Total Buys</Label>
            <p className="dashboard-metric-value text-red-600">
              {formatUSDWhole(recentActivityTotals.buys)}
            </p>
          </div>
          <div className="dashboard-metric-tile">
            <Label className="dashboard-metric-label">Total Sells</Label>
            <p className="dashboard-metric-value text-green-600">
              {formatUSDWhole(recentActivityTotals.sells)}
            </p>
          </div>
          <div className="dashboard-metric-tile">
            <Label className="dashboard-metric-label">Income</Label>
            <p className="dashboard-metric-value text-green-600">
              {formatUSDWhole(recentActivityTotals.income)}
            </p>
          </div>
        </div>
        <p className="text-xs italic text-muted-foreground">Metrics reflect the last 30 days.</p>
      </div>

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
    <DashboardPageShell
      eyebrow="Overview"
      title="Portfolio Dashboard"
      description="Monitor portfolio value, performance, allocation, drift, and recent activity from a single overview."
      action={(
        <Button
          onClick={handleRefresh}
          disabled={refreshing}
          variant="refresh"
          size="sm"
          className="h-10 min-w-[180px]"
        >
          <RefreshCw className={cn('w-4 h-4 mr-2', refreshing && 'animate-spin')} />
          {refreshing ? 'Refreshing...' : 'Refresh Prices'}
        </Button>
      )}
      className="overflow-x-hidden"
    >
      {refreshMessage ? <div className="text-sm text-green-600">{refreshMessage}</div> : null}

      {loading ? (
        <div className="text-center py-12 rounded-xl border bg-background shadow-sm">Loading portfolio data...</div>
      ) : selectedValues.length === 0 && lens !== 'total' && !valuesLoading ? (
        <div className="text-center py-12 text-muted-foreground rounded-xl border bg-background shadow-sm">Select at least one value to view data.</div>
      ) : (
        <>
          <DashboardSection
            title="Key KPIs"
            isOpen={sectionState.keyKpis}
            onOpenChange={(nextOpen) => setSectionState((prev) => ({ ...prev, keyKpis: nextOpen }))}
          >
            <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-4">
              <div className="dashboard-metric-tile">
                <Label className="dashboard-metric-label">Portfolio Value</Label>
                <div className="dashboard-metric-value">{formatUSDWhole(performanceTotals?.market_value)}</div>
              </div>
              <div className="dashboard-metric-tile">
                <Label className="dashboard-metric-label">Net Gain/Loss</Label>
                <div className={cn('dashboard-metric-value', Number(performanceTotals?.net_gain ?? 0) >= 0 ? 'text-green-600' : 'text-red-600')}>
                  {formatUSDWhole(performanceTotals?.net_gain)}
                </div>
              </div>
              <div className="dashboard-metric-tile">
                <Label className="dashboard-metric-label">Total Return</Label>
                <div className={cn('dashboard-metric-value', Number(performanceTotals?.total_return_pct ?? 0) >= 0 ? 'text-green-600' : 'text-red-600')}>
                  {formatPctTenth(performanceTotals?.total_return_pct)}
                </div>
              </div>
              <div className="dashboard-metric-tile">
                <Label className="dashboard-metric-label">Rebalance Needed</Label>
                <div className={cn('dashboard-metric-value', rebalanceNeeded ? 'text-red-600' : 'text-green-600')}>
                  {rebalanceNeeded ? 'Yes' : 'No'}
                </div>
              </div>
            </div>
          </DashboardSection>

          <div className="hidden md:grid gap-4">
            <div className="grid grid-cols-2 gap-4 items-start">
              <DashboardSection
                title="Performance"
                isOpen={sectionState.performanceSnapshot}
                onOpenChange={(nextOpen) => setSectionState((prev) => ({ ...prev, performanceSnapshot: nextOpen }))}
              >
                {performanceCard}
              </DashboardSection>
              <DashboardSection
                title="Portfolio Allocation"
                isOpen={sectionState.portfolioDetails}
                onOpenChange={(nextOpen) => setSectionState((prev) => ({ ...prev, portfolioDetails: nextOpen }))}
              >
                {chartControlsPanel}
                <PortfolioDetailsCard lens={lens} selectedValues={selectedValues} aggregate={aggregate} />
              </DashboardSection>
            </div>

            <div className={cn('grid grid-cols-2 gap-4', driftChartSlices.length === 1 ? 'items-stretch' : 'items-start')}>
              <DashboardSection
                title="Recent Activity"
                isOpen={sectionState.recentActivity}
                onOpenChange={(nextOpen) => setSectionState((prev) => ({ ...prev, recentActivity: nextOpen }))}
                className={cn(driftChartSlices.length === 1 && 'flex flex-col')}
                bodyClassName={cn(driftChartSlices.length === 1 && 'flex-1')}
              >
                <Card
                  className={cn('cursor-pointer rounded-xl border shadow-sm', driftChartSlices.length === 1 && 'flex h-full flex-col')}
                  onClick={() => router.push('/dashboard/activity?tab=transactions')}
                >
                  <CardContent className={cn(driftChartSlices.length === 1 && 'flex h-full flex-col')}>
                    {recentTable}
                  </CardContent>
                </Card>
              </DashboardSection>
              <DashboardSection
                title="Portfolio Drift"
                isOpen={sectionState.strategySnapshot}
                onOpenChange={(nextOpen) => setSectionState((prev) => ({ ...prev, strategySnapshot: nextOpen }))}
              >
                {strategyCard}
              </DashboardSection>
            </div>
          </div>

          <div className="md:hidden space-y-4">
            <DashboardSection
              title="Performance"
              isOpen={sectionState.performanceSnapshot}
              onOpenChange={(nextOpen) => setSectionState((prev) => ({ ...prev, performanceSnapshot: nextOpen }))}
            >
              {performanceCard}
            </DashboardSection>

            <DashboardSection
              title="Portfolio Allocation"
              isOpen={sectionState.portfolioDetails}
              onOpenChange={(nextOpen) => setSectionState((prev) => ({ ...prev, portfolioDetails: nextOpen }))}
            >
              {chartControlsPanel}
              <PortfolioDetailsCard lens={lens} selectedValues={selectedValues} aggregate={aggregate} />
            </DashboardSection>

            <DashboardSection
              title="Portfolio Drift"
              isOpen={sectionState.strategySnapshot}
              onOpenChange={(nextOpen) => setSectionState((prev) => ({ ...prev, strategySnapshot: nextOpen }))}
            >
              {strategyCard}
            </DashboardSection>

            <DashboardSection
              title="Recent Activity"
              isOpen={sectionState.recentActivity}
              onOpenChange={(nextOpen) => setSectionState((prev) => ({ ...prev, recentActivity: nextOpen }))}
            >
              <Card className="cursor-pointer rounded-xl border shadow-sm" onClick={() => router.push('/dashboard/activity?tab=transactions')}>
                <CardContent>{recentTable}</CardContent>
              </Card>
            </DashboardSection>
          </div>
        </>
      )}
    </DashboardPageShell>
  );
}