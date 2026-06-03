import { Link, createFileRoute, useRouter } from '@tanstack/react-router'
import { useTranslation } from 'react-i18next'
import { ChevronLeft, ChevronRight, CreditCard, Info, LogOut, Tag, User } from 'lucide-react'
import { toast } from 'sonner'
import type { LucideIcon } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { useLogout } from '@/lib/user'
import { useServerVersion, type VersionInfo } from '@/lib/version'

export const Route = createFileRoute('/settings/')({
  component: SettingsIndexPage,
})

function SettingsIndexPage() {
  const router = useRouter()
  const logout = useLogout()
  const { t } = useTranslation()
  const { data: serverVersion } = useServerVersion()

  const handleLogout = async () => {
    try {
      await logout.mutateAsync()
      router.history.push('/login')
    } catch {
      toast.error(t('settings.logoutFailed'))
    }
  }

  return (
    <SettingsIndexView
      logoutPending={logout.isPending}
      onLogout={handleLogout}
      serverVersion={serverVersion}
    />
  )
}

export interface SettingsIndexViewProps {
  logoutPending: boolean
  onLogout: () => void
  serverVersion?: VersionInfo
}

export function SettingsIndexView({
  logoutPending,
  onLogout,
  serverVersion,
}: SettingsIndexViewProps) {
  const { t } = useTranslation()
  const versionDescription =
    serverVersion?.update_available && serverVersion.latest
      ? t('settings.serverVersionUpdate', { latest: serverVersion.latest })
      : t('settings.serverVersionDescription')
  return (
    <main className="mx-auto flex min-h-full max-w-2xl flex-col gap-6 p-4">
      <header className="flex items-center gap-2">
        <BackLink />
        <h1 className="text-foreground flex-1 text-2xl font-semibold">{t('settings.title')}</h1>
        <Button
          type="button"
          variant="destructive"
          size="sm"
          onClick={onLogout}
          disabled={logoutPending}
        >
          <LogOut className="size-3.5" aria-hidden="true" />
          {t('common.logout')}
        </Button>
      </header>

      <nav aria-label={t('settings.title')} className="flex flex-col gap-4">
        <ul className="border-border bg-card flex flex-col rounded-lg border">
          <SettingsLink
            to="/settings/user"
            icon={User}
            label={t('settings.user')}
            description={t('settings.userDescription')}
          />
          <SettingsLink
            to="/settings/credentials"
            icon={CreditCard}
            label={t('settings.credentials')}
            description={t('settings.credentialsDescription')}
          />
        </ul>
        {/* Meta entries (about, legal, credits) sit in their own card below the
            primary settings so they don't visually compete with the main
            actions. */}
        <ul className="border-border bg-card flex flex-col rounded-lg border">
          <SettingsLink
            to="/settings/version"
            icon={Tag}
            label={t('settings.serverVersion')}
            description={versionDescription}
            highlight={serverVersion?.update_available ?? false}
          />
          <SettingsLink
            to="/settings/attributions"
            icon={Info}
            label={t('settings.attributions')}
            description={t('settings.attributionsDescription')}
          />
        </ul>
      </nav>
    </main>
  )
}

function BackLink() {
  const { t } = useTranslation()
  return (
    <Link
      to="/"
      aria-label={t('settings.back')}
      className="text-primary hover:text-primary/80 -ml-1.5 rounded-md p-1.5 transition-colors"
    >
      <ChevronLeft className="size-5" />
    </Link>
  )
}

function SettingsLink({
  to,
  icon: Icon,
  label,
  description,
  highlight = false,
}: {
  to: '/settings/user' | '/settings/credentials' | '/settings/version' | '/settings/attributions'
  icon: LucideIcon
  label: string
  description: string
  highlight?: boolean
}) {
  return (
    <li className="border-border/40 border-t first:border-t-0">
      <Link
        to={to}
        className="hover:bg-muted/60 flex items-center gap-3 rounded-md px-3 py-3 transition-colors"
      >
        <Icon className="text-primary size-5 shrink-0" aria-hidden="true" />
        <span className="flex flex-1 flex-col">
          <span className="text-sm font-medium">{label}</span>
          <span
            className={
              highlight ? 'text-primary text-xs font-medium' : 'text-muted-foreground text-xs'
            }
          >
            {description}
          </span>
        </span>
        <ChevronRight className="text-muted-foreground size-4" aria-hidden="true" />
      </Link>
    </li>
  )
}
