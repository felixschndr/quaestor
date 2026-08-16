import { useEffect } from 'react'
import { createFileRoute, useLocation } from '@tanstack/react-router'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'

import { useAuthMe, useCredentialSync, type AccountRead } from '@/lib/auth'
import { isManualBank } from '@/lib/credentials'
import { findAccountInUser, useAccountHistory, type AccountHistoryPage } from '@/lib/accountHistory'
import { TwoFactorModal } from '@/components/two-factor-modal'
import { AccountDetailView } from '@/pages/account.$accountId'
import { BackLink } from '@/components/back-link'

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
  const sync = useCredentialSync(accountInfo?.credentialId ?? -1)
  const { t } = useTranslation()
  const { focus } = Route.useSearch()
  const focusNavKey = useLocation({ select: (location) => location.state.__TSR_key })

  // A sync that fails *after* a successful 2FA submit resolves the POST with 200, so the submit handler
  // below never sees it. `failedAt` is the only signal that the async job died
  const syncFailedAt = sync.failedAt
  const syncBank = accountInfo?.bank
  const syncJobs = sync.jobs
  useEffect(() => {
    if (syncFailedAt === null || syncBank === undefined) return
    const bankTitle = t(`banks.${syncBank}.title`, { defaultValue: syncBank })
    const rateLimited = Array.from(syncJobs.values()).some((j) => j.error_code === 'rate_limited')
    toast.error(t(rateLimited ? 'sync.rateLimited' : 'sync.failed', { bank: bankTitle }))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [syncFailedAt, syncBank, t])

  if (!user) return null // Root guard already redirected on 401.

  if (!accountInfo) {
    return <AccountNotFoundView />
  }

  const isManual = isManualBank(accountInfo.bank)
  const isSyncBusy =
    sync.status === 'starting' || sync.status === 'running' || sync.status === 'awaiting_2fa'

  return (
    <>
      <AccountDetailView
        account={accountInfo.account}
        bank={accountInfo.bank}
        lastUpdated={accountInfo.lastFetchingTimestamp}
        pages={history.data?.pages ?? []}
        isLoading={history.isLoading}
        isFetchingNextPage={history.isFetchingNextPage}
        hasNextPage={!!history.hasNextPage}
        onLoadMore={() => {
          if (history.hasNextPage && !history.isFetchingNextPage) {
            void history.fetchNextPage()
          }
        }}
        focusTransactionId={focus}
        focusNavKey={focusNavKey}
        onSyncClick={isManual ? undefined : sync.start}
        syncDisabled={isSyncBusy}
        syncSpinning={isSyncBusy}
        syncSucceededAt={sync.succeededAt}
      />
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
      <BackLink to="/" label={t('common.back')} />
      <p className="text-muted-foreground mt-6 text-sm">{t('account.notFound')}</p>
    </main>
  )
}

export interface AccountDetailViewProps {
  account: AccountRead
  bank?: string
  lastUpdated?: string | null
  pages: AccountHistoryPage[]
  isLoading?: boolean
  isFetchingNextPage: boolean
  hasNextPage: boolean
  onLoadMore: () => void
  today?: Date
  onSyncClick?: () => void
  syncDisabled?: boolean
  syncSpinning?: boolean
  syncSucceededAt?: number | null
  focusTransactionId?: number
  focusNavKey?: string
}
