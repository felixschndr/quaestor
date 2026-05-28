import { useEffect, useMemo, useRef } from 'react'
import { Link, createFileRoute } from '@tanstack/react-router'
import { Trans, useTranslation } from 'react-i18next'
import { RefreshCw, Settings } from 'lucide-react'
import { toast } from 'sonner'

import { useAuthMe, useGlobalSync, type AccountRead, type UserRead } from '@/lib/auth'
import { Button } from '@/components/ui/button'
import { TwoFactorModal } from '@/components/two-factor-modal'
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
}

export function OverviewView({ user, onSyncClick, syncDisabled, syncSpinning }: OverviewViewProps) {
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
      <header className="flex items-start justify-between px-2">
        <h1 className="text-foreground text-2xl font-semibold">
          <Trans
            i18nKey="overview.hello"
            values={{ name: displayNameOrUserName(user) }}
            components={{ name: <span className="text-primary" /> }}
          />
        </h1>
        <div className="-mr-1.5 flex items-center gap-1">
          <button
            type="button"
            onClick={onSyncClick}
            disabled={syncDisabled}
            aria-label={t('overview.syncAll.aria')}
            className="text-primary hover:text-primary/80 rounded-md p-1.5 transition-colors disabled:opacity-50"
          >
            <RefreshCw
              className={cn('size-5 transition-transform', syncSpinning && 'animate-spin')}
              aria-hidden="true"
            />
          </button>
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
      accounts: group.accounts
        .filter((account) => !account.is_hidden)
        .map((account) => ({ ...account, bank: group.bank })),
    }))
  }
  const lookup = buildAccountLookup(user)
  // Hidden accounts also disappear from custom-grouped layouts. We resolve
  // them by id (so the layout's stored ordering is honored), then drop the
  // hidden ones; the group still renders even if every account in it is
  // hidden, just with an empty list.
  const resolveAccounts = (refs: AccountGroupAccountRef[]) =>
    refs
      .map((ref) => lookup.get(ref.id))
      .filter((account): account is AccountWithBank => !!account && !account.is_hidden)

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
        <Link to="/settings/credentials/new">{t('overview.emptyCta')}</Link>
      </Button>
    </section>
  )
}
