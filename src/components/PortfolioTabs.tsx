'use client'

import { TabsList, TabsTrigger } from '@/components/ui/tabs'
import { useRouter, usePathname } from 'next/navigation'

export default function PortfolioTabNavigation() {
  const router = useRouter()
  const pathname = usePathname()

  // Determine active tab based on current path
  const getActiveTab = () => {
    if (pathname.includes('/accounts')) return 'accounts'
    if (pathname.includes('/assets')) return 'assets'
    if (pathname.includes('/portfolio') || pathname === '/dashboard/portfolio') return 'holdings'
    return 'holdings'
  }

  const activeTab = getActiveTab()

  const handleTabChange = (value: string) => {
    switch (value) {
      case 'holdings':
        router.push('/dashboard/portfolio')
        break
      case 'accounts':
        router.push('/dashboard/accounts')
        break
      case 'assets':
        router.push('/dashboard/assets')
        break
    }
  }

  return (
    <TabsList>
      <TabsTrigger
        value="holdings"
        data-state={activeTab === 'holdings' ? 'active' : 'inactive'}
        onClick={() => handleTabChange('holdings')}
      >
        Holdings
      </TabsTrigger>
      <TabsTrigger
        value="accounts"
        data-state={activeTab === 'accounts' ? 'active' : 'inactive'}
        onClick={() => handleTabChange('accounts')}
      >
        Accounts
      </TabsTrigger>
      <TabsTrigger
        value="assets"
        data-state={activeTab === 'assets' ? 'active' : 'inactive'}
        onClick={() => handleTabChange('assets')}
      >
        Assets
      </TabsTrigger>
    </TabsList>
  )
}