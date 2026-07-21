import { useMemo } from 'react'
import { Link } from '@tanstack/react-router'
import { Trans, useTranslation } from 'react-i18next'
import { Collapsible } from 'radix-ui'
import { ChevronRight, Search, Settings } from 'lucide-react'

import { ContractIcon } from '@/components/contract-icon'
import { StatsIcon } from '@/components/stats-icon'

import { type UserRead } from '@/lib/auth'
import { Button } from '@/components/ui/button'
import { SyncButton } from '@/components/sync-button'
import { SyncStatusIcon, type SyncState } from '@/components/sync-check'
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
import type { SyncJob } from '@/lib/credentials'
import { cn } from '@/lib/utils'

interface OverviewViewProps {
  user: UserRead
  onSyncClick: () => void
  syncDisabled: boolean
  syncSpinning: boolean
  /** Passed straight to the {@link SyncButton}; a fresh Date.now() value
   *  triggers the green-check zoom animation. Defaults to null for tests
   *  that don't care about the success path. */
  syncSucceededAt?: number | null
  /** Live sync jobs keyed by credential id, so each account row can show
   *  whether its own bank is still syncing. */
  syncJobs?: Map<number, SyncJob>
}

export function OverviewView({
  user,
  onSyncClick,
  syncDisabled,
  syncSpinning,
  syncSucceededAt = null,
  syncJobs,
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
  // A job belongs to a credential; every account behind that credential shares
  // its state, so the map is flattened down to account ids once here.
  const accountSyncStates = useMemo(() => {
    const states = new Map<number, SyncState>()
    if (!syncJobs) return states
    for (const credential of user.credentials) {
      const job = syncJobs.get(credential.id)
      if (!job) continue
      const state: SyncState =
        job.status === 'completed' ? 'completed' : job.status === 'failed' ? undefined : 'running'
      for (const account of credential.accounts) states.set(account.id, state)
    }
    return states
  }, [user, syncJobs])
  const allAccountIds = user.credentials.flatMap((credential) =>
    credential.accounts.map((account) => account.id),
  )
  const searchAnchorId = allAccountIds[0]

  return (
    <main className="mx-auto flex min-h-full max-w-page flex-col gap-6 p-4">
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
            aria-label={t('stats.title')}
            className="text-primary hover:text-primary/80 group rounded-md p-1.5 transition-colors"
          >
            <StatsIcon className="size-5" />
          </Link>
          <Link
            to="/contracts"
            aria-label={t('contracts.title')}
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
            aria-label={t('settings.title')}
            className="text-primary hover:text-primary/80 group rounded-md p-1.5 transition-colors"
          >
            <Settings className="size-5 transition-transform duration-300 ease-in-out group-hover:rotate-90" />
          </Link>
        </div>
      </header>

      <section className="flex flex-col items-center gap-1">
        <p className="text-primary text-5xl font-bold tracking-tight">{formatEuro(user.balance)}</p>
      </section>

      {hasAccounts ? (
        <AccountGroupList groups={displayGroups} syncStates={accountSyncStates} />
      ) : (
        <EmptyState />
      )}
    </main>
  )
}

function AccountGroupList({
  groups,
  syncStates,
}: {
  groups: DisplayGroup[]
  syncStates: Map<number, SyncState>
}) {
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
          <AccountRow key={account.id} account={account} syncState={syncStates.get(account.id)} />
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

function AccountRow({ account, syncState }: { account: AccountWithBank; syncState: SyncState }) {
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
        <span className="flex min-w-0 flex-1 items-center gap-2">
          <span className="truncate text-sm font-medium">{accountDisplayName(account)}</span>
          <SyncStatusIcon state={syncState} />
        </span>
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
