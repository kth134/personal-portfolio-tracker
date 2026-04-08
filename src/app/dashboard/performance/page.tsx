import { Suspense } from 'react';
import PerformanceTabs from './PerformanceTabs';
import { DashboardPageShell } from '@/components/dashboard-shell';

export default function PerformancePage() {
  return (
    <DashboardPageShell
      eyebrow="Performance"
      title="Performance"
      description="Track point-in-time performance data and reports in the same dashboard tile language used on the home screen."
    >
      <Suspense fallback={<div className="p-8">Loading...</div>}>
        <PerformanceTabs />
      </Suspense>
    </DashboardPageShell>
  );
}