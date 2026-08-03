import type { TFunction } from 'i18next'
import { useEffect, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import { api } from './api'
import { authQueryKeys, type CredentialRead } from './auth'

export const SYNC_POLL_INTERVAL_MS = 400

export interface CredentialFieldRule {
  name: string
  regex: string /* Regex string valid in both Python and JS; the field value must match it. */
  description: string
}

export interface CredentialFieldSpec {
  strip_whitespace: boolean
  rules: CredentialFieldRule[]
}

export interface SupportedBank {
  provider: string
  key: string
  name: string
  bic: string | null
  icon: string | null
  tested: boolean
  required_fields: string[]
  field_rules?: Record<string, CredentialFieldSpec>
  blzs: string[]
  countries?: string[]
}

export const credentialQueryKeys = {
  supportedBanks: ['credentials', 'supported_banks'] as const,
}

export function useSupportedBanks() {
  return useQuery({
    queryKey: credentialQueryKeys.supportedBanks,
    queryFn: () => api<SupportedBank[]>('/credentials/supported_banks'),
    staleTime: Infinity,
  })
}

export interface CredentialCreatePayload {
  bank: string
  credentials: Record<string, string>
}

export function useCreateCredential() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (payload: CredentialCreatePayload) =>
      api<CredentialRead>('/credentials', { method: 'POST', body: payload }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: authQueryKeys.me })
    },
  })
}

export interface CredentialUpdatePayload {
  sync_enabled?: boolean
}

export function useUpdateCredential() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ credentialId, ...fields }: CredentialUpdatePayload & { credentialId: number }) =>
      api<CredentialRead>(`/credentials/${credentialId}`, { method: 'PATCH', body: fields }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: authQueryKeys.me })
    },
  })
}

export function useDeleteCredential() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (credentialId: number) =>
      api<void>(`/credentials/${credentialId}`, { method: 'DELETE' }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: authQueryKeys.me })
    },
  })
}

export type SyncJobStatus =
  | 'running'
  | 'awaiting_2fa'
  | 'awaiting_decoupled_approval'
  | 'completed'
  | 'failed'

export type SyncJobErrorCode =
  | 'cancelled'
  | 'invalid_credentials'
  | 'unsupported_bank'
  | 'rate_limited'
  | 'redirect_url_not_allowed'
  | 'application_not_activated'
  | 'unknown'

export interface SyncJob {
  job_id: string
  credential_id: number
  status: SyncJobStatus
  expires_at: string | null
  error: string | null
  error_code: SyncJobErrorCode | null
  authorization_url?: string | null
}

export function useStartSync() {
  return useMutation({
    mutationFn: (credentialId: number) =>
      api<SyncJob>(`/credentials/${credentialId}/sync`, { method: 'POST' }),
  })
}

export interface TwoFactorPayload {
  credentialId: number
  jobId: string
  code: string
}

export function useConfirmTwoFactor() {
  return useMutation({
    mutationFn: ({ credentialId, jobId, code }: TwoFactorPayload) =>
      api<SyncJob>(`/credentials/${credentialId}/sync/${jobId}/2fa`, {
        method: 'POST',
        body: { code },
      }),
  })
}

export interface UseSyncJobState {
  job: SyncJob | null
  isFinished: boolean
  isDisconnected: boolean
}

interface SubscriptionState {
  key: string | null
  job: SyncJob | null
  isConnected: boolean
}

const IDLE_SUBSCRIPTION: SubscriptionState = { key: null, job: null, isConnected: false }

export function useSyncJob(credentialId: number | null, jobId: string | null): UseSyncJobState {
  const subscriptionKey =
    credentialId !== null && jobId !== null ? `${credentialId}/${jobId}` : null
  const [state, setState] = useState<SubscriptionState>(IDLE_SUBSCRIPTION)
  const queryClient = useQueryClient()

  useEffect(() => {
    if (credentialId === null || jobId === null) return
    let stopped = false
    const poll = async () => {
      try {
        const update = await api<SyncJob>(`/credentials/${credentialId}/sync/${jobId}`)
        if (stopped) return
        setState({ key: subscriptionKey, job: update, isConnected: true })
        if (update.status === 'completed') {
          queryClient.invalidateQueries({ queryKey: authQueryKeys.me })
        }
        if (update.status === 'completed' || update.status === 'failed') {
          window.clearInterval(interval)
        }
      } catch {
        if (!stopped) setState((prev) => ({ ...prev, isConnected: false }))
      }
    }
    const interval = window.setInterval(() => void poll(), SYNC_POLL_INTERVAL_MS)
    const onVisible = () => {
      if (document.visibilityState === 'visible') void poll()
    }
    document.addEventListener('visibilitychange', onVisible)
    void poll()
    return () => {
      stopped = true
      window.clearInterval(interval)
      document.removeEventListener('visibilitychange', onVisible)
    }
  }, [credentialId, jobId, subscriptionKey, queryClient])

  const job = state.key === subscriptionKey ? state.job : null
  const isConnected = state.key === subscriptionKey && state.isConnected
  const isFinished = job?.status === 'completed' || job?.status === 'failed'
  return { job, isFinished, isDisconnected: !isConnected }
}

export function bankDisplayName(t: TFunction, bank: SupportedBank): string {
  return bank.provider === bank.key
    ? t(`banks.${bank.provider}.title`, { defaultValue: bank.name })
    : bank.name
}

const VIA_HANDLER_LABELS: Record<string, string> = {
  fints: 'FinTS',
  enable_banking: 'Enable Banking',
}

export function viaHandlerLabel(provider: string): string | null {
  return VIA_HANDLER_LABELS[provider] ?? null
}
