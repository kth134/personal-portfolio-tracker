'use client';

import { useSearchParams } from 'next/navigation';
import { useRouter } from 'next/navigation';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import PerformanceContent from './PerformanceContent';
import PerformanceReports from './PerformanceReports';

export default function PerformanceTabs() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const tab = searchParams.get('tab') || 'data';

  const handleTabChange = (value: string) => {
    router.push(`/dashboard/performance?tab=${value}`);
  };

  return (
    <Tabs value={tab} onValueChange={handleTabChange} className="w-full">
      <TabsList>
        <TabsTrigger value="data">Data</TabsTrigger>
        <TabsTrigger value="reports">Reports</TabsTrigger>
      </TabsList>
      <TabsContent value="data">
        <PerformanceContent />
      </TabsContent>
      <TabsContent value="reports">
        <PerformanceReports />
      </TabsContent>
    </Tabs>
  );
}