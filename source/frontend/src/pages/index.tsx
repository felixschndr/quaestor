import { useEffect, useMemo, useRef, useState } from 'react'
import { Link } from '@tanstack/react-router'
import { Trans, useTranslation } from 'react-i18next'
import { Collapsible } from 'radix-ui'
import { ChevronRight, Landmark, Search, Settings } from 'lucide-react'

import { ContractIcon } from '@/components/contract-icon'
import { StatsIcon } from '@/components/stats-icon'

import { type CredentialRead, type UserRead } from '@/lib/auth'
import { Button } from '@/components/ui/button'
import { SyncButton } from '@/components/sync-button'
import { Sparkline } from '@/components/sparkline'
import { UpcomingContracts } from '@/components/upcoming-contracts'
import { WarningDot } from '@/components/warning-dot'
import { PrivacyToggle } from '@/components/privacy-toggle'
import { SyncStatusIcon, type SyncState } from '@/components/sync-check'
import { presetDateRange, useNetWorthStats } from '@/lib/statistics'
import {
  formatMoney,
  formatFactorMultiplier,
  formatPercent,
  formatRelativeDateTime,
  formatSignedMoney,
  parseTimestamp,
} from '@/lib/format'
import { accountDisplayName, displayNameOrUserName } from '@/lib/accounts'
import { AccountLabel } from '@/components/AccountLabel'
import { useAccountGroupLayout } from '@/lib/accountGroups'
import {
  buildDisplayGroups,
  sumFactoredBalance,
  type AccountWithBank,
  type DisplayGroup,
} from '@/lib/accountDisplayGroups'
import { useCollapsedGroups } from '@/lib/collapsedGroups'
import { useContracts } from '@/lib/contract'
import type { SyncJob } from '@/lib/credentials'
import { cn } from '@/lib/utils'

interface OverviewViewProps {
  user: UserRead
  onSyncClick: () => void
  syncDisabled: boolean
  syncSpinning: boolean
  syncSucceededAt?: number | null
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
  const customLayout = useAccountGroupLayout()
  const displayGroups = useMemo(
    () => buildDisplayGroups(user, customLayout.data),
    [user, customLayout.data],
  )
  const hasAccounts = displayGroups.some((group) => group.accounts.length > 0)
  const visibleAccountIds = useMemo(
    () =>
      user.credentials.flatMap((credential) =>
        credential.accounts.filter((account) => !account.is_hidden).map((account) => account.id),
      ),
    [user],
  )
  const accountSyncStates = useMemo(() => {
    const states = new Map<number, SyncState>()
    if (!syncJobs) return states
    for (const credential of user.credentials) {
      const job = syncJobs.get(credential.id)
      if (!job) continue
      const state: SyncState =
        job.status === 'completed'
          ? 'completed'
          : job.status === 'failed'
            ? job.error_code === 'cancelled'
              ? undefined
              : 'failed'
            : 'running'
      for (const account of credential.accounts) states.set(account.id, state)
    }
    return states
  }, [user, syncJobs])
  const syncProgress = useMemo(() => {
    if (!syncJobs || syncJobs.size === 0) return null
    const jobs = [...syncJobs.values()]
    const done = jobs.filter((job) => job.status === 'completed' || job.status === 'failed').length
    return done < jobs.length ? { done, total: jobs.length } : null
  }, [syncJobs])
  const { data: contracts } = useContracts()
  const overdueCount = (contracts ?? []).filter(
    (contract) => contract.is_overdue && visibleAccountIds.includes(contract.account_id),
  ).length
  const staleSince = staleSyncTimestamp(user.credentials)
  const [settleKey, setSettleKey] = useState<number | null>(null)
  const lastBalance = useRef(user.balance)
  useEffect(() => {
    if (lastBalance.current === user.balance) return
    lastBalance.current = user.balance
    setSettleKey(Date.now())
  }, [user.balance])

