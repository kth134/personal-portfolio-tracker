'use client';

import { useSearchParams } from 'next/navigation';
import { useRouter } from 'next/navigation';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import SubPortfoliosList from '@/components/SubPortfoliosList';

interface StrategyTabsProps {
  initialSubPortfolios: any[];
}

export default function StrategyTabs({ initialSubPortfolios }: StrategyTabsProps) {
  const searchParams = useSearchParams();
  const router = useRouter();
  const tabRaw = searchParams.get('tab') || 'sub-portfolios';
  const tab = ['accounts', 'assets', 'sub-portfolios', 'glide-path'].includes(tabRaw)
    ? tabRaw
    : 'sub-portfolios';

  const handleTabChange = (value: string) => {
    switch (value) {
      case 'accounts':
        router.push('/dashboard/accounts');
        return;
      case 'assets':
        router.push('/dashboard/assets');
        return;
      case 'sub-portfolios':
      case 'glide-path':
        router.push(`/dashboard/strategy?tab=${value}`);
        return;
      default:
        router.push('/dashboard/strategy?tab=sub-portfolios');
    }
  };

  return (
    <Tabs value={tab} onValueChange={handleTabChange} className="w-full">
      <TabsList>
        <TabsTrigger value="accounts">Accounts</TabsTrigger>
        <TabsTrigger value="assets">Assets</TabsTrigger>
        <TabsTrigger value="sub-portfolios">Sub-Portfolios</TabsTrigger>
        <TabsTrigger value="glide-path">Glide Path</TabsTrigger>
      </TabsList>
      <TabsContent value="sub-portfolios">
        <SubPortfoliosList initialSubPortfolios={initialSubPortfolios} />
      </TabsContent>
      <TabsContent value="glide-path">
        <div className="text-center text-red-600 font-semibold text-lg bg-red-50 p-4 rounded-md border border-red-200">
          Under Construction
        </div>
      </TabsContent>
    </Tabs>
  );
}