import { createContext, useContext, useEffect, useRef, type ReactNode } from 'react'
import { useRouter } from '@tanstack/react-router'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'

import { TwoFactorModal } from '@/components/two-factor-modal'
import {
  AUTO_SYNC_MAX_AGE_MS,
  staleSyncCredentialIds,
  useAppSync,
  useAuthMe,
  type UseAppSyncResult,
  type UserRead,
} from '@/lib/auth'
import { bankTitle, hasSyncError } from '@/lib/credentials'
import { toastSyncFailure } from '@/lib/syncToast'

const SyncContext = createContext<UseAppSyncResult | null>(null)

export function useSync(): UseAppSyncResult {
  const sync = useContext(SyncContext)
  if (sync === null) throw new Error('useSync must be used within <SyncProvider>')
  return sync
}

export function SyncProvider({ children }: { children: ReactNode }) {
  const { data: user } = useAuthMe()
  const sync = useAppSync()
  const { t } = useTranslation()
  const router = useRouter()

  const userRef = useRef<UserRead | undefined>(user)
  useEffect(() => {
    userRef.current = user
  }, [user])

  const toastedRef = useRef<Set<number>>(new Set())
  const silencedRef = useRef<Set<number>>(new Set())

  const { start } = sync
  const lastAutoSyncRef = useRef(0)
  const userId = user?.id
  useEffect(() => {
    const autoSync = () => {
      if (document.visibilityState !== 'visible') return
      const now = Date.now()
      if (now - lastAutoSyncRef.current < AUTO_SYNC_MAX_AGE_MS) return
      const credentialIds = staleSyncCredentialIds(userRef.current, now)
      if (credentialIds.length === 0) return
      lastAutoSyncRef.current = now
      silencedRef.current = new Set(
        (userRef.current?.credentials ?? [])
          .filter((credential) => credentialIds.includes(credential.id) && hasSyncError(credential))
          .map((credential) => credential.id),
      )
      start(credentialIds)
    }
    autoSync()
    document.addEventListener('visibilitychange', autoSync)
    return () => document.removeEventListener('visibilitychange', autoSync)
  }, [start, userId])

  useEffect(() => {
    if (sync.status === 'starting') {
      toastedRef.current.clear()
      return
    }
    for (const job of sync.jobs.values()) {
      if (
        job.status === 'failed' &&
        job.error_code !== 'cancelled' &&
        !toastedRef.current.has(job.credential_id) &&
        !silencedRef.current.has(job.credential_id)
      ) {
        toastedRef.current.add(job.credential_id)
        const credential = user?.credentials.find((c) => c.id === job.credential_id)
        toastSyncFailure({
          t,
          bank: bankTitle(t, credential?.bank ?? '', credential?.bank_name),
          credentialId: job.credential_id,
          errorCode: job.error_code,
          navigate: (path) => router.history.push(path),
          onRetry: () => start(),
        })
      }
    }
  }, [sync.jobs, sync.status, user, t, router, start])

  return (
    <SyncContext.Provider value={sync}>
      {children}
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
    </SyncContext.Provider>
  )
}
