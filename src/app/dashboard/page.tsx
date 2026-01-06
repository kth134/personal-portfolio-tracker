import Link from 'next/link'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'

export default function DashboardHome() {
  return (
    <main className="p-8">
      <h1 className="text-3xl font-bold mb-8">Portfolio Dashboard</h1>
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        <Card>
          <CardHeader><CardTitle>Accounts</CardTitle></CardHeader>
          <CardContent>
            <Link href="/dashboard/accounts">
              <Button variant="outline" className="w-full">Manage Accounts</Button>
            </Link>
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle>Assets</CardTitle></CardHeader>
          <CardContent>
            <Link href="/dashboard/assets">
              <Button variant="outline" className="w-full">Manage Assets</Button>
            </Link>
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle>Transactions</CardTitle></CardHeader>
          <CardContent>
            <Link href="/dashboard/transactions">
              <Button variant="outline" className="w-full">View & Add Transactions</Button>
            </Link>
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle>Holdings</CardTitle></CardHeader>
          <CardContent>
            <Link href="/dashboard/holdings">
              <Button variant="outline" className="w-full">Current Positions & Basis</Button>
            </Link>
          </CardContent>
        </Card>

        {/* Add more cards for future: Allocation, Performance, etc. */}
      </div>
    </main>
  )
}