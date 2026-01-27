'use client'

import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { useRouter } from 'next/navigation'
import TransactionsList from './TransactionsList'
import TaxLotsList from './TaxLotsList'

type Props = {
  initialTransactions: any[] // Replace with proper Transaction[] type if using TypeScript interfaces
  initialTaxLots: any[] // Replace with proper TaxLot[] type
  transactionsTotal: number
  taxLotsTotal: number
  currentPage: number
  pageSize: number
  currentTab?: string
}

export default function TransactionManagement({ 
  initialTransactions, 
  initialTaxLots, 
  transactionsTotal, 
  taxLotsTotal, 
  currentPage, 
  pageSize,
  currentTab = 'transactions'
}: Props) {
  const router = useRouter()

  const handleTabChange = (value: string) => {
    router.push(`/dashboard/transactions?tab=${value}&page=${currentPage}`)
  }

  return (
    <Tabs value={currentTab} onValueChange={handleTabChange} className="p-8">
      <TabsList className="mb-8">
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
  )
}