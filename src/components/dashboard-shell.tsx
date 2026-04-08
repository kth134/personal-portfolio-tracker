import type { ReactNode } from 'react'

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { cn } from '@/lib/utils'

type DashboardPageShellProps = {
  eyebrow?: string
  title: string
  description?: string
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
  children,
  className,
}: DashboardPageShellProps) {
  return (
    <main className={cn('mx-auto flex w-full max-w-[1600px] flex-col gap-6 px-4 pb-8 pt-4 sm:px-6 lg:px-8', className)}>
      <section className="overflow-hidden rounded-[28px] border border-zinc-200/70 bg-[linear-gradient(135deg,rgba(9,9,11,0.96),rgba(24,24,27,0.94)_58%,rgba(63,63,70,0.88))] px-5 py-6 text-white shadow-[0_28px_80px_-40px_rgba(9,9,11,0.85)] sm:px-7 sm:py-8">
        <div className="max-w-3xl space-y-3">
          {eyebrow ? (
            <p className="text-[11px] font-semibold uppercase tracking-[0.28em] text-white/60">{eyebrow}</p>
          ) : null}
          <div className="space-y-2">
            <h1 className="text-3xl font-semibold tracking-tight text-white sm:text-4xl">{title}</h1>
            {description ? (
              <p className="max-w-2xl text-sm leading-6 text-zinc-300 sm:text-base">{description}</p>
            ) : null}
          </div>
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
        <CardHeader className="grid gap-3 border-b border-zinc-200/70 bg-[linear-gradient(180deg,rgba(250,250,250,0.98),rgba(244,244,245,0.92))] px-5 py-4 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-start sm:px-6">
          <div className="space-y-1">
            {title ? <CardTitle className="text-lg font-semibold tracking-tight text-zinc-950">{title}</CardTitle> : null}
            {description ? <CardDescription className="text-sm leading-6 text-zinc-500">{description}</CardDescription> : null}
          </div>
          {action ? <div className="flex items-center justify-start sm:justify-end">{action}</div> : null}
        </CardHeader>
      ) : null}
      <CardContent className={cn('px-4 py-4 sm:px-6 sm:py-5', contentClassName)}>{children}</CardContent>
    </Card>
  )
}