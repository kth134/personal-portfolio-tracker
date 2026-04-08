import { Suspense } from 'react';
import PerformanceTabs from './PerformanceTabs';
import { DashboardPageShell } from '@/components/dashboard-shell';
import { BannerRefreshButton } from '@/components/BannerRefreshButton';

export default function PerformancePage() {
  return (
    <DashboardPageShell
      eyebrow="Performance"
      title="Performance"
      description="Review portfolio performance snapshots, grouped attribution, and report views across your holdings and cash flows."
      action={<BannerRefreshButton eventName="dashboard:performance-refresh" />}
    >
      <Suspense fallback={<div className="p-8">Loading...</div>}>
        <PerformanceTabs />
      </Suspense>
    </DashboardPageShell>
  );
}