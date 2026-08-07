import { Link } from '@tanstack/react-router'
import { useTranslation } from 'react-i18next'
import {
  Bell,
  ChevronRight,
  CreditCard,
  Info,
  KeyRound,
  LogOut,
  MonitorSmartphone,
  Palette,
  ShieldCheck,
  Tag,
  Trash2,
  User,
} from 'lucide-react'
import type { LucideIcon } from 'lucide-react'

import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import type { SettingsIndexViewProps } from '@/routes/settings.index'
import { BackLink } from '@/components/back-link'

type SettingsRoute =
  | '/settings/credentials'
  | '/settings/user/profile'
  | '/settings/user/appearance'
  | '/settings/user/authentication'
  | '/settings/user/notifications'
  | '/settings/user/api-keys'
  | '/settings/user/sessions'
  | '/settings/user/delete'
  | '/settings/version'
  | '/settings/attributions'

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
    <main className="mx-auto flex min-h-full max-w-page flex-col gap-6 p-4">
      <header className="flex items-center gap-2">
        <BackLink to="/" />
        <h1 className="text-foreground flex-1 text-lg font-semibold">{t('settings.title')}</h1>
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
            to="/settings/credentials"
            icon={CreditCard}
            label={t('credentials.title')}
            description={t('settings.credentialsDescription')}
          />
        </ul>

        <ul className="border-border bg-card flex flex-col rounded-lg border">
          <SettingsLink
            to="/settings/user/profile"
            icon={User}
            label={t('settings.profile')}
            description={t('settings.profileDescription')}
          />
          <SettingsLink
            to="/settings/user/appearance"
            icon={Palette}
            label={t('settings.appearance')}
            description={t('settings.appearanceDescription')}
          />
          <SettingsLink
            to="/settings/user/authentication"
            icon={ShieldCheck}
            label={t('settings.authentication')}
            description={t('settings.authenticationDescription')}
          />
          <SettingsLink
            to="/settings/user/notifications"
            icon={Bell}
            label={t('notifications.navTitle')}
            description={t('notifications.description')}
          />
          <SettingsLink
            to="/settings/user/api-keys"
            icon={KeyRound}
            label={t('apiKeys.title')}
            description={t('apiKeys.description')}
          />
          <SettingsLink
            to="/settings/user/sessions"
            icon={MonitorSmartphone}
            label={t('settings.sessions')}
            description={t('settings.sessionsDescription')}
          />
        </ul>

        {/* Meta entries (about, legal, credits) sit in their own card below the
            primary settings so they don't visually compete with the main
            actions. */}
        <ul className="border-border bg-card flex flex-col rounded-lg border">
          <SettingsLink
            to="/settings/version"
            icon={Tag}
            label={t('version.title')}
            description={versionDescription}
            highlight={serverVersion?.update_available ?? false}
          />
          <SettingsLink
            to="/settings/attributions"
            icon={Info}
            label={t('attributions.title')}
            description={t('settings.attributionsDescription')}
          />
        </ul>

        <ul className="border-border bg-card flex flex-col rounded-lg border">
          <SettingsLink
            to="/settings/user/delete"
            icon={Trash2}
            label={t('common.deleteAccount')}
            description={t('settings.deleteDescription')}
            destructive
          />
        </ul>
      </nav>
    </main>
  )
}

function SettingsLink({
  to,
  icon: Icon,
  label,
  description,
  highlight = false,
  destructive = false,
}: {
  to: SettingsRoute
  icon: LucideIcon
  label: string
  description: string
  highlight?: boolean
  destructive?: boolean
}) {
  return (
    <li className="border-border/40 border-t first:border-t-0">
      <Link
        to={to}
        className="hover:bg-muted/60 flex items-center gap-3 rounded-md px-3 py-3 transition-colors"
      >
        <Icon
          className={cn('size-5 shrink-0', destructive ? 'text-destructive' : 'text-primary')}
          aria-hidden="true"
        />
        <span className="flex flex-1 flex-col">
          <span className={cn('text-sm font-medium', destructive && 'text-destructive')}>
            {label}
          </span>
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
