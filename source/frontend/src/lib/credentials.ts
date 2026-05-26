import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import { api } from './api'
import { authQueryKeys, type CredentialRead } from './auth'

/**
 * Mirrors `BankInfo.information_for_user` on the backend. `note` lives in the
 * frontend i18n bundle instead (keyed by `name`), so banks can be translated.
 */
export interface SupportedBank {
  name: string
  required_fields: string[]
  icon: string
  bank_identifier?: string
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
      // Refresh `me` so the new credential (and any accounts it spawns after
      // the follow-up sync) shows up everywhere it's read from.
      queryClient.invalidateQueries({ queryKey: authQueryKeys.me })
    },
  })
}

export type SyncStatus = 'completed' | '2fa_required'

export interface SyncResponse {
  status: SyncStatus
  challenge_token: string | null
  expires_at: string | null
}

export function useSyncCredential() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (credentialId: number) =>
      api<SyncResponse>(`/credentials/${credentialId}/sync`, { method: 'POST' }),
    onSuccess: () => {
      // A successful sync may have created accounts and transactions — refresh
      // the user snapshot so the overview reflects them.
      queryClient.invalidateQueries({ queryKey: authQueryKeys.me })
    },
  })
}

export interface TwoFactorConfirmPayload {
  credentialId: number
  challengeToken: string
  code: string
}

export function useConfirmTwoFactor() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ credentialId, challengeToken, code }: TwoFactorConfirmPayload) =>
      api<SyncResponse>(`/credentials/${credentialId}/sync/2fa`, {
        method: 'POST',
        body: { challenge_token: challengeToken, code },
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: authQueryKeys.me })
    },
  })
}
