import { Suspense } from 'react';
import StrategyTabs from './StrategyTabs';

export default function StrategyPage() {
  return (
    <main className="p-8">
      <h1 className="text-3xl font-bold mb-8">Strategy</h1>
      <Suspense fallback={<div className="p-8">Loading...</div>}>
        <StrategyTabs />
      </Suspense>
    </main>
  );
}