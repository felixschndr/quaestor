import { useEffect, useMemo, useRef } from 'react'
import { Link, createFileRoute } from '@tanstack/react-router'
import { Trans, useTranslation } from 'react-i18next'
import { Collapsible } from 'radix-ui'
import { ChevronRight, Search, Settings } from 'lucide-react'

import { ContractIcon } from '@/components/contract-icon'
import { StatsIcon } from '@/components/stats-icon'
import { toast } from 'sonner'

import { useAuthMe, useGlobalSync, type UserRead } from '@/lib/auth'
import { Button } from '@/components/ui/button'
import { SyncButton } from '@/components/sync-button'
import { TwoFactorModal } from '@/components/two-factor-modal'
import { formatEuro, formatFactorMultiplier } from '@/lib/format'
import { accountDisplayName, displayNameOrUserName } from '@/lib/accounts'
import { BankLogo } from '@/components/BankLogo'
import { useAccountGroupLayout } from '@/lib/accountGroups'
import {
  buildDisplayGroups,
  sumFactoredBalance,
  type AccountWithBank,
  type DisplayGroup,
} from '@/lib/accountDisplayGroups'
import { useCollapsedGroups } from '@/lib/collapsedGroups'
import { cn } from '@/lib/utils'

export const Route = createFileRoute('/')({
  component: OverviewPage,
})

function OverviewPage() {
  const { data: user } = useAuthMe()
  const sync = useGlobalSync()
  const { t } = useTranslation()

  // Surface failed jobs as toasts once each, by tracking the set of credential
  // ids we've already toasted on. Cleared at the start of each new sync run so
  // a credential that fails twice across separate runs gets two notifications.
  const toastedRef = useRef<Set<number>>(new Set())
  useEffect(() => {
    if (sync.status === 'starting') {
      toastedRef.current.clear()
      return
    }
    for (const job of sync.jobs.values()) {
      if (job.status === 'failed' && !toastedRef.current.has(job.credential_id)) {
        toastedRef.current.add(job.credential_id)
        const bank = user?.credentials.find((c) => c.id === job.credential_id)?.bank ?? ''
        const bankTitle = t(`banks.${bank}.title`, { defaultValue: bank })
        toast.error(t('sync.failed', { bank: bankTitle }))
      }
    }
  }, [sync.jobs, sync.status, user, t])

  if (!user) return null // Root guard already redirected to /login on 401.

  const isBusy =
    sync.status === 'starting' || sync.status === 'running' || sync.status === 'awaiting_2fa'

  return (
    <>
      <OverviewView
        user={user}
        onSyncClick={sync.start}
        syncDisabled={isBusy}
        syncSpinning={isBusy}
        syncSucceededAt={sync.succeededAt}
      />
      <TwoFactorModal
        current2fa={sync.current2fa}
        onSubmit={async (code) => {
          try {
            await sync.submit2fa(code)
          } catch {
            const bank = sync.current2fa?.bank ?? ''
            const bankTitle = t(`banks.${bank}.title`, { defaultValue: bank })
            toast.error(t('sync.failed', { bank: bankTitle }))
          }
        }}
        onSkip={() => {
          const bank = sync.current2fa?.bank ?? ''
          if (bank) {
            const bankTitle = t(`banks.${bank}.title`, { defaultValue: bank })
            toast(t('sync.skipped', { bank: bankTitle }))
          }
          sync.skip2fa()
        }}
      />
    </>
  )
}

interface OverviewViewProps {
  user: UserRead
  onSyncClick: () => void
  syncDisabled: boolean
  syncSpinning: boolean
  /** Passed straight to the {@link SyncButton}; a fresh Date.now() value
   *  triggers the green-check zoom animation. Defaults to null for tests
   *  that don't care about the success path. */
  syncSucceededAt?: number | null
}

