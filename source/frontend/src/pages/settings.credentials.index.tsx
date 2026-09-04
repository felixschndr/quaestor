import { Link } from '@tanstack/react-router'
import { useTranslation } from 'react-i18next'
import { ChevronRight, LayoutGrid, Plus } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { BankLogo } from '@/components/BankLogo'
import type { CredentialRead } from '@/lib/auth'
import { bankTitle, hasSyncError, lastSyncedLabel } from '@/lib/credentials'
import { isSharedCredential } from '@/lib/accountShares'
import type { SettingsCredentialsIndexViewProps } from '@/routes/settings.credentials.index'
import { BackLink } from '@/components/back-link'
import { WarningDot } from '@/components/warning-dot'

export function SettingsCredentialsIndexView({ user }: SettingsCredentialsIndexViewProps) {
  const { t } = useTranslation()
  const credentials = [...user.credentials].sort((a, b) =>
    bankTitle(t, a.bank, a.bank_name).localeCompare(bankTitle(t, b.bank, b.bank_name)),
  )

  return (
    <main className="mx-auto flex min-h-full max-w-page flex-col gap-6 p-4">
      <header className="flex items-center gap-2">
        <BackLink to="/settings" />
        <h1 className="text-foreground flex-1 text-lg font-semibold">{t('credentials.title')}</h1>
        <Button asChild variant="primary" size="sm">
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
  const title = bankTitle(t, credential.bank, credential.bank_name)
  const syncedLabel = lastSyncedLabel(t, credential)
  const sharedLabel = isSharedCredential(credential)
    ? t('accountShares.sharedBy', { owner: credential.shared_from })
    : null
  return (
    <li className="border-border/40 border-t first:border-t-0">
      <Link
        to="/settings/credentials/$credentialId"
        params={{ credentialId: String(credential.id) }}
        className="hover:bg-muted/60 flex items-center gap-3 rounded-md px-3 py-3 transition-colors"
      >
        <span className="relative size-8 shrink-0">
          <BankLogo
            icon={credential.bank_icon}
            name={title}
            seed={credential.bank_name ?? credential.bank}
            className="size-full"
          />
          {hasSyncError(credential) ? (
            <WarningDot className="bg-destructive -top-1 -right-1" />
          ) : null}
        </span>
        <span className="flex flex-1 flex-col">
          <span className="text-sm font-medium">{title}</span>
          {hasSyncError(credential) ? (
            <span className="text-destructive text-xs font-medium">
              {t('credentials.syncError.rowHint')}
            </span>
          ) : syncedLabel ? (
            <span className="text-muted-foreground text-xs">{syncedLabel}</span>
          ) : null}
          {sharedLabel ? (
            <span className="text-muted-foreground text-xs">{sharedLabel}</span>
          ) : null}
        </span>
        <ChevronRight className="text-muted-foreground size-4" aria-hidden="true" />
      </Link>
    </li>
  )
}
