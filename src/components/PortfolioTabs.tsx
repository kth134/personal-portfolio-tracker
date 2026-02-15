'use client'

import { TabsList, TabsTrigger } from '@/components/ui/tabs'
import { useRouter, usePathname, useSearchParams } from 'next/navigation'

export default function PortfolioTabNavigation() {
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()

  // Determine active tab based on current path
  const getActiveTab = () => {
    if (pathname.includes('/accounts')) return 'accounts'
    if (pathname.includes('/assets')) return 'assets'
    if (pathname.includes('/strategy')) {
      return searchParams.get('tab') === 'glide-path' ? 'glide-path' : 'sub-portfolios'
    }
    return 'sub-portfolios'
  }

  const activeTab = getActiveTab()

  const handleTabChange = (value: string) => {
    switch (value) {
      case 'accounts':
        router.push('/dashboard/accounts')
        break
      case 'assets':
        router.push('/dashboard/assets')
        break
      case 'sub-portfolios':
        router.push('/dashboard/strategy?tab=sub-portfolios')
        break
      case 'glide-path':
        router.push('/dashboard/strategy?tab=glide-path')
        break
    }
  }

  return (
    <TabsList>
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
      <TabsTrigger
        value="sub-portfolios"
        data-state={activeTab === 'sub-portfolios' ? 'active' : 'inactive'}
        onClick={() => handleTabChange('sub-portfolios')}
      >
        Sub-Portfolios
      </TabsTrigger>
      <TabsTrigger
        value="glide-path"
        data-state={activeTab === 'glide-path' ? 'active' : 'inactive'}
        onClick={() => handleTabChange('glide-path')}
      >
        Glide Path
      </TabsTrigger>
    </TabsList>
  )
}