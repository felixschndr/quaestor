import { Link } from '@tanstack/react-router'
import { ChevronLeft } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { ApiError } from '@/lib/api'

/**
 * Layout shell shared by every user-setting sub-page: a centred column with a header
 * that always links back to the user-settings overview.
 */
export function SettingsSubPage({
  title,
  headerExtra,
  children,
}: {
  title: string
  headerExtra?: React.ReactNode
  children: React.ReactNode
}) {
  const { t } = useTranslation()
  return (
    <main className="mx-auto flex min-h-full max-w-2xl flex-col gap-8 p-4">
      <header className="flex items-center gap-2">
        <Link
          to="/settings/user"
          aria-label={t('settings.back')}
          className="text-primary hover:text-primary/80 -ml-1.5 rounded-md p-1.5 transition-colors"
        >
          <ChevronLeft className="size-5" />
        </Link>
        <h1 className="text-foreground flex-1 text-2xl font-semibold">{title}</h1>
        {headerExtra}
      </header>
      {children}
    </main>
  )
}

export function Section({
  title,
  description,
  children,
}: {
  title: string
  description?: string
  children: React.ReactNode
}) {
  return (
    <section className="border-border bg-card flex flex-col gap-4 rounded-lg border p-4">
      <div className="flex flex-col gap-1">
        <h2 className="text-foreground text-lg font-semibold">{title}</h2>
        {description ? <p className="text-muted-foreground text-sm">{description}</p> : null}
      </div>
      {children}
    </section>
  )
}

export interface FieldRowProps extends React.ComponentProps<'input'> {
  id: string
  label: string
  error?: string
  hideLabel?: boolean
}

export const FieldRow = ({ id, label, error, hideLabel, ...rest }: FieldRowProps) => (
  <div className="flex flex-col gap-1.5">
    {hideLabel ? null : <Label htmlFor={id}>{label}</Label>}
    <Input
      id={id}
      aria-label={hideLabel ? label : undefined}
      aria-invalid={error ? true : undefined}
      aria-describedby={error ? `${id}-error` : undefined}
      {...rest}
    />
    {error ? (
      <p id={`${id}-error`} role="alert" className="text-destructive text-xs">
        {error}
      </p>
    ) : null}
  </div>
)

export function readApiErrorMessage(err: unknown, t: (key: string) => string): string {
  if (err instanceof ApiError) {
    if (err.status === 422 && err.body && typeof err.body === 'object') {
      const detail = (err.body as { detail?: unknown }).detail
      if (Array.isArray(detail) && detail.length > 0) {
        const first = detail[0]
        if (first && typeof first === 'object' && 'msg' in first) {
          return String((first as { msg: unknown }).msg)
        }
      }
      if (typeof detail === 'string') return detail
    }
    if (err.status === 429) return t('login.rateLimited')
  }
  return t('login.genericError')
}
