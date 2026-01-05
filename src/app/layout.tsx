import './globals.css'
import Link from 'next/link'
import { Button } from '@/components/ui/button'

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-screen bg-background">
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
