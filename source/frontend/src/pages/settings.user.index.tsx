import { Link } from '@tanstack/react-router'
import { useTranslation } from 'react-i18next'
import {
  Bell,
  ChevronRight,
  KeyRound,
  MonitorSmartphone,
  Palette,
  ShieldCheck,
  Trash2,
  User,
} from 'lucide-react'
import type { LucideIcon } from 'lucide-react'

import { cn } from '@/lib/utils'
import { BackLink } from '@/components/back-link'

type UserSettingsRoute =
  | '/settings/user/profile'
  | '/settings/user/appearance'
  | '/settings/user/authentication'
  | '/settings/user/sessions'
  | '/settings/user/api-keys'
  | '/settings/user/notifications'
  | '/settings/user/delete'

export function SettingsUserIndexView() {
  const { t } = useTranslation()
  return (
    <main className="mx-auto flex min-h-full max-w-page flex-col gap-6 p-4">
      <header className="flex items-center gap-2">
        <BackLink to="/settings" />
        <h1 className="text-foreground flex-1 text-2xl font-semibold">{t('settings.user')}</h1>
      </header>

      <nav aria-label={t('settings.user')} className="flex flex-col gap-4">
        <ul className="border-border bg-card flex flex-col rounded-lg border">
          <NavLink
            to="/settings/user/profile"
            icon={User}
            label={t('settings.profile')}
            description={t('settings.profileDescription')}
          />
          <NavLink
            to="/settings/user/appearance"
            icon={Palette}
            label={t('settings.appearance')}
            description={t('settings.appearanceDescription')}
          />
          <NavLink
            to="/settings/user/authentication"
            icon={ShieldCheck}
            label={t('settings.authentication')}
            description={t('settings.authenticationDescription')}
          />
          <NavLink
            to="/settings/user/notifications"
            icon={Bell}
            label={t('notifications.navTitle')}
            description={t('notifications.description')}
          />
          <NavLink
            to="/settings/user/api-keys"
            icon={KeyRound}
            label={t('apiKeys.title')}
            description={t('apiKeys.description')}
          />
          <NavLink
            to="/settings/user/sessions"
            icon={MonitorSmartphone}
            label={t('settings.sessions')}
            description={t('settings.sessionsDescription')}
          />
        </ul>

        {/* The destructive action sits in its own card so it never sits flush against the
            everyday settings above it. */}
        <ul className="border-border bg-card flex flex-col rounded-lg border">
          <NavLink
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

function NavLink({
  to,
  icon: Icon,
  label,
  description,
  destructive = false,
}: {
  to: UserSettingsRoute
  icon: LucideIcon
  label: string
  description: string
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
          <span className="text-muted-foreground text-xs">{description}</span>
        </span>
        <ChevronRight className="text-muted-foreground size-4" aria-hidden="true" />
      </Link>
    </li>
  )
}
