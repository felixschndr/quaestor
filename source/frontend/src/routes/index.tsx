import { useEffect, useRef } from 'react'
import { createFileRoute } from '@tanstack/react-router'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'

import { useAuthMe, useGlobalSync } from '@/lib/auth'
import { TwoFactorModal } from '@/components/two-factor-modal'
import { OverviewView } from '@/pages'

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
      if (
        job.status === 'failed' &&
        job.error_code !== 'cancelled' &&
        !toastedRef.current.has(job.credential_id)
      ) {
        toastedRef.current.add(job.credential_id)
        const bank = user?.credentials.find((c) => c.id === job.credential_id)?.bank ?? ''
        const bankTitle = t(`banks.${bank}.title`, { defaultValue: bank })
        const key =
          job.error_code === 'rate_limited'
            ? 'sync.rateLimited'
            : job.error_code === 'unsupported_bank'
              ? 'sync.unsupportedBank'
              : 'sync.failed'
        toast.error(t(key, { bank: bankTitle }), {
          action: { label: t('common.retry'), onClick: () => sync.start() },
        })
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
        syncJobs={sync.jobs}
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
