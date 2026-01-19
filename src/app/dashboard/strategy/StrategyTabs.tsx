'use client';

import { useSearchParams } from 'next/navigation';
import { useRouter } from 'next/navigation';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';

export default function StrategyTabs() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const tab = searchParams.get('tab') || 'targets';

  const handleTabChange = (value: string) => {
    router.push(`/dashboard/strategy?tab=${value}`);
  };

  return (
    <Tabs value={tab} onValueChange={handleTabChange} className="w-full">
      <TabsList>
        <TabsTrigger value="targets">Targets</TabsTrigger>
        <TabsTrigger value="glide-path">Glide Path</TabsTrigger>
        <TabsTrigger value="drift-reporting">Rebalancing</TabsTrigger>
      </TabsList>
      <TabsContent value="targets">
        <div className="text-center text-red-600 font-semibold text-lg bg-red-50 p-4 rounded-md border border-red-200">
          Under Construction
        </div>
      </TabsContent>
      <TabsContent value="glide-path">
        <div className="text-center text-red-600 font-semibold text-lg bg-red-50 p-4 rounded-md border border-red-200">
          Under Construction
        </div>
      </TabsContent>
      <TabsContent value="drift-reporting">
        <div className="text-center text-red-600 font-semibold text-lg bg-red-50 p-4 rounded-md border border-red-200">
          Under Construction
        </div>
      </TabsContent>
    </Tabs>
  );
}