import { useMemo } from 'react'
import { Link, createFileRoute } from '@tanstack/react-router'
import { Trans, useTranslation } from 'react-i18next'
import { Settings } from 'lucide-react'

import { useAuthMe, useGlobalSync, type AccountRead, type UserRead } from '@/lib/auth'
import { Button } from '@/components/ui/button'
import { formatEuro } from '@/lib/format'
import { bankIconUrl, displayNameOrUserName, groupAccountsByBank } from '@/lib/accounts'
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
  const groups = useMemo(() => groupAccountsByBank(user.credentials), [user.credentials])
  const hasAccounts = groups.some((group) => group.accounts.length > 0)

  return (
    <main className="mx-auto flex min-h-full max-w-2xl flex-col gap-6 p-4">
      <TopProgressBar visible={showProgressBar} hint={progressVisualHint} />

      <header className="flex items-start justify-between">
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
          className="text-primary hover:text-primary/80 group rounded-md p-1.5 transition-colors"
        >
          <Settings className="size-5 group-hover:animate-[spin-once_0.4s_ease-in-out]" />
        </Link>
      </header>

      <section aria-labelledby="total-balance-label" className="flex flex-col gap-1">
        <p id="total-balance-label" className="text-muted-foreground text-sm">
          {t('overview.totalBalance')}
        </p>
        <p className="text-primary text-4xl font-bold tracking-tight">{formatEuro(user.balance)}</p>
      </section>

      {hasAccounts ? <AccountGroupList groups={groups} /> : <EmptyState />}
    </main>
  )
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

function AccountGroupList({ groups }: { groups: ReturnType<typeof groupAccountsByBank> }) {
  return (
    <ul className="flex flex-col gap-6">
      {groups.map((group) => (
        <li key={group.bank} className="flex flex-col gap-2">
          <ul className="flex flex-col">
            {group.accounts.map((account) => (
              <AccountRow key={account.id} bank={group.bank} account={account} />
            ))}
          </ul>
        </li>
      ))}
    </ul>
  )
}

function AccountRow({ bank, account }: { bank: string; account: AccountRead }) {
  const negative = account.balance < 0
  return (
    <li>
      <Link
        to="/account/$accountId"
        params={{ accountId: String(account.id) }}
        className="hover:bg-muted/60 flex items-center gap-3 rounded-md px-2 py-3 transition-colors"
      >
        <BankIcon bank={bank} />
        <span className="flex-1 truncate text-sm font-medium">{account.name}</span>
        <span className={cn('text-sm font-semibold tabular-nums', negative && 'text-destructive')}>
          {formatEuro(account.balance)}
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
