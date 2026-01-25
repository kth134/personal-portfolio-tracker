'use client';

import { useSearchParams } from 'next/navigation';
import { useRouter } from 'next/navigation';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import TransactionsList from '@/components/TransactionsList';
import TaxLotsList from '@/components/TaxLotsList';

interface ActivityTabsProps {
  initialTransactions: any[];
  initialTaxLots: any[];
  transactionsTotal: number;
  taxLotsTotal: number;
  currentPage: number;
  pageSize: number;
}

export default function ActivityTabs({ 
  initialTransactions, 
  initialTaxLots, 
  transactionsTotal, 
  taxLotsTotal, 
  currentPage, 
  pageSize 
}: ActivityTabsProps) {
  const searchParams = useSearchParams();
  const router = useRouter();
  const tab = searchParams.get('tab') || 'transactions';

  const handleTabChange = (value: string) => {
    router.push(`/dashboard/activity?tab=${value}`);
  };

  return (
    <Tabs value={tab} onValueChange={handleTabChange} className="w-full">
      <TabsList>
        <TabsTrigger value="transactions">Transactions</TabsTrigger>
        <TabsTrigger value="tax-lots">Tax Lots</TabsTrigger>
      </TabsList>
      <TabsContent value="transactions">
        <TransactionsList 
          initialTransactions={initialTransactions} 
          total={transactionsTotal}
          currentPage={currentPage}
          pageSize={pageSize}
        />
      </TabsContent>
      <TabsContent value="tax-lots">
        <TaxLotsList 
          initialTaxLots={initialTaxLots}
          total={taxLotsTotal}
          currentPage={currentPage}
          pageSize={pageSize}
        />
      </TabsContent>
    </Tabs>
  );
}