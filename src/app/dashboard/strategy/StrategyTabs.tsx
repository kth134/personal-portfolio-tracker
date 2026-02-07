'use client';

import { useSearchParams } from 'next/navigation';
import { useRouter } from 'next/navigation';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import SubPortfoliosList from '@/components/SubPortfoliosList';
import AccountsList from '@/components/AccountsList';
import AssetsList from '@/components/AssetsList';

interface StrategyTabsProps {
  initialSubPortfolios: any[];
  initialAccounts: any[];
  initialAssets: any[];
}

export default function StrategyTabs({ initialSubPortfolios, initialAccounts, initialAssets }: StrategyTabsProps) {
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
        <TabsTrigger value="accounts">Accounts</TabsTrigger>
        <TabsTrigger value="assets">Assets</TabsTrigger>
        <TabsTrigger value="glide-path">Glide Path</TabsTrigger>
      </TabsList>
      <TabsContent value="sub-portfolios">
        <SubPortfoliosList initialSubPortfolios={initialSubPortfolios} />
      </TabsContent>
      <TabsContent value="accounts">
        <AccountsList initialAccounts={initialAccounts} />
      </TabsContent>
      <TabsContent value="assets">
        <AssetsList initialAssets={initialAssets} />
      </TabsContent>
      <TabsContent value="glide-path">
        <div className="text-center text-red-600 font-semibold text-lg bg-red-50 p-4 rounded-md border border-red-200">
          Under Construction
        </div>
      </TabsContent>
    </Tabs>
  );
}