  return (
    <main className="mx-auto flex min-h-full max-w-page flex-col gap-6 p-4">
      <header className="flex items-center justify-between px-2">
        <h1 className="text-foreground text-2xl font-semibold">
          <Trans
            i18nKey="overview.hello"
            values={{ name: displayNameOrUserName(user) }}
            components={{ name: <span className="text-primary" /> }}
          />
        </h1>
        <div className="-mr-2.5 flex items-center gap-1">
          <Link
            to="/settings"
            aria-label={t('settings.title')}
            title={t('settings.title')}
            className="text-primary hover:text-primary/80 focus-visible:ring-ring group rounded-md p-2.5 transition-colors focus-visible:ring-2 focus-visible:outline-none"
          >
            <Settings className="size-5 transition-transform duration-300 ease-in-out group-hover:rotate-90" />
          </Link>
          {hasAccounts ? <PrivacyToggle className="p-2.5" /> : null}
          {hasAccounts ? (
            <SyncButton
              onClick={onSyncClick}
              spinning={syncSpinning}
              disabled={syncDisabled}
              succeededAt={syncSucceededAt}
              ariaLabel={t('overview.syncAll.aria')}
              className="p-2.5"
              warn={staleSince !== null}
            />
          ) : null}
          {hasAccounts ? (
            <>
              <Link
                to="/stats"
                aria-label={t('stats.title')}
                title={t('stats.title')}
                className="text-primary hover:text-primary/80 focus-visible:ring-ring group rounded-md p-2.5 transition-colors focus-visible:ring-2 focus-visible:outline-none max-sm:hidden"
              >
                <StatsIcon className="size-5" />
              </Link>
              <Link
                to="/contracts"
                aria-label={
                  overdueCount > 0
                    ? t('overview.contractsOverdue', { count: overdueCount })
                    : t('contracts.title')
                }
                title={t('contracts.title')}
                className="text-primary hover:text-primary/80 focus-visible:ring-ring group relative rounded-md p-2.5 transition-colors focus-visible:ring-2 focus-visible:outline-none max-sm:hidden"
              >
                <ContractIcon className="size-5" />
                {overdueCount > 0 ? <WarningDot /> : null}
              </Link>
            </>
          ) : null}
          {hasAccounts ? (
            <Link
              to="/search"
              aria-label={t('overview.search')}
              title={t('overview.search')}
              className="text-primary hover:text-primary/80 focus-visible:ring-ring group rounded-md p-2.5 transition-colors focus-visible:ring-2 focus-visible:outline-none max-sm:hidden"
            >
              <Search className="search-icon-zoom size-5" />
            </Link>
          ) : null}
        </div>
      </header>

      {hasAccounts ? (
        <section className="mx-auto flex w-fit max-w-full flex-col items-center gap-1">
          <p
            key={settleKey}
            className={cn(
              'private-amount text-primary px-5 text-5xl font-bold tracking-tight tabular-nums',
              settleKey !== null && 'balance-settle',
            )}
          >
            {formatMoney(user.balance)}
          </p>
          {syncProgress ? (
            <p className="text-muted-foreground text-xs" aria-live="polite">
              {t('overview.syncProgress', syncProgress)}
            </p>
          ) : null}
          {staleSince ? <LastSyncedLine timestamp={staleSince} /> : null}
          <NetWorthTrend accountIds={visibleAccountIds} />
        </section>
      ) : null}

      {hasAccounts ? (
        <>
          {user.show_upcoming_contracts ? (
            <UpcomingContracts accountIds={visibleAccountIds} />
          ) : null}
          <AccountGroupList groups={displayGroups} syncStates={accountSyncStates} />
        </>
      ) : (
        <EmptyState />
      )}
    </main>
  )
}

const STALE_AFTER_MS = 5 * 24 * 60 * 60 * 1000

function staleSyncTimestamp(credentials: CredentialRead[]): string | null {
  const timestamps = credentials
    .filter((credential) => credential.sync_enabled)
    .map((credential) => credential.last_fetching_timestamp)
    .filter((timestamp): timestamp is string => timestamp !== null)
  if (timestamps.length === 0) return null
  const oldest = timestamps.reduce((a, b) => (parseTimestamp(a) <= parseTimestamp(b) ? a : b))
  return Date.now() - parseTimestamp(oldest).getTime() > STALE_AFTER_MS ? oldest : null
}

function LastSyncedLine({ timestamp }: { timestamp: string }) {
  const { t } = useTranslation()
  return (
    <p className="text-warning text-xs">
      {t('credentials.lastSynced')}: {formatRelativeDateTime(timestamp, t)}
    </p>
  )
}

