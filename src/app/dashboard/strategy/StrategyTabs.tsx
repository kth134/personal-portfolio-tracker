'use client';

import { useSearchParams } from 'next/navigation';
import { useRouter } from 'next/navigation';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import SubPortfoliosList from '@/components/SubPortfoliosList';
import RebalancingPage from './RebalancingPage';

interface StrategyTabsProps {
  initialSubPortfolios: any[];
}

export default function StrategyTabs({ initialSubPortfolios }: StrategyTabsProps) {
  const searchParams = useSearchParams();
  const router = useRouter();
  const tab = searchParams.get('tab') || 'sub-portfolios';

  const handleTabChange = (value: string) => {
    router.push(`/dashboard/strategy?tab=${value}`);
  };

  return (
    <Tabs value={tab} onValueChange={handleTabChange} className="w-full">
      <TabsList>
        <TabsTrigger value="sub-portfolios">Sub-Portfolios</TabsTrigger>
        <TabsTrigger value="rebalancing">Rebalancing</TabsTrigger>
        <TabsTrigger value="glide-path">Glide Path</TabsTrigger>
      </TabsList>
      <TabsContent value="sub-portfolios">
        <SubPortfoliosList initialSubPortfolios={initialSubPortfolios} />
      </TabsContent>
      <TabsContent value="rebalancing">
        <RebalancingPage />
      </TabsContent>
      <TabsContent value="glide-path">
        <div className="text-center text-red-600 font-semibold text-lg bg-red-50 p-4 rounded-md border border-red-200">
          Under Construction
        </div>
      </TabsContent>
    </Tabs>
  );
}