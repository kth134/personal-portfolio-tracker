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
import { Menu, X } from 'lucide-react';
import { useState } from 'react';

export default function RootLayout({ children }: { children: React.ReactNode }) {
  const [portfolioOpen, setPortfolioOpen] = useState(false);
  const [strategyOpen, setStrategyOpen] = useState(false);
  const [performanceOpen, setPerformanceOpen] = useState(false);
  const [activityOpen, setActivityOpen] = useState(false);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  return (
    <html lang="en">
      <body className="min-h-screen bg-background">
        <nav className="bg-background border-b px-4 py-3 relative">
          <div className="container mx-auto">
            {/* Desktop Layout */}
            <div className="hidden md:flex items-center relative">
              <Link href="/dashboard" className="flex items-center gap-2 font-semibold absolute left-0">
                <Image
                  src="/small-logo.png"
                  alt="RAIN Logo"
                  width={259}
                  height={86}
                  priority
                  unoptimized
                  className="h-12 w-auto sm:h-16 object-contain"
                />
              </Link>
              <div className="flex gap-6 mx-auto">
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
                <Popover open={performanceOpen} onOpenChange={setPerformanceOpen}>
                  <PopoverTrigger asChild>
                    <Link href="/dashboard/performance" className="flex items-center gap-1" onMouseEnter={() => setPerformanceOpen(true)} onMouseLeave={() => setPerformanceOpen(false)}>
                      Performance <ChevronDown className="h-4 w-4" />
                    </Link>
                  </PopoverTrigger>
                  <PopoverContent className="w-48 p-2" onMouseEnter={() => setPerformanceOpen(true)} onMouseLeave={() => setPerformanceOpen(false)}>
                    <div className="flex flex-col gap-2">
                      <Link href="/dashboard/performance" className="hover:bg-gray-100 p-2 rounded">Data</Link>
                      <Link href="/dashboard/performance?tab=reports" className="hover:bg-gray-100 p-2 rounded">Reports</Link>
                    </div>
                  </PopoverContent>
                </Popover>
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
              <div className="flex items-center gap-4 absolute right-0">
                <GrokChatTrigger />
                <Button variant="outline" size="sm" asChild>
                  <a href="/dashboard/profile">Profile</a>
                </Button>
                <LogoutButton />
              </div>
            </div>

            {/* Mobile Layout */}
            <div className="md:hidden flex justify-between items-center">
              <Link href="/dashboard" className="flex items-center gap-2 font-semibold">
                <Image
                  src="/small-logo.png"
                  alt="RAIN Logo"
                  width={259}
                  height={86}
                  priority
                  unoptimized
                  className="h-12 w-auto object-contain"
                />
              </Link>
              <div className="flex items-center gap-2">
                <GrokChatTrigger />
                <LogoutButton />
                <Button variant="ghost" size="sm" onClick={() => setMobileMenuOpen(!mobileMenuOpen)}>
                  {mobileMenuOpen ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
                </Button>
              </div>
            </div>

            {/* Mobile Menu Overlay */}
            <div className={`md:hidden absolute top-full left-0 right-0 bg-background shadow-lg z-50 transition-all duration-200 ${mobileMenuOpen ? 'opacity-100 visible' : 'opacity-0 invisible'}`}>
              <div className="px-4 py-4 space-y-4">
                <div className="space-y-2">
                  <div className="font-semibold text-sm text-muted-foreground mb-2">Navigation</div>
                  <Link href="/dashboard/portfolio" className="block py-2 px-3 rounded hover:bg-gray-100" onClick={() => setMobileMenuOpen(false)}>
                    Portfolio Details
                  </Link>
                  <Link href="/dashboard/strategy/targets-thresholds" className="block py-2 px-3 rounded hover:bg-gray-100" onClick={() => setMobileMenuOpen(false)}>
                    Strategy
                  </Link>
                  <Link href="/dashboard/performance" className="block py-2 px-3 rounded hover:bg-gray-100" onClick={() => setMobileMenuOpen(false)}>
                    Performance
                  </Link>
                  <Link href="/dashboard/transactions" className="block py-2 px-3 rounded hover:bg-gray-100" onClick={() => setMobileMenuOpen(false)}>
                    Activity
                  </Link>
                </div>
                <div className="border-t pt-4">
                  <Button variant="outline" size="sm" className="w-full" asChild>
                    <a href="/dashboard/profile">Profile</a>
                  </Button>
                </div>
              </div>
            </div>
          </div>
        </nav>
        {children}
        <ChatDrawer />
      </body>
    </html>
  );
}