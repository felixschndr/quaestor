import { Link, createFileRoute } from '@tanstack/react-router'
import { useTranslation } from 'react-i18next'
import { ChevronLeft, ChevronRight, LayoutGrid, Plus } from 'lucide-react'
import type { TFunction } from 'i18next'

import { Button } from '@/components/ui/button'
import { BankLogo } from '@/components/BankLogo'
import { useAuthMe, type CredentialRead, type UserRead } from '@/lib/auth'
import { formatDateTime } from '@/lib/format'

function bankTitle(t: TFunction, credential: CredentialRead): string {
  return (
    credential.bank_name ?? t(`banks.${credential.bank}.title`, { defaultValue: credential.bank })
  )
}

export const Route = createFileRoute('/settings/credentials/')({
  component: SettingsCredentialsIndexPage,
})

function SettingsCredentialsIndexPage() {
  const { data: user } = useAuthMe()
  if (!user) return null // root guard already redirected on 401
  return <SettingsCredentialsIndexView user={user} />
}

export interface SettingsCredentialsIndexViewProps {
  user: UserRead
}

export function SettingsCredentialsIndexView({ user }: SettingsCredentialsIndexViewProps) {
  const { t } = useTranslation()
  const credentials = [...user.credentials].sort((a, b) =>
    bankTitle(t, a).localeCompare(bankTitle(t, b)),
  )

  return (
    <main className="mx-auto flex min-h-full max-w-2xl flex-col gap-6 p-4">
      <header className="flex items-center gap-2">
        <BackLink />
        <h1 className="text-foreground flex-1 text-2xl font-semibold">{t('credentials.title')}</h1>
        <Button asChild size="sm">
          <Link to="/settings/credentials/new">
            <Plus className="size-3.5" aria-hidden="true" />
            {t('credentials.add')}
          </Link>
        </Button>
      </header>

      {credentials.length === 0 ? (
        <p className="text-muted-foreground text-sm">{t('credentials.empty')}</p>
      ) : (
        <ul className="border-border bg-card flex flex-col rounded-lg border">
          {credentials.map((credential) => (
            <CredentialRow key={credential.id} credential={credential} />
          ))}
        </ul>
      )}

      {credentials.length > 0 ? <ManageGroupsRow /> : null}
    </main>
  )
}

function ManageGroupsRow() {
  const { t } = useTranslation()
  return (
    <Link
      to="/settings/credentials/groups"
      className="border-border bg-card hover:bg-muted/60 flex items-center gap-3 rounded-lg border px-3 py-3 transition-colors"
    >
      <span
        className="bg-muted text-foreground flex size-8 shrink-0 items-center justify-center rounded-md"
        aria-hidden="true"
      >
        <LayoutGrid className="size-4" />
      </span>
      <span className="flex flex-1 flex-col">
        <span className="text-sm font-medium">{t('credentials.groups.manage')}</span>
        <span className="text-muted-foreground text-xs">
          {t('credentials.groups.manageDescription')}
        </span>
      </span>
      <ChevronRight className="text-muted-foreground size-4" aria-hidden="true" />
    </Link>
  )
}

function CredentialRow({ credential }: { credential: CredentialRead }) {
  const { t } = useTranslation()
  const title = bankTitle(t, credential)
  const lastSyncedLabel = credential.last_fetching_timestamp
    ? `${t('credentials.lastSynced')}: ${formatDateTime(credential.last_fetching_timestamp)}`
    : t('credentials.neverSynced')
  return (
    <li className="border-border/40 border-t first:border-t-0">
      <Link
        to="/settings/credentials/$credentialId"
        params={{ credentialId: String(credential.id) }}
        className="hover:bg-muted/60 flex items-center gap-3 rounded-md px-3 py-3 transition-colors"
      >
        <BankLogo
          icon={credential.bank_icon}
          name={title}
          seed={credential.bank_name ?? credential.bank}
        />
        <span className="flex flex-1 flex-col">
          <span className="text-sm font-medium">{title}</span>
          <span className="text-muted-foreground text-xs">{lastSyncedLabel}</span>
        </span>
        <ChevronRight className="text-muted-foreground size-4" aria-hidden="true" />
      </Link>
    </li>
  )
}

function BackLink() {
  const { t } = useTranslation()
  return (
    <Link
      to="/settings"
      aria-label={t('credentials.back')}
      className="text-primary hover:text-primary/80 -ml-1.5 rounded-md p-1.5 transition-colors"
    >
      <ChevronLeft className="size-5" />
    </Link>
  )
}
