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
import { useState } from 'react';

export default function RootLayout({ children }: { children: React.ReactNode }) {
  const [portfolioOpen, setPortfolioOpen] = useState(false);
  const [strategyOpen, setStrategyOpen] = useState(false);
  const [activityOpen, setActivityOpen] = useState(false);

  return (
    <html lang="en">
      <body className="min-h-screen bg-background">
        <nav className="bg-background border-b px-4 py-3">
          <div className="container mx-auto flex justify-between items-center">
            <Link href="/dashboard" className="flex items-center gap-2 font-semibold">
              <Image
                src="/small-logo.png"
                alt="RAIN Logo"
                width={180}
                height={60}
                priority
                unoptimized
                className="h-8 w-auto sm:h-10 object-contain"
              />
            </Link>
            <div className="hidden md:flex gap-6">
              <Popover open={portfolioOpen} onOpenChange={setPortfolioOpen}>
                <PopoverTrigger asChild>
                  <Link href="/dashboard/portfolio" className="flex items-center gap-1" onMouseEnter={() => setPortfolioOpen(true)} onMouseLeave={() => setPortfolioOpen(false)}>
                    Portfolio Details <ChevronDown className="h-4 w-4" />
                  </Link>
                </PopoverTrigger>
                <PopoverContent className="w-48 p-2" onMouseEnter={() => setPortfolioOpen(true)} onMouseLeave={() => setPortfolioOpen(false)}>
                  <div className="flex flex-col gap-2">
                    <Link href="/dashboard/portfolio" className="hover:bg-gray-100 p-2 rounded">Holdings</Link>
                    <Link href="/dashboard/accounts" className="hover:bg-gray-100 p-2 rounded">Accounts</Link>
                    <Link href="/dashboard/portfolio/sub-portfolios" className="hover:bg-gray-100 p-2 rounded">Sub-Portfolios</Link>
                    <Link href="/dashboard/assets" className="hover:bg-gray-100 p-2 rounded">Assets</Link>
                  </div>
                </PopoverContent>
              </Popover>
              <Popover open={strategyOpen} onOpenChange={setStrategyOpen}>
                <PopoverTrigger asChild>
                  <Link href="/dashboard/strategy/targets-thresholds" className="flex items-center gap-1" onMouseEnter={() => setStrategyOpen(true)} onMouseLeave={() => setStrategyOpen(false)}>
                    Strategy <ChevronDown className="h-4 w-4" />
                  </Link>
                </PopoverTrigger>
                <PopoverContent className="w-48 p-2" onMouseEnter={() => setStrategyOpen(true)} onMouseLeave={() => setStrategyOpen(false)}>
                  <div className="flex flex-col gap-2">
                    <Link href="/dashboard/strategy/targets-thresholds" className="hover:bg-gray-100 p-2 rounded">Targets and Thresholds</Link>
                    <Link href="/dashboard/strategy/glide-path" className="hover:bg-gray-100 p-2 rounded">Glide Path</Link>
                    <Link href="/dashboard/strategy/drift-reporting" className="hover:bg-gray-100 p-2 rounded">Drift Reporting and Rebalancing</Link>
                  </div>
                </PopoverContent>
              </Popover>
              <Link href="/dashboard/performance" className="flex items-center">Performance</Link>
              <Popover open={activityOpen} onOpenChange={setActivityOpen}>
                <PopoverTrigger asChild>
                  <Link href="/dashboard/transactions" className="flex items-center gap-1" onMouseEnter={() => setActivityOpen(true)} onMouseLeave={() => setActivityOpen(false)}>
                    Activity <ChevronDown className="h-4 w-4" />
                  </Link>
                </PopoverTrigger>
                <PopoverContent className="w-48 p-2" onMouseEnter={() => setActivityOpen(true)} onMouseLeave={() => setActivityOpen(false)}>
                  <div className="flex flex-col gap-2">
                    <Link href="/dashboard/transactions" className="hover:bg-gray-100 p-2 rounded">Transaction Log</Link>
                    <Link href="/dashboard/transactions/tax-lots" className="hover:bg-gray-100 p-2 rounded">Tax Lots</Link>
                  </div>
                </PopoverContent>
              </Popover>
            </div>
            <div className="flex items-center gap-2 md:gap-4">
              <GrokChatTrigger />
              <Button variant="outline" size="sm" className="hidden sm:inline-flex" asChild>
                <a href="/dashboard/profile">Profile</a>
              </Button>
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