import { Suspense } from 'react';
import PerformanceTabs from './PerformanceTabs';

export default function PerformancePage() {
  return (
    <main className="p-8">
      <h1 className="text-3xl font-bold mb-8">Performance</h1>
      <Suspense fallback={<div className="p-8">Loading...</div>}>
        <PerformanceTabs />
      </Suspense>
    </main>
  );
}