import { useEffect, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import { api } from './api'
import { authQueryKeys, type CredentialRead } from './auth'
import { syncJobWebSocketUrl } from './syncSocket'

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

export type SyncJobErrorCode = 'invalid_credentials' | 'redirect_url_not_allowed' | 'unknown'

export interface SyncJob {
  job_id: string
  credential_id: number
  status: SyncJobStatus
  expires_at: string | null
  error: string | null
  error_code: SyncJobErrorCode | null
  /** External page (e.g. a PSD2 bank authorization) the user must visit to get the 2FA code. */
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
  /** True after the server signalled a terminal state (completed/failed). */
  isFinished: boolean
  /** True while the WebSocket is still trying to connect or has dropped before terminal. */
  isDisconnected: boolean
}

interface SubscriptionState {
  key: string | null
  job: SyncJob | null
  isConnected: boolean
}

const IDLE_SUBSCRIPTION: SubscriptionState = { key: null, job: null, isConnected: false }

/**
 * Subscribes to a sync job over WebSocket and exposes the latest server-pushed
 * state. The hook is a no-op (returns nulls) while {@link jobId} is null, which
 * lets callers gate the subscription behind "have I actually started a job yet".
 */
export function useSyncJob(credentialId: number | null, jobId: string | null): UseSyncJobState {
  const subscriptionKey =
    credentialId !== null && jobId !== null ? `${credentialId}/${jobId}` : null
  const [state, setState] = useState<SubscriptionState>(IDLE_SUBSCRIPTION)
  const queryClient = useQueryClient()

  useEffect(() => {
    if (credentialId === null || jobId === null) return

    const socket = new WebSocket(syncJobWebSocketUrl(credentialId, jobId))
    socket.onopen = () => setState((prev) => ({ ...prev, key: subscriptionKey, isConnected: true }))
    socket.onmessage = (event) => {
      const update = JSON.parse(event.data) as SyncJob
      setState({ key: subscriptionKey, job: update, isConnected: true })
      if (update.status === 'completed') {
        queryClient.invalidateQueries({ queryKey: authQueryKeys.me })
      }
    }
    socket.onclose = () => setState((prev) => ({ ...prev, isConnected: false }))

    return () => socket.close()
  }, [credentialId, jobId, subscriptionKey, queryClient])

  // Stale state from a previous job is filtered out by matching keys, which
  // sidesteps having to setState inside the effect just to reset.
  const job = state.key === subscriptionKey ? state.job : null
  const isConnected = state.key === subscriptionKey && state.isConnected
  const isFinished = job?.status === 'completed' || job?.status === 'failed'
  return { job, isFinished, isDisconnected: !isConnected }
}
