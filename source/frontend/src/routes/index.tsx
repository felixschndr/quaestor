import { useMemo } from 'react'
import { Link, createFileRoute } from '@tanstack/react-router'
import { Trans, useTranslation } from 'react-i18next'
import { Settings } from 'lucide-react'

import { useAuthMe, useGlobalSync, type AccountRead, type UserRead } from '@/lib/auth'
import { Button } from '@/components/ui/button'
import { formatDecimal, formatEuro } from '@/lib/format'
import {
  accountDisplayName,
  bankIconUrl,
  displayNameOrUserName,
  groupAccountsByBank,
} from '@/lib/accounts'
import {
  useAccountGroupLayout,
  type AccountGroupAccountRef,
  type AccountGroupLayout,
} from '@/lib/accountGroups'
import { usePullToRefresh } from '@/hooks/usePullToRefresh'
import { cn } from '@/lib/utils'

export const Route = createFileRoute('/')({
  component: OverviewPage,
})

function OverviewPage() {
  const { data: user, refetch } = useAuthMe()
  const sync = useGlobalSync()
  const { pullDistance, isRefreshing } = usePullToRefresh({
    onRefresh: async () => {
      await sync.mutateAsync()
      await refetch()
    },
    enabled: !!user,
  })

  if (!user) return null // Root guard already redirected to /login on 401.

  // While the user is dragging, animate the progress bar's opacity with the
  // pull; once the sync starts (or react-query refetches), keep it visible.
  const showProgressBar = sync.isPending || isRefreshing || pullDistance > 0

  return (
    <OverviewView
      user={user}
      showProgressBar={showProgressBar}
      progressVisualHint={sync.isPending || isRefreshing ? 1 : Math.min(1, pullDistance / 80)}
    />
  )
}

interface OverviewViewProps {
  user: UserRead
  showProgressBar: boolean
  progressVisualHint: number
}

export function OverviewView({ user, showProgressBar, progressVisualHint }: OverviewViewProps) {
  const { t } = useTranslation()
  // When the user has defined custom groups, render by those. Otherwise fall
  // back to the original "by bank" layout (with no group headings).
  const customLayout = useAccountGroupLayout()
  const displayGroups = useMemo(
    () => buildDisplayGroups(user, customLayout.data),
    [user, customLayout.data],
  )
  const hasAccounts = displayGroups.some((group) => group.accounts.length > 0)

  return (
    <main className="mx-auto flex min-h-full max-w-2xl flex-col gap-6 p-4">
      <TopProgressBar visible={showProgressBar} hint={progressVisualHint} />

      <header className="flex items-start justify-between px-2">
        <h1 className="text-foreground text-2xl font-semibold">
          <Trans
            i18nKey="overview.hello"
            values={{ name: displayNameOrUserName(user) }}
            components={{ name: <span className="text-primary" /> }}
          />
        </h1>
        <Link
          to="/settings"
          aria-label={t('overview.settings')}
          className="text-primary hover:text-primary/80 group -mr-1.5 rounded-md p-1.5 transition-colors"
        >
          <Settings className="size-5 group-hover:animate-[spin-once_0.4s_ease-in-out]" />
        </Link>
      </header>

      <section className="flex flex-col items-center gap-1">
        <p className="text-primary text-5xl font-bold tracking-tight">{formatEuro(user.balance)}</p>
      </section>

      {hasAccounts ? <AccountGroupList groups={displayGroups} /> : <EmptyState />}
    </main>
  )
}

interface DisplayGroup {
  /** React key per row. */
  key: string
  /** Visible heading. Null = no heading (legacy "by bank" layout). */
  heading: string | null
  accounts: AccountWithBank[]
}

interface AccountWithBank extends AccountRead {
  bank: string
}

function buildDisplayGroups(
  user: UserRead,
  layout: AccountGroupLayout | undefined,
): DisplayGroup[] {
  const usesCustomLayout = !!layout && layout.groups.length > 0
  if (!usesCustomLayout) {
    // Original behaviour: group by bank, no headings; each account keeps its own bank icon.
    return groupAccountsByBank(user.credentials).map((group) => ({
      key: `bank-${group.bank}`,
      heading: null,
      accounts: group.accounts.map((account) => ({ ...account, bank: group.bank })),
    }))
  }
  const lookup = buildAccountLookup(user)
  const resolveAccounts = (refs: AccountGroupAccountRef[]) =>
    refs.map((ref) => lookup.get(ref.id)).filter((account): account is AccountWithBank => !!account)

  const groups: DisplayGroup[] = layout!.groups.map((group) => ({
    key: `group-${group.id}`,
    heading: group.name,
    accounts: resolveAccounts(group.accounts),
  }))
  const ungroupedAccounts = resolveAccounts(layout!.ungrouped)
  if (ungroupedAccounts.length > 0) {
    groups.push({
      key: 'ungrouped',
      // i18n key resolved in OverviewView's render path via t() — pass the
      // already-resolved string here to keep DisplayGroup pure-data.
      heading: '__ungrouped__',
      accounts: ungroupedAccounts,
    })
  }
  return groups
}

