import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from './api'

export interface UserRead {
  id: number
  user_name: string
  display_name: string
  language: string
  balance: number
}

export interface RegistrationAllowed {
  allowed: boolean
}

export interface PasswordRule {
  name: string
  regex: string
  description: string
}

export interface PasswordRequirements {
  min_length: number
  rules: PasswordRule[]
}

export const authQueryKeys = {
  me: ['auth', 'me'] as const,
  registrationAllowed: ['auth', 'registration_allowed'] as const,
  passwordRequirements: ['auth', 'password_requirements'] as const,
}

export function useRegistrationAllowed() {
  return useQuery({
    queryKey: authQueryKeys.registrationAllowed,
    queryFn: () => api<RegistrationAllowed>('/auth/registration_allowed'),
  })
}

export function usePasswordRequirements() {
  return useQuery({
    queryKey: authQueryKeys.passwordRequirements,
    queryFn: () => api<PasswordRequirements>('/auth/password_requirements'),
    staleTime: Infinity,
  })
}

export interface LoginPayload {
  user_name: string
  password: string
  remember_me: boolean
}

export function useLogin() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (payload: LoginPayload) =>
      api<UserRead>('/auth/login', { method: 'POST', body: payload }),
    onSuccess: (user) => {
      queryClient.setQueryData(authQueryKeys.me, user)
    },
  })
}

export interface RegisterPayload {
  user_name: string
  display_name: string
  password: string
}

export function useRegister() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (payload: RegisterPayload) =>
      api<UserRead>('/auth/register', { method: 'POST', body: payload }),
    onSuccess: (user) => {
      queryClient.setQueryData(authQueryKeys.me, user)
    },
  })
}

/**
 * Walks a password through the live rules from the backend.
 * Returns the rule names that the password currently fails (so the UI can
 * translate the labels via login.passwordRule.<name>).
 */
export function evaluatePassword(
  password: string,
  requirements: PasswordRequirements | undefined,
): { unmetRuleNames: string[]; tooShort: boolean } {
  if (!requirements) return { unmetRuleNames: [], tooShort: false }
  const unmetRuleNames = requirements.rules
    .filter((rule) => !new RegExp(rule.regex).test(password))
    .map((rule) => rule.name)
  return {
    unmetRuleNames,
    tooShort: password.length < requirements.min_length,
  }
}
