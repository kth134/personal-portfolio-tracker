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
    <Tabs value={tab} onValueChange={handleTabChange} className="dashboard-tabs w-full">
      <TabsList className="w-full sm:w-auto">
        <TabsTrigger value="accounts">Accounts</TabsTrigger>
        <TabsTrigger value="assets">Assets</TabsTrigger>
        <TabsTrigger value="sub-portfolios">Sub-Portfolios</TabsTrigger>
        <TabsTrigger value="glide-path">Glide Path</TabsTrigger>
      </TabsList>
      <TabsContent value="sub-portfolios" className="mt-0">
        <SubPortfoliosList initialSubPortfolios={initialSubPortfolios} />
      </TabsContent>
      <TabsContent value="glide-path" className="mt-0">
        <div className="rounded-[24px] border border-red-200 bg-red-50 px-6 py-8 text-center text-lg font-semibold text-red-600 shadow-sm">
          Under Construction
        </div>
      </TabsContent>
    </Tabs>
  );
}