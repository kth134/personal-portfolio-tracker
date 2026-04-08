import type { ReactNode } from 'react'

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { cn } from '@/lib/utils'

type DashboardPageShellProps = {
  eyebrow?: string
  title: string
  description?: string
  action?: ReactNode
  children: ReactNode
  className?: string
}

type DashboardSurfaceProps = {
  title?: string
  description?: string
  action?: ReactNode
  children: ReactNode
  className?: string
  contentClassName?: string
}

export function DashboardPageShell({
  eyebrow,
  title,
  description,
  action,
  children,
  className,
}: DashboardPageShellProps) {
  return (
    <main className={cn('mx-auto flex w-full max-w-[1600px] flex-col gap-6 px-4 pb-8 pt-4 sm:px-6 lg:px-8', className)}>
      <section className="dashboard-page-banner">
        <div className={cn('grid gap-6', action ? 'md:grid-cols-2 md:items-center' : '')}>
          <div className="max-w-3xl space-y-3">
            {eyebrow ? (
              <p className="text-[11px] font-semibold uppercase tracking-[0.28em] text-white/60">{eyebrow}</p>
            ) : null}
            <div className="space-y-2">
              <h1 className="text-3xl font-semibold tracking-tight text-white sm:text-4xl">{title}</h1>
              {description ? (
                <p className="max-w-2xl text-sm leading-6 text-white/78 sm:text-base">{description}</p>
              ) : null}
            </div>
          </div>
          {action ? <div className="flex items-center justify-center md:min-h-full">{action}</div> : null}
        </div>
      </section>
      {children}
    </main>
  )
}

export function DashboardSurface({
  title,
  description,
  action,
  children,
  className,
  contentClassName,
}: DashboardSurfaceProps) {
  return (
    <Card className={cn('overflow-hidden rounded-[26px] border border-zinc-200/80 bg-white/95 py-0 shadow-[0_20px_70px_-36px_rgba(15,23,42,0.35)] backdrop-blur', className)}>
      {title || description || action ? (
        <CardHeader className="dashboard-surface-header">
          <div className="space-y-1">
            {title ? <CardTitle className="dashboard-section-header-title text-lg">{title}</CardTitle> : null}
            {description ? <CardDescription className="dashboard-surface-description">{description}</CardDescription> : null}
          </div>
          {action ? <div className="flex items-center justify-start sm:justify-end">{action}</div> : null}
        </CardHeader>
      ) : null}
      <CardContent className={cn('px-4 py-4 sm:px-6 sm:py-5', contentClassName)}>{children}</CardContent>
    </Card>
  )
}