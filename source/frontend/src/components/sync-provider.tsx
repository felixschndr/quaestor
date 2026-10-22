import { createContext, useCallback, useContext, useEffect, useRef, type ReactNode } from 'react'
import { useRouter } from '@tanstack/react-router'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'

import { TwoFactorModal } from '@/components/two-factor-modal'
import { ApiError } from '@/lib/api'
import { useAppSync, useAuthMe, type CredentialSyncState, type UseAppSyncResult } from '@/lib/auth'
import { bankTitle, hasSyncError } from '@/lib/credentials'
import { toastSyncFailure } from '@/lib/syncToast'

export interface SyncContextValue extends Omit<UseAppSyncResult, 'start'> {
  start: (options?: { credentialId?: number }) => void
}

const SyncContext = createContext<SyncContextValue | null>(null)

export function useSync(): SyncContextValue {
  const sync = useContext(SyncContext)
  if (sync === null) throw new Error('useSync must be used within <SyncProvider>')
  return sync
}

export function useCredentialSync(
  credentialId: number,
): CredentialSyncState & { start: () => void } {
  const { start, credential } = useSync()
  return { ...credential(credentialId), start: () => start({ credentialId }) }
}

export function SyncProvider({ children }: { children: ReactNode }) {
  const { data: user } = useAuthMe()
  const sync = useAppSync()
  const { t } = useTranslation()
  const router = useRouter()

  const toastedRef = useRef<Set<string>>(new Set())
  const unattendedRef = useRef<Set<number>>(new Set())

  const { start: startSync, adopt } = sync

  const bankOf = useCallback(
    (credentialId: number) => {
      const credential = user?.credentials.find((c) => c.id === credentialId)
      return bankTitle(t, credential?.bank ?? '', credential?.bank_name)
    },
    [user, t],
  )

  const start = useCallback(
    (options?: { credentialId?: number }) => {
      const credentialId = options?.credentialId
      if (credentialId === undefined) unattendedRef.current.clear()
      else unattendedRef.current.delete(credentialId)
      startSync(options).catch((error: unknown) => {
        if (credentialId === undefined) return
        if (error instanceof ApiError && error.status === 403) {
          toast.error(t('sync.notAllowedForShare'))
          return
        }
        toastSyncFailure({
          t,
          bank: bankOf(credentialId),
          credentialId,
          navigate: (path) => router.history.push(path),
        })
      })
    },
    [startSync, bankOf, t, router],
  )

  const userId = user?.id
  useEffect(() => {
    if (userId === undefined) return
    const autoSync = () => {
      if (document.visibilityState !== 'visible') return
      startSync({ dueOnly: true }).then(
        (started) => started.forEach((job) => unattendedRef.current.add(job.credential_id)),
        () => {},
      )
    }
    autoSync()
    void adopt()
    document.addEventListener('visibilitychange', autoSync)
    return () => document.removeEventListener('visibilitychange', autoSync)
  }, [startSync, adopt, userId])

  useEffect(() => {
    for (const job of sync.jobs.values()) {
      if (
        job.status !== 'failed' ||
        job.error_code === 'cancelled' ||
        toastedRef.current.has(job.job_id)
      ) {
        continue
      }
      const credential = user?.credentials.find((c) => c.id === job.credential_id)
      if (unattendedRef.current.has(job.credential_id) && credential && hasSyncError(credential)) {
        continue
      }
      toastedRef.current.add(job.job_id)
      toastSyncFailure({
        t,
        bank: bankOf(job.credential_id),
        credentialId: job.credential_id,
        errorCode: job.error_code,
        navigate: (path) => router.history.push(path),
        onRetry: () => start({ credentialId: job.credential_id }),
      })
    }
  }, [sync.jobs, user, t, router, start, bankOf])

  return (
    <SyncContext.Provider value={{ ...sync, start }}>
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
