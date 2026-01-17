'use client';

import Link from 'next/link';
import Image from 'next/image';
import './globals.css';
import { Button } from '@/components/ui/button';
import { ChatDrawer } from '@/components/ChatDrawer';
import { useChatStore } from '@/store/chatStore';
import { GrokChatTrigger } from '@/components/GrokChatTrigger';
import { LogoutButton } from '@/components/LogoutButton';
import { Popover, PopoverTrigger, PopoverContent } from '@/components/ui/popover';
import { ChevronDown } from 'lucide-react';

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
                  className="h-10 w-auto object-contain"
                />
              </Link>
              <Popover>
                <PopoverTrigger asChild>
                  <Link href="/dashboard/portfolio" className="flex items-center gap-1">
                    Portfolio Details <ChevronDown className="h-4 w-4" />
                  </Link>
                </PopoverTrigger>
                <PopoverContent className="w-48 p-2">
                  <div className="flex flex-col gap-2">
                    <Link href="/dashboard/portfolio" className="hover:bg-gray-100 p-2 rounded">Holdings</Link>
                    <Link href="/dashboard/accounts" className="hover:bg-gray-100 p-2 rounded">Accounts</Link>
                    <Link href="/dashboard/portfolio/sub-portfolios" className="hover:bg-gray-100 p-2 rounded">Sub-Portfolios</Link>
                    <Link href="/dashboard/assets" className="hover:bg-gray-100 p-2 rounded">Assets</Link>
                  </div>
                </PopoverContent>
              </Popover>
              <Popover>
                <PopoverTrigger asChild>
                  <Link href="/dashboard/strategy/targets-thresholds" className="flex items-center gap-1">
                    Strategy <ChevronDown className="h-4 w-4" />
                  </Link>
                </PopoverTrigger>
                <PopoverContent className="w-48 p-2">
                  <div className="flex flex-col gap-2">
                    <Link href="/dashboard/strategy/targets-thresholds" className="hover:bg-gray-100 p-2 rounded">Targets and Thresholds</Link>
                    <Link href="/dashboard/strategy/glide-path" className="hover:bg-gray-100 p-2 rounded">Glide Path</Link>
                    <Link href="/dashboard/strategy/drift-reporting" className="hover:bg-gray-100 p-2 rounded">Drift Reporting and Rebalancing</Link>
                  </div>
                </PopoverContent>
              </Popover>
              <Link href="/dashboard/performance">Performance</Link>
              <Popover>
                <PopoverTrigger asChild>
                  <Link href="/dashboard/transactions" className="flex items-center gap-1">
                    Activity <ChevronDown className="h-4 w-4" />
                  </Link>
                </PopoverTrigger>
                <PopoverContent className="w-48 p-2">
                  <div className="flex flex-col gap-2">
                    <Link href="/dashboard/transactions" className="hover:bg-gray-100 p-2 rounded">Transaction Log</Link>
                    <Link href="/dashboard/transactions/tax-lots" className="hover:bg-gray-100 p-2 rounded">Tax Lots</Link>
                  </div>
                </PopoverContent>
              </Popover>
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