'use client'

import { useState } from 'react'

import { RefreshCw } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

type BannerRefreshButtonProps = {
  eventName: string
  idleLabel?: string
  pendingLabel?: string
}

type RefreshEventDetail = {
  register?: (promise: Promise<unknown>) => void
}

export function BannerRefreshButton({
  eventName,
  idleLabel = 'Refresh Prices',
  pendingLabel = 'Refreshing...',
}: BannerRefreshButtonProps) {
  const [refreshing, setRefreshing] = useState(false)

  const handleClick = async () => {
    setRefreshing(true)
    try {
      const registrations: Promise<unknown>[] = []
      window.dispatchEvent(new CustomEvent<RefreshEventDetail>(eventName, {
        detail: {
          register: (promise) => {
            registrations.push(promise)
          },
        },
      }))

      if (registrations.length > 0) {
        await Promise.allSettled(registrations)
      }
    } finally {
      setRefreshing(false)
    }
  }

  return (
    <Button onClick={handleClick} disabled={refreshing} variant="refresh" size="sm" className="h-10 min-w-[180px]">
      <RefreshCw className={cn('h-4 w-4', refreshing && 'animate-spin')} />
      {refreshing ? pendingLabel : idleLabel}
    </Button>
  )
}