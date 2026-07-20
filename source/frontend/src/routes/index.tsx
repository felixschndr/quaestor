import { useCallback, useEffect, useRef } from 'react'
import { createFileRoute } from '@tanstack/react-router'
import { useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'

import { authQueryKeys, useAuthMe, useGlobalSync } from '@/lib/auth'
import { PullToRefresh } from '@/components/pull-to-refresh'
import { TwoFactorModal } from '@/components/two-factor-modal'
import { accountGroupQueryKeys } from '@/lib/accountGroups'
import { OverviewView } from '@/pages'

export const Route = createFileRoute('/')({
  component: OverviewPage,
})

function OverviewPage() {
  const { data: user } = useAuthMe()
  const sync = useGlobalSync()
  const { t } = useTranslation()
  const queryClient = useQueryClient()

  const handleRefresh = useCallback(
    () =>
      Promise.all([
        queryClient.refetchQueries({ queryKey: authQueryKeys.me }),
        queryClient.refetchQueries({ queryKey: accountGroupQueryKeys.layout }),
      ]),
    [queryClient],
  )

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
      if (
        job.status === 'failed' &&
        job.error_code !== 'cancelled' &&
        !toastedRef.current.has(job.credential_id)
      ) {
        toastedRef.current.add(job.credential_id)
        const bank = user?.credentials.find((c) => c.id === job.credential_id)?.bank ?? ''
        const bankTitle = t(`banks.${bank}.title`, { defaultValue: bank })
        const key = job.error_code === 'rate_limited' ? 'sync.rateLimited' : 'sync.failed'
        toast.error(t(key, { bank: bankTitle }))
      }
    }
  }, [sync.jobs, sync.status, user, t])

  if (!user) return null // Root guard already redirected to /login on 401.

  const isBusy =
    sync.status === 'starting' || sync.status === 'running' || sync.status === 'awaiting_2fa'

  return (
    <>
      <PullToRefresh onRefresh={handleRefresh}>
        <OverviewView
          user={user}
          onSyncClick={sync.start}
          syncDisabled={isBusy}
          syncSpinning={isBusy}
          syncSucceededAt={sync.succeededAt}
        />
      </PullToRefresh>
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
