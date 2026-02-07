'use client';

import { useSearchParams } from 'next/navigation';
import { useRouter } from 'next/navigation';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import PortfolioHoldingsWithSlicers from './PortfolioHoldingsWithSlicers';
import RebalancingPage from '../strategy/RebalancingPage';

interface PortfolioTabsProps {
  lots: any[] | null;
  totalCash: number;
  cashByAccountName: Map<string, number>;
}

export default function PortfolioTabs({ lots, totalCash, cashByAccountName }: PortfolioTabsProps) {
  const searchParams = useSearchParams();
  const router = useRouter();
  const tab = searchParams.get('tab') || 'holdings';

  const handleTabChange = (value: string) => {
    router.push(`/dashboard/portfolio?tab=${value}`);
  };

  return (
    <Tabs value={tab} onValueChange={handleTabChange} className="w-full">
      <TabsList>
        <TabsTrigger value="holdings">Holdings</TabsTrigger>
        <TabsTrigger value="rebalancing">Rebalancing</TabsTrigger>
      </TabsList>

      <TabsContent value="holdings">
        {lots?.length ? (
          <PortfolioHoldingsWithSlicers
            cash={totalCash}
            cashByAccountName={cashByAccountName}
          />
        ) : (
          <div className="text-center py-12 text-muted-foreground">
            <p className="text-lg mb-2">No holdings yet</p>
            <p>Add a Buy transaction to see positions here.</p>
          </div>
        )}
      </TabsContent>

      <TabsContent value="rebalancing">
        <RebalancingPage />
      </TabsContent>
    </Tabs>
  );
}