import { useMutation, useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query'
import { redirect } from '@tanstack/react-router'
import { api, ApiError } from './api'

export interface AccountRead {
  id: number
  name: string
  balance: number
  balance_factor: number
}

export interface CredentialRead {
  id: number
  bank: string
  accounts: AccountRead[]
  last_fetching_timestamp: string | null
  requires_two_factor_authentication: boolean
}

export interface UserRead {
  id: number
  user_name: string
  display_name: string
  language: string
  balance: number
  credentials: CredentialRead[]
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

export function useAuthMe() {
  return useQuery({
    queryKey: authQueryKeys.me,
    queryFn: () => api<UserRead>('/auth/me'),
    retry: false,
  })
}

/**
 * `next` paths come from the URL — guard against open redirects to external
 * sites (`//evil.com`, `http://evil.com`, etc.). Only honour same-origin
 * absolute paths.
 */
export function safeNext(next: string | undefined): string {
  if (!next) return '/'
  if (!next.startsWith('/') || next.startsWith('//')) return '/'
  return next
}

/**
 * Used by the root route's `beforeLoad` to gate every page on a valid session.
 * Side-effect on 401: throws a TanStack Router `redirect()` to /login with the
 * intended destination preserved as `?next=`.
 */
export async function ensureAuthenticated(args: {
  queryClient: QueryClient
  pathname: string
  search: string
}): Promise<void> {
  // /login itself must be reachable while unauthenticated — otherwise we'd
  // loop forever between the guard and the redirect target.
  if (args.pathname === '/login') return
  try {
    await args.queryClient.ensureQueryData({
      queryKey: authQueryKeys.me,
      queryFn: () => api<UserRead>('/auth/me'),
      retry: false,
    })
  } catch (err) {
    if (err instanceof ApiError && err.status === 401) {
      throw redirect({
        to: '/login',
        search: { next: args.pathname + (args.search ?? '') },
      })
    }
    throw err
  }
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
 * Trigger a sync of every credential of the current user. After the backend
 * returns, refresh /api/auth/me so the balance + transaction snapshot the
 * page renders is the post-sync state.
 */
export function useGlobalSync() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: () => api<void>('/users/sync', { method: 'POST' }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: authQueryKeys.me }),
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