export function OverviewView({
  user,
  onSyncClick,
  syncDisabled,
  syncSpinning,
  syncSucceededAt = null,
}: OverviewViewProps) {
  const { t } = useTranslation()
  // When the user has defined custom groups, render by those. Otherwise fall
  // back to the original "by bank" layout (with no group headings).
  const customLayout = useAccountGroupLayout()
  const displayGroups = useMemo(
    () => buildDisplayGroups(user, customLayout.data),
    [user, customLayout.data],
  )
  const hasAccounts = displayGroups.some((group) => group.accounts.length > 0)
  const allAccountIds = user.credentials.flatMap((credential) =>
    credential.accounts.map((account) => account.id),
  )
  const searchAnchorId = allAccountIds[0]

  return (
    <main className="mx-auto flex min-h-full max-w-3xl flex-col gap-6 p-4">
      <header className="flex items-start justify-between px-2">
        <h1 className="text-foreground text-2xl font-semibold">
          <Trans
            i18nKey="overview.hello"
            values={{ name: displayNameOrUserName(user) }}
            components={{ name: <span className="text-primary" /> }}
          />
        </h1>
        <div className="-mr-1.5 flex items-center gap-1">
          <SyncButton
            onClick={onSyncClick}
            spinning={syncSpinning}
            disabled={syncDisabled}
            succeededAt={syncSucceededAt}
            ariaLabel={t('overview.syncAll.aria')}
          />
          <Link
            to="/stats"
            aria-label={t('overview.statistics')}
            className="text-primary hover:text-primary/80 group rounded-md p-1.5 transition-colors"
          >
            <StatsIcon className="size-5" />
          </Link>
          <Link
            to="/contracts"
            aria-label={t('overview.contracts')}
            className="text-primary hover:text-primary/80 group rounded-md p-1.5 transition-colors"
          >
            <ContractIcon className="size-5" />
          </Link>
          {searchAnchorId !== undefined ? (
            <Link
              to="/account/$accountId/search"
              params={{ accountId: String(searchAnchorId) }}
              search={{ account_ids: allAccountIds }}
              aria-label={t('overview.search')}
              className="text-primary hover:text-primary/80 group rounded-md p-1.5 transition-colors"
            >
              <Search className="search-icon-zoom size-5" />
            </Link>
          ) : null}
          <Link
            to="/settings"
            aria-label={t('overview.settings')}
            className="text-primary hover:text-primary/80 group rounded-md p-1.5 transition-colors"
          >
            <Settings className="size-5 transition-transform duration-300 ease-in-out group-hover:rotate-90" />
          </Link>
        </div>
      </header>

      <section className="flex flex-col items-center gap-1">
        <p className="text-primary text-5xl font-bold tracking-tight">{formatEuro(user.balance)}</p>
      </section>

      {hasAccounts ? <AccountGroupList groups={displayGroups} /> : <EmptyState />}
    </main>
  )
}

function AccountGroupList({ groups }: { groups: DisplayGroup[] }) {
  const { t } = useTranslation()
  const { isCollapsed, toggle } = useCollapsedGroups()
  return (
    <ul className="flex flex-col gap-6">
      {groups.map((group) => {
        const heading =
          group.heading === '__ungrouped__'
            ? t('credentials.groups.ungroupedHeading')
            : group.heading

        const accountRows = group.accounts.map((account) => (
          <AccountRow key={account.id} account={account} />
        ))

        // Legacy "by bank" layout has no heading and therefore no row to act as
        // a click target, so it stays permanently expanded.
        if (!heading) {
          return (
            <li key={group.key}>
              <ul className="flex flex-col">{accountRows}</ul>
            </li>
          )
        }

        const total = sumFactoredBalance(group.accounts)
        return (
          <li key={group.key}>
            <Collapsible.Root open={!isCollapsed(group.key)} onOpenChange={() => toggle(group.key)}>
              <Collapsible.Trigger className="group/collapsible focus-visible:ring-ring flex w-full cursor-pointer items-center gap-2 rounded-md px-2 text-left focus-visible:ring-2 focus-visible:outline-none">
                <ChevronRight
                  aria-hidden="true"
                  className="text-muted-foreground size-3.5 shrink-0 transition-transform duration-200 ease-in-out group-data-[state=open]/collapsible:rotate-90"
                />
                <h2 className="text-muted-foreground flex-1 text-xs font-semibold tracking-wide uppercase">
                  {heading}
                </h2>
                <span className="text-muted-foreground text-xs font-semibold tabular-nums">
                  {formatEuro(total)}
                </span>
              </Collapsible.Trigger>
              <Collapsible.Content className="collapsible-content overflow-hidden">
                <ul className="flex flex-col pt-2">{accountRows}</ul>
              </Collapsible.Content>
            </Collapsible.Root>
          </li>
        )
      })}
    </ul>
  )
}

function AccountRow({ account }: { account: AccountWithBank }) {
  const negative = account.balance < 0
  // Surface a non-100 balance_factor so the user can see why their group total
  // doesn't equal a naive sum of account balances. Rendered in the muted
  // heading color so the actual balance still pops.
  const hasFactor = account.balance_factor !== 100
  return (
    <li>
      <Link
        to="/account/$accountId"
        params={{ accountId: String(account.id) }}
        className="hover:bg-muted/60 flex items-center gap-3 rounded-md px-2 py-3 transition-colors"
      >
        <BankLogo
          icon={account.bankIcon}
          name={account.bankName ?? account.bank}
          seed={account.bankName ?? account.bank}
        />
        <span className="flex-1 truncate text-sm font-medium">{accountDisplayName(account)}</span>
        <span className="text-sm font-semibold tabular-nums">
          {hasFactor ? (
            <span className="text-muted-foreground mr-1.5 font-normal">
              {formatFactorMultiplier(account.balance_factor / 100)} x
            </span>
          ) : null}
          <span className={cn(negative && 'text-destructive')}>{formatEuro(account.balance)}</span>
        </span>
      </Link>
    </li>
  )
}

function EmptyState() {
  const { t } = useTranslation()
  return (
    <section className="border-border bg-card flex flex-col items-center gap-4 rounded-lg border border-dashed p-8 text-center">
      <p className="text-muted-foreground text-sm">{t('overview.emptyTitle')}</p>
      <Button asChild>
        <Link to="/settings/credentials/new">{t('overview.emptyCta')}</Link>
      </Button>
    </section>
  )
}
