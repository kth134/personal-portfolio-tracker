'use client';

import { useSearchParams } from 'next/navigation';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import TransactionManagement from '@/components/TransactionManagement';

interface ActivityTabsProps {
  initialTransactions: any[];
  initialTaxLots: any[];
}

export default function ActivityTabs({ initialTransactions, initialTaxLots }: ActivityTabsProps) {
  const searchParams = useSearchParams();
  const tab = searchParams.get('tab') || 'transactions';

  return (
    <Tabs value={tab} className="w-full">
      <TabsList>
        <TabsTrigger value="transactions">Transaction Log</TabsTrigger>
        <TabsTrigger value="tax-lots">Tax Lots</TabsTrigger>
      </TabsList>
      <TabsContent value="transactions">
        <TransactionManagement initialTransactions={initialTransactions} initialTaxLots={initialTaxLots} />
      </TabsContent>
      <TabsContent value="tax-lots">
        <div className="container mx-auto p-6">
          <p>This page is under construction and will be coming soon.</p>
        </div>
      </TabsContent>
    </Tabs>
  );
}