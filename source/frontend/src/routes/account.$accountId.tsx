import { createFileRoute } from '@tanstack/react-router'
import { useTranslation } from 'react-i18next'

import { useAuthMe, type AccountRead } from '@/lib/auth'
import { isManualBank } from '@/lib/credentials'
import { findAccountInUser, useAccountHistory, type AccountHistoryPage } from '@/lib/accountHistory'
import { isStale } from '@/lib/format'
import { useCredentialSync } from '@/components/sync-provider'
import { AccountDetailView } from '@/pages/account.$accountId'
import { NotFound } from '@/components/not-found'

export const Route = createFileRoute('/account/$accountId')({
  component: AccountDetailPage,
})

function AccountDetailPage() {
  const { accountId: rawId } = Route.useParams()
  const accountId = Number(rawId)
  const { data: user } = useAuthMe()
  const accountInfo = findAccountInUser(user, accountId)

  const history = useAccountHistory(accountId)
  const sync = useCredentialSync(accountInfo?.credentialId ?? -1)

  if (!user) return null // Root guard already redirected on 401.

  if (!accountInfo) {
    return <AccountNotFoundView />
  }

  const isManual = isManualBank(accountInfo.bank)
  const permission = accountInfo.sharePermission
  const canSync =
    !isManual && (permission === null || (permission === 'write' && !accountInfo.requiresTwoFactor))

  return (
    <AccountDetailView
      account={accountInfo.account}
      bank={accountInfo.bank}
      isOwner={permission === null}
      canWrite={permission === null || permission === 'write'}
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
      onSyncClick={canSync ? sync.start : undefined}
      syncDisabled={sync.busy}
      syncSpinning={sync.busy}
      syncSucceededAt={sync.succeededAt}
      syncWarn={accountInfo.syncEnabled && isStale(accountInfo.lastFetchingTimestamp)}
    />
  )
}

function AccountNotFoundView() {
  const { t } = useTranslation()
  return (
    <NotFound message={t('account.notFound')} backTo="/" backLabel={t('common.backToOverview')} />
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
  syncWarn?: boolean
  isOwner?: boolean
  canWrite?: boolean
}
