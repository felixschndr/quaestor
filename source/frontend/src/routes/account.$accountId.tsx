import { useCallback, useEffect } from 'react'
import { Link, createFileRoute, useLocation } from '@tanstack/react-router'
import { useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { ChevronLeft } from 'lucide-react'
import { toast } from 'sonner'

import { authQueryKeys, useAuthMe, useCredentialSync, type AccountRead } from '@/lib/auth'
import { findAccountInUser, useAccountHistory, type AccountHistoryPage } from '@/lib/accountHistory'
import { PullToRefresh } from '@/components/pull-to-refresh'
import { TwoFactorModal } from '@/components/two-factor-modal'
import { AccountDetailView } from '@/pages/account.$accountId'

const MANUAL_BANK = 'manual'

export const Route = createFileRoute('/account/$accountId')({
  component: AccountDetailPage,
  validateSearch: (search: Record<string, unknown>): { focus?: number } => {
    const focus = Number(search.focus)
    return Number.isFinite(focus) && focus > 0 ? { focus } : {}
  },
})

function AccountDetailPage() {
  const { accountId: rawId } = Route.useParams()
  const accountId = Number(rawId)
  const { data: user } = useAuthMe()
  const accountInfo = findAccountInUser(user, accountId)

  const history = useAccountHistory(accountId)
  // Hook is unconditional (rules of hooks) — when no credential is in scope yet
  // we pass a sentinel id and skip rendering the button below.
  const sync = useCredentialSync(accountInfo?.credentialId ?? -1)
  const { t } = useTranslation()
  const queryClient = useQueryClient()

  const handleRefresh = useCallback(
    () =>
      Promise.all([
        queryClient.refetchQueries({ queryKey: authQueryKeys.me }),
        queryClient.refetchQueries({ queryKey: ['account', accountId] }),
      ]),
    [queryClient, accountId],
  )
  const { focus } = Route.useSearch()
  const focusNavKey = useLocation({ select: (location) => location.state.__TSR_key })

  // A sync that fails *after* a successful 2FA submit resolves the POST with 200, so the submit handler
  // below never sees it. `failedAt` is the only signal that the async job died
  const syncFailedAt = sync.failedAt
  const syncBank = accountInfo?.bank
  useEffect(() => {
    if (syncFailedAt === null || syncBank === undefined) return
    const bankTitle = t(`banks.${syncBank}.title`, { defaultValue: syncBank })
    toast.error(t('sync.failed', { bank: bankTitle }))
  }, [syncFailedAt, syncBank, t])

  if (!user) return null // Root guard already redirected on 401.

  if (!accountInfo) {
    return <AccountNotFoundView />
  }

  const isManual = accountInfo.bank === MANUAL_BANK
  const isSyncBusy =
    sync.status === 'starting' || sync.status === 'running' || sync.status === 'awaiting_2fa'

  return (
    <>
      <PullToRefresh onRefresh={handleRefresh}>
        <AccountDetailView
          account={accountInfo.account}
          bank={accountInfo.bank}
          lastUpdated={accountInfo.lastFetchingTimestamp}
          pages={history.data?.pages ?? []}
          isFetchingNextPage={history.isFetchingNextPage}
          hasNextPage={!!history.hasNextPage}
          onLoadMore={() => {
            if (history.hasNextPage && !history.isFetchingNextPage) {
              void history.fetchNextPage()
            }
          }}
          focusTransactionId={focus}
          focusNavKey={focusNavKey}
          // Manual accounts have no remote sync, so the button is suppressed
          // by leaving onSyncClick undefined.
          onSyncClick={isManual ? undefined : sync.start}
          syncDisabled={isSyncBusy}
          syncSpinning={isSyncBusy}
          syncSucceededAt={sync.succeededAt}
        />
      </PullToRefresh>
      <TwoFactorModal
        current2fa={sync.current2fa}
        onSubmit={async (code) => {
          try {
            await sync.submit2fa(code)
          } catch {
            const bankTitle = t(`banks.${accountInfo.bank}.title`, {
              defaultValue: accountInfo.bank,
            })
            toast.error(t('sync.failed', { bank: bankTitle }))
          }
        }}
        onSkip={() => {
          const bankTitle = t(`banks.${accountInfo.bank}.title`, {
            defaultValue: accountInfo.bank,
          })
          toast(t('sync.skipped', { bank: bankTitle }))
          sync.skip2fa()
        }}
      />
    </>
  )
}

function AccountNotFoundView() {
  const { t } = useTranslation()
  return (
    <main className="mx-auto max-w-page p-4">
      <BackLink />
      <p className="text-muted-foreground mt-6 text-sm">{t('account.notFound')}</p>
    </main>
  )
}

export interface AccountDetailViewProps {
  account: AccountRead
  bank?: string
  lastUpdated?: string | null
  pages: AccountHistoryPage[]
  isFetchingNextPage: boolean
  hasNextPage: boolean
  onLoadMore: () => void
  /** Overridable for tests so "Today" / "Yesterday" labels are deterministic. */
  today?: Date
  /** Wired by the page to {@link useCredentialSync}. Omitted = button hidden
   *  (e.g. manual accounts have no remote sync). */
  onSyncClick?: () => void
  syncDisabled?: boolean
  syncSpinning?: boolean
  /** Passed straight to the {@link SyncButton}; a fresh Date.now() value
   *  triggers the green-check zoom animation. */
  syncSucceededAt?: number | null
  /** When set: load history pages until this transaction is present, then
   *  smooth-scroll to it and briefly highlight it (deep-link from a counterpart). */
  focusTransactionId?: number
  /** Unique per navigation. The scroll/highlight one-shot guard is keyed on this
   *  so re-navigating to the same focus id (e.g. clicking the same linked
   *  transaction again) re-triggers it, while page loads within one visit don't. */
  focusNavKey?: string
}

function BackLink() {
  const { t } = useTranslation()
  return (
    <Link
      to="/"
      aria-label={t('account.back')}
      className="text-primary hover:text-primary/80 -ml-1.5 rounded-md p-1.5 transition-colors"
    >
      <ChevronLeft className="size-5" />
    </Link>
  )
}