function buildAccountLookup(user: UserRead): Map<number, AccountWithBank> {
  const map = new Map<number, AccountWithBank>()
  for (const credential of user.credentials) {
    for (const account of credential.accounts) {
      map.set(account.id, { ...account, bank: credential.bank })
    }
  }
  return map
}

function TopProgressBar({ visible, hint }: { visible: boolean; hint: number }) {
  // Slim cyan bar. When the user is mid-pull, fade in proportional to pull;
  // when the actual sync is running, animate indeterminately.
  return (
    <div
      role="progressbar"
      aria-hidden={!visible}
      className={cn(
        'pointer-events-none fixed inset-x-0 top-0 z-10 h-0.5 overflow-hidden transition-opacity',
        visible ? 'opacity-100' : 'opacity-0',
      )}
      style={{ opacity: visible ? Math.max(0.3, hint) : 0 }}
    >
      <div className="bg-primary h-full w-1/3 animate-[progress_1.2s_ease-in-out_infinite]" />
    </div>
  )
}

function AccountGroupList({ groups }: { groups: DisplayGroup[] }) {
  const { t } = useTranslation()
  return (
    <ul className="flex flex-col gap-6">
      {groups.map((group) => {
        const heading =
          group.heading === '__ungrouped__'
            ? t('credentials.groups.ungroupedHeading')
            : group.heading
        const total = sumFactoredBalance(group.accounts)
        return (
          <li key={group.key} className="flex flex-col gap-2">
            {heading ? (
              <div className="flex items-baseline justify-between gap-2 px-2">
                <h2 className="text-muted-foreground text-xs font-semibold uppercase tracking-wide">
                  {heading}
                </h2>
                <span className="text-muted-foreground text-xs font-semibold tabular-nums">
                  {formatEuro(total)}
                </span>
              </div>
            ) : null}
            <ul className="flex flex-col">
              {group.accounts.map((account) => (
                <AccountRow key={account.id} bank={account.bank} account={account} />
              ))}
            </ul>
          </li>
        )
      })}
    </ul>
  )
}

export function sumFactoredBalance(
  accounts: { balance: number; balance_factor: number }[],
): number {
  return accounts.reduce(
    (sum, account) => sum + (account.balance * account.balance_factor) / 100,
    0,
  )
}

function AccountRow({ bank, account }: { bank: string; account: AccountRead }) {
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
        <BankIcon bank={bank} />
        <span className="flex-1 truncate text-sm font-medium">{accountDisplayName(account)}</span>
        <span className="text-sm font-semibold tabular-nums">
          {hasFactor ? (
            <span className="text-muted-foreground mr-1.5 font-normal">
              {formatDecimal(account.balance_factor / 100)} x
            </span>
          ) : null}
          <span className={cn(negative && 'text-destructive')}>{formatEuro(account.balance)}</span>
        </span>
      </Link>
    </li>
  )
}

function BankIcon({ bank }: { bank: string }) {
  return (
    <img
      src={bankIconUrl(bank)}
      alt=""
      // The bank name is communicated to assistive tech via the account name
      // and grouping, so the icon is purely decorative.
      aria-hidden="true"
      className="size-8 rounded-md object-cover"
      onError={(event) => {
        // Hide the broken-image glyph if the bank ever ships without an icon.
        event.currentTarget.style.visibility = 'hidden'
      }}
    />
  )
}

function EmptyState() {
  const { t } = useTranslation()
  return (
    <section className="border-border bg-card flex flex-col items-center gap-4 rounded-lg border border-dashed p-8 text-center">
      <p className="text-muted-foreground text-sm">{t('overview.emptyTitle')}</p>
      <Button asChild>
        <Link to="/settings/credentials">{t('overview.emptyCta')}</Link>
      </Button>
    </section>
  )
}
