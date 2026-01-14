import { Suspense } from 'react';
import PerformanceContent from './PerformanceContent';

export default function PerformancePage() {
  return (
    <Suspense fallback={<div className="p-8">Loading...</div>}>
      <PerformanceContent />
    </Suspense>
  );
}