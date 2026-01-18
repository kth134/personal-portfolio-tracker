'use client';

import { useSearchParams } from 'next/navigation';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import PerformanceContent from './PerformanceContent';

export default function PerformanceTabs() {
  const searchParams = useSearchParams();
  const tab = searchParams.get('tab') || 'data';

  return (
    <Tabs value={tab} className="w-full">
      <TabsList>
        <TabsTrigger value="data">Data</TabsTrigger>
        <TabsTrigger value="reports">Reports</TabsTrigger>
      </TabsList>
      <TabsContent value="data">
        <PerformanceContent />
      </TabsContent>
      <TabsContent value="reports">
        <div className="p-8">Under Construction</div>
      </TabsContent>
    </Tabs>
  );
}