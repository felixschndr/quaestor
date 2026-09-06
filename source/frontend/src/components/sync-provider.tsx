import { createContext, useCallback, useContext, useEffect, useRef, type ReactNode } from 'react'
import { useRouter } from '@tanstack/react-router'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'

import { TwoFactorModal } from '@/components/two-factor-modal'
import { useAppSync, useAuthMe, type UseAppSyncResult } from '@/lib/auth'
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

  const toastedRef = useRef<Set<number>>(new Set())
  const unattendedRef = useRef(false)

  const { start: startSync } = sync
  const start = useCallback(
    (options?: { dueOnly?: boolean }) => {
      unattendedRef.current = options?.dueOnly ?? false
      startSync(options)
    },
    [startSync],
  )

  const userId = user?.id
  useEffect(() => {
    if (userId === undefined) return
    const autoSync = () => {
      if (document.visibilityState !== 'visible') return
      start({ dueOnly: true })
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
        !toastedRef.current.has(job.credential_id)
      ) {
        const credential = user?.credentials.find((c) => c.id === job.credential_id)
        if (unattendedRef.current && credential && hasSyncError(credential)) continue
        toastedRef.current.add(job.credential_id)
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
