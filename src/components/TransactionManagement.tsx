'use client'

import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import TransactionsList from './TransactionsList'
import TaxLotsList from './TaxLotsList'

type Props = {
  initialTransactions: any[] // Replace with proper Transaction[] type if using TypeScript interfaces
  initialTaxLots: any[] // Replace with proper TaxLot[] type
}

export default function TransactionManagement({ initialTransactions, initialTaxLots }: Props) {
  return (
    <Tabs defaultValue="transactions" className="p-8">
      <TabsList className="mb-8">
        <TabsTrigger value="transactions">Transactions</TabsTrigger>
        <TabsTrigger value="tax-lots">Tax Lots</TabsTrigger>
      </TabsList>
      <TabsContent value="transactions">
        <TransactionsList initialTransactions={initialTransactions} />
      </TabsContent>
      <TabsContent value="tax-lots">
        <TaxLotsList initialTaxLots={initialTaxLots} />
      </TabsContent>
    </Tabs>
  )
}