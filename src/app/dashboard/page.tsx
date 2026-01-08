import Link from 'next/link'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'

export default function DashboardHome() {
  return (
    <main className="p-8">
      <h1 className="text-3xl font-bold mb-8">Portfolio Dashboard</h1>
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        <Card>
          <CardHeader><CardTitle>Portfolio</CardTitle></CardHeader>
          <CardContent>
            <Link href="/dashboard/portfolio">
              <Button variant="outline" className="w-full">View & Manage Portfolio</Button>
            </Link>
          </CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle>Transaction Log and Tax Lot Management</CardTitle></CardHeader>
          <CardContent>
            <Link href="/dashboard/transactions">
              <Button variant="outline" className="w-full">View & Manage</Button>
            </Link>
          </CardContent>
        </Card>
        {/* Add more cards for future: Allocation, Performance, etc. */}
      </div>
    </main>
  )
}