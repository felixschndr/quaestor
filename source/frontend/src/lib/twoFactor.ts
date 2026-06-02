import { useMutation, useQueryClient } from '@tanstack/react-query'

import { api } from './api'
import { authQueryKeys, type UserRead } from './auth'

export interface TwoFactorSetup {
  secret: string
  otpauth_uri: string
  /** SVG data URI, ready to use as an <img src>. */
  qr_code: string
}

export interface BackupCodes {
  backup_codes: string[]
}

export function useStartTwoFactorSetup(userId: number) {
  return useMutation({
    mutationFn: () => api<TwoFactorSetup>(`/users/${userId}/2fa/setup`, { method: 'POST' }),
  })
}

export function useEnableTwoFactor(userId: number) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (code: string) =>
      api<BackupCodes>(`/users/${userId}/2fa/enable`, { method: 'POST', body: { code } }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: authQueryKeys.me })
    },
  })
}

export function useRegenerateBackupCodes(userId: number) {
  return useMutation({
    mutationFn: () => api<BackupCodes>(`/users/${userId}/2fa/backup-codes`, { method: 'POST' }),
  })
}

export function useDisableTwoFactor(userId: number) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (code: string) =>
      api<void>(`/users/${userId}/2fa/disable`, { method: 'POST', body: { code } }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: authQueryKeys.me })
    },
  })
}

export interface VerifyTwoFactorPayload {
  challenge_token: string
  code: string
  remember_me: boolean
}

export function useVerifyTwoFactorLogin() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (payload: VerifyTwoFactorPayload) =>
      api<UserRead>('/auth/2fa', { method: 'POST', body: payload }),
    onSuccess: (user) => {
      queryClient.setQueryData(authQueryKeys.me, user)
    },
  })
}
