import { useEffect, useRef } from 'react'
import { createFileRoute, useRouter } from '@tanstack/react-router'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'

import { useAuthMe, useGlobalSync } from '@/lib/auth'
import { bankTitle } from '@/lib/credentials'
import { toastSyncFailure } from '@/lib/syncToast'
import { TwoFactorModal } from '@/components/two-factor-modal'
import { OverviewView } from '@/pages'

export const Route = createFileRoute('/')({
  component: OverviewPage,
})

function OverviewPage() {
  const { data: user } = useAuthMe()
  const sync = useGlobalSync()
  const { t } = useTranslation()
  const router = useRouter()

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
        const credential = user?.credentials.find((c) => c.id === job.credential_id)
        toastSyncFailure({
          t,
          bank: bankTitle(t, credential?.bank ?? '', credential?.bank_name),
          credentialId: job.credential_id,
          errorCode: job.error_code,
          navigate: (path) => router.history.push(path),
          onRetry: () => sync.start(),
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
            toast.error(t('sync.failed', { bank: bankTitle(t, bank, sync.current2fa?.bankName) }))
          }
        }}
        onSkip={() => {
          const bank = sync.current2fa?.bank ?? ''
          if (bank) {
            toast(t('sync.skipped', { bank: bankTitle(t, bank, sync.current2fa?.bankName) }))
          }
          sync.skip2fa()
        }}
      />
    </>
  )
}
