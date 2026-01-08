import Link from 'next/link';
import './globals.css'
import { Button } from '@/components/ui/button'

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-screen bg-background">
        <nav className="bg-background border-b px-4 py-3">
          <div className="container mx-auto flex justify-between items-center">
            <div className="flex gap-6">
              <Link href="/dashboard" className="font-semibold">Dashboard</Link>
              <Link href="/dashboard/portfolio">Portfolio</Link>
              <Link href="/dashboard/transactions">Transactions</Link>
            </div>
            <div className="text-sm text-muted-foreground">
              Personal Portfolio Tracker
            </div>
          </div>
        </nav>
        <nav className="border-b bg-background p-4">
          <div className="max-w-7xl mx-auto flex justify-between items-center">
            <Link href="/dashboard" className="text-2xl font-bold">
              Portfolio Tracker
            </Link>
            {/* Optional: Add user menu/logout here later */}
          </div>
        </nav>
        {children}
      </body>
    </html>
  )
}