function NetWorthTrend({ accountIds }: { accountIds: number[] }) {
  const { t } = useTranslation()
  const range = useMemo(() => presetDateRange('1m'), [])
  const { data, isPending } = useNetWorthStats(accountIds, range, accountIds.length > 0)
  if (accountIds.length === 0) return null
  if (isPending) return <div className="h-14" aria-hidden="true" />
  const series = data?.series ?? []
  if (series.length < 2) return null

  const first = series[0].value
  const delta = series[series.length - 1].value - first
  const ratio = first === 0 ? null : delta / Math.abs(first)
  const tone = delta > 0 ? 'text-success' : delta < 0 ? 'text-destructive' : 'text-muted-foreground'
  return (
    <Link
      to="/stats"
      className="focus-visible:ring-ring flex w-full min-w-[min(20rem,calc(100dvw-2rem))] flex-col items-center gap-0.5 rounded-md focus-visible:ring-2 focus-visible:outline-none"
    >
      <Sparkline
        values={series.map((point) => point.value)}
        className={cn('private-chart h-9 w-full', tone)}
      />
      <span className={cn('private-amount text-xs font-medium tabular-nums', tone)}>
        {formatSignedMoney(delta)}
        {ratio === null ? '' : ` (${formatPercent(ratio)})`} {t('overview.trendRange')}
      </span>
    </Link>
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
              <h2>
                <Collapsible.Trigger className="group/collapsible focus-visible:ring-ring flex w-full cursor-pointer items-center gap-2 rounded-md px-2 py-2 text-left focus-visible:ring-2 focus-visible:outline-none">
                  <ChevronRight
                    aria-hidden="true"
                    className="text-muted-foreground size-3.5 shrink-0 transition-transform duration-200 ease-in-out group-data-[state=open]/collapsible:rotate-90"
                  />
                  <span className="text-muted-foreground flex-1 text-xs font-semibold tracking-wide uppercase">
                    {heading}
                  </span>
                  <SyncStatusIcon state={groupSyncState(group, syncStates)} />
                  <span
                    className={cn(
                      'private-amount text-xs font-semibold tabular-nums',
                      total < 0 ? 'text-destructive' : 'text-muted-foreground',
                    )}
                  >
                    {formatMoney(total)}
                  </span>
                </Collapsible.Trigger>
              </h2>
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

function groupSyncState(group: DisplayGroup, syncStates: Map<number, SyncState>): SyncState {
  const states = group.accounts.map((account) => syncStates.get(account.id))
  if (states.includes('running')) return 'running'
  if (states.includes('failed')) return 'failed'
  return states.includes('completed') ? 'completed' : undefined
}

function AccountRow({ account, syncState }: { account: AccountWithBank; syncState: SyncState }) {
  const negative = account.balance < 0
  const hasFactor = account.balance_factor !== 100
  return (
    <li>
      <Link
        to="/account/$accountId"
        params={{ accountId: String(account.id) }}
        className="hover:bg-muted/60 focus-visible:ring-ring flex items-center gap-3 rounded-md px-2 py-3 transition-colors focus-visible:ring-2 focus-visible:outline-none"
      >
        <AccountLabel
          icon={account.bankIcon}
          bankName={account.bankName ?? account.bank}
          accountName={accountDisplayName(account)}
          iconClassName="size-8"
          nameClassName="truncate text-sm font-medium"
          trailing={<SyncStatusIcon state={syncState} />}
          className="flex-1"
        />
        <span className="private-amount text-sm font-semibold tabular-nums">
          {hasFactor ? (
            <span className="text-muted-foreground mr-1.5 font-normal">
              {formatFactorMultiplier(account.balance_factor / 100)} x
            </span>
          ) : null}
          <span className={cn(negative && 'text-destructive')}>{formatMoney(account.balance)}</span>
        </span>
      </Link>
    </li>
  )
}

function EmptyState() {
  const { t } = useTranslation()
  return (
    <section className="border-border bg-card flex flex-col items-center gap-3 rounded-lg border border-dashed p-8 text-center">
      <Landmark className="text-primary size-8" aria-hidden="true" />
      <div className="flex flex-col gap-1">
        <p className="text-foreground text-base font-semibold">{t('overview.emptyTitle')}</p>
        <p className="text-muted-foreground max-w-sm text-sm">{t('overview.emptyLead')}</p>
      </div>
      <Button asChild className="mt-1">
        <Link to="/settings/credentials/new">{t('overview.emptyCta')}</Link>
      </Button>
    </section>
  )
}
