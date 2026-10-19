import { useEffect, useRef } from 'react'
import { createFileRoute, useRouter } from '@tanstack/react-router'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'

import { useAuthMe, useCredentialSync, type CredentialRead } from '@/lib/auth'
import { bankTitle } from '@/lib/credentials'
import { toastSyncFailure } from '@/lib/syncToast'
import { TwoFactorModal } from '@/components/two-factor-modal'
import { CredentialDetailView } from '@/pages/settings.credentials.$credentialId'

export const Route = createFileRoute('/settings/credentials/$credentialId')({
  component: CredentialDetailPage,
})

function CredentialDetailPage() {
  const { credentialId } = Route.useParams()
  const { data: user } = useAuthMe()
  const router = useRouter()
  const { t } = useTranslation()
  const credential = user?.credentials.find((c) => c.id === Number(credentialId))
  const sync = useCredentialSync(Number(credentialId))

  const hadCredential = useRef(false)
  useEffect(() => {
    if (credential) {
      hadCredential.current = true
    } else if (hadCredential.current && user) {
      router.history.push('/settings/credentials')
    }
  }, [credential, user, router])

  const syncFailedAt = sync.failedAt
  useEffect(() => {
    if (syncFailedAt === null || !credential) return
    const failed = Array.from(sync.jobs.values()).find((job) => job.status === 'failed')
    toastSyncFailure({
      t,
      bank: bankTitle(t, credential.bank, credential.bank_name),
      credentialId: credential.id,
      errorCode: failed?.error_code,
      navigate: (path) => router.history.push(path),
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [syncFailedAt])

  if (!user) return null // root guard already redirected on 401

  const syncBusy =
    sync.status === 'starting' || sync.status === 'running' || sync.status === 'awaiting_2fa'
  const bank = credential ? bankTitle(t, credential.bank, credential.bank_name) : ''

  return (
    <>
      <CredentialDetailView
        credential={credential}
        onDeleted={() => router.history.push('/settings/credentials')}
        onSyncClick={sync.start}
        syncBusy={syncBusy}
        syncSucceededAt={sync.succeededAt}
      />
      <TwoFactorModal
        current2fa={sync.current2fa}
        onSubmit={async (code) => {
          try {
            await sync.submit2fa(code)
          } catch {
            toast.error(t('sync.failed', { bank }))
          }
        }}
        onSkip={() => {
          toast(t('sync.skipped', { bank }))
          sync.skip2fa()
        }}
      />
    </>
  )
}

export interface CredentialDetailViewProps {
  credential: CredentialRead | undefined
  onDeleted: () => void
  onSyncClick?: () => void
  syncBusy?: boolean
  syncSucceededAt?: number | null
}
