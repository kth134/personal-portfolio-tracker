import { Suspense } from 'react';
import PerformanceTabs from './PerformanceTabs';

export default function PerformancePage() {
  return (
    <Suspense fallback={<div className="p-8">Loading...</div>}>
      <PerformanceTabs />
    </Suspense>
  );
}