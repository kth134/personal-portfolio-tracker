import Link from 'next/link';
import Image from 'next/image';
import './globals.css';
import { Button } from '@/components/ui/button';
import { ChatDrawer } from '@/components/ChatDrawer';
import { useChatStore } from '@/store/chatStore';
import { GrokChatTrigger } from '@/components/GrokChatTrigger';
import { LogoutButton } from '@/components/LogoutButton'

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-screen bg-background">
        <nav className="bg-background border-b px-4 py-3">
          <div className="container mx-auto flex justify-between items-center">
            <div className="flex gap-6">
              <Link href="/dashboard" className="flex items-center gap-2 font-semibold">
                <Image
                  src="/small-logo.png"
                  alt="RAIN Logo"
                  width={180}
                  height={60}
                  priority
                  unoptimized
                  className="h-8 w-auto object-contain"
                />
                Dashboard
              </Link>
              <Link href="/dashboard/portfolio">Portfolio</Link>
              <Link href="/dashboard/performance">Performance</Link> {/* ← NEW */}
              <Link href="/dashboard/transactions">Transactions</Link>
            </div>
            <div className="flex items-center gap-4">
              <GrokChatTrigger />
              <LogoutButton />
            </div>
          </div>
        </nav>
        {children}
        <ChatDrawer />
      </body>
    </html>
  );
}