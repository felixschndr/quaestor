import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useMutation, useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query'
import { redirect } from '@tanstack/react-router'
import { api, ApiError } from './api'
import type { SyncJob, SyncJobStatus } from './credentials'

export interface AccountRead {
  id: number
  name: string
  display_name: string | null
  balance: number
  balance_factor: number
  /** When true the account is filtered out of the overview and excluded from
   *  user.balance + group totals. Stays visible in management views. */
  is_hidden: boolean
}

export interface CredentialRead {
  id: number
  bank: string
  accounts: AccountRead[]
  last_fetching_timestamp: string | null
  requires_two_factor_authentication: boolean
}

export type Theme = 'LIGHT' | 'DARK' | 'SYSTEM'

export interface UserRead {
  id: number
  user_name: string
  display_name: string
  language: string
  theme: Theme
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
 * On 401, or when /auth/me can't be reached at all (e.g. dev backend not yet
 * up — `fetch` throws TypeError before any response), throws a TanStack Router
 * `redirect()` to /login so the user lands on a usable screen instead of an
 * empty page. Genuine server errors (5xx etc.) still propagate so a real bug
 * surfaces in the router's error component rather than getting swallowed.
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
    if (err instanceof ApiError && err.status !== 401) throw err
    throw redirect({
      to: '/login',
      search: { next: args.pathname + (args.search ?? '') },
    })
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
  theme?: Theme
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

export type GlobalSyncStatus = 'idle' | 'starting' | 'running' | 'awaiting_2fa' | 'done'

export interface Current2FA {
  credentialId: number
  jobId: string
  bank: string
  /** 'awaiting_2fa' (Trade Republic-style code) or 'awaiting_decoupled_approval' (pushTAN). */
  kind: 'awaiting_2fa' | 'awaiting_decoupled_approval'
}

export interface UseGlobalSyncResult {
  start: () => void
  status: GlobalSyncStatus
  jobs: Map<number, SyncJob>
  current2fa: Current2FA | null
  submit2fa: (code: string) => Promise<void>
  skip2fa: () => void
}

function syncJobWebSocketUrl(credentialId: number, jobId: string): string {
  const scheme = window.location.protocol === 'https:' ? 'wss' : 'ws'
  return `${scheme}://${window.location.host}/api/credentials/${credentialId}/sync/${jobId}/ws`
}

const TWO_FACTOR_STATUSES = new Set<SyncJobStatus>(['awaiting_2fa', 'awaiting_decoupled_approval'])
const TERMINAL_STATUSES = new Set<SyncJobStatus>(['completed', 'failed'])

/**
 * Internal state-machine phase.
 *
 * `'finishing'` is set when the POST returns either zero jobs or an error,
 * so the public `status` flips to `'done'` immediately. For the happy path,
 * the hook stays in `'active'` until every job is terminal and `'done'` is
 * derived from the job map.
 */
type GlobalSyncPhase = 'idle' | 'starting' | 'active' | 'finishing'

/**
 * Drives the "sync everything" flow on the overview page. Starts one async
 * job per credential, opens one WebSocket per job, serializes any 2FA
 * challenges into a single-item-at-a-time queue, and resolves to 'done' once
 * all jobs reach a terminal state.
 */
export function useGlobalSync(): UseGlobalSyncResult {
  const queryClient = useQueryClient()
  const [phase, setPhase] = useState<GlobalSyncPhase>('idle')
  const [jobs, setJobs] = useState<Map<number, SyncJob>>(new Map())
  // `queue[0]` is the credential currently prompting the user for 2FA, the
  // remaining entries are queued. Shifted by submit2fa/skip2fa, appended by
  // the WebSocket message handler.
  const [queue, setQueue] = useState<number[]>([])
  // The WS handler captures this ref so it can read the latest queue
  // without forcing the per-job effect below to resubscribe on every render.
  const queueRef = useRef<number[]>(queue)
  useEffect(() => {
    queueRef.current = queue
  }, [queue])

  const current2faId = queue[0] ?? null

  // Once every active job reaches a terminal state and no 2FA prompt is
  // pending, the hook is implicitly "done" without an explicit setState.
  const allJobsTerminal = useMemo(
    () => jobs.size > 0 && Array.from(jobs.values()).every((j) => TERMINAL_STATUSES.has(j.status)),
    [jobs],
  )
  const isDone =
    phase === 'finishing' || (phase === 'active' && allJobsTerminal && queue.length === 0)

  const credentialBank = useCallback(
    (credentialId: number): string => {
      const user = queryClient.getQueryData<UserRead>(authQueryKeys.me)
      return user?.credentials.find((c) => c.id === credentialId)?.bank ?? ''
    },
    [queryClient],
  )

  const start = useCallback(() => {
    setPhase((prev) => {
      // Only allow start from a settled phase — block re-entry while a sync
      // is mid-flight.
      if (prev === 'starting' || prev === 'active') return prev
      // Reset transient state alongside the phase transition so the next
      // render sees a clean slate.
      setJobs(new Map())
      setQueue([])
      void (async () => {
        try {
          const started = await api<SyncJob[]>('/users/sync', { method: 'POST' })
          if (started.length === 0) {
            // No credentials → nothing to sync, jump straight to done.
            setPhase('finishing')
            return
          }
          const initial = new Map<number, SyncJob>()
          for (const job of started) initial.set(job.credential_id, job)
          setJobs(initial)
          setPhase('active')
        } catch {
          // Network/CSRF/auth failure — surface a toast via the caller's effect.
          setPhase('finishing')
        }
      })()
      return 'starting'
    })
  }, [])

  // Open one WebSocket per job. Re-runs when the job map keys change
  // (i.e., when start() seeds the initial jobs).
  const jobKeys = useMemo(() => Array.from(jobs.keys()).sort().join(','), [jobs])
  useEffect(() => {
    if (jobs.size === 0) return
    const sockets: WebSocket[] = []
    for (const [credentialId, job] of jobs) {
      // Already terminal — no need to subscribe.
      if (TERMINAL_STATUSES.has(job.status)) continue
      const socket = new WebSocket(syncJobWebSocketUrl(credentialId, job.job_id))
      socket.onmessage = (event) => {
        const update = JSON.parse(event.data) as SyncJob
        setJobs((prev) => {
          const next = new Map(prev)
          next.set(update.credential_id, update)
          return next
        })
        if (TWO_FACTOR_STATUSES.has(update.status)) {
          // Enqueue if not already in queue.
          if (!queueRef.current.includes(update.credential_id)) {
            setQueue((prev) => [...prev, update.credential_id])
          }
        }
      }
      sockets.push(socket)
    }
    return () => {
      for (const socket of sockets) socket.close()
    }
    // jobKeys is the dependency that captures "the set of initial jobs"
    // without re-firing the effect on every status update.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [jobKeys])

  // Side effect of "we just transitioned into done": refresh /auth/me so the
  // post-sync balance/transaction snapshot lands in the cache. The `finishing`
  // phase represents the failure / no-credentials path, where there is
  // nothing new to fetch.
  useEffect(() => {
    if (!isDone) return
    if (phase === 'finishing') return
    queryClient.invalidateQueries({ queryKey: authQueryKeys.me })
  }, [isDone, phase, queryClient])

  const status: GlobalSyncStatus = useMemo(() => {
    if (phase === 'idle') return 'idle'
    if (phase === 'starting') return 'starting'
    if (isDone) return 'done'
    return current2faId !== null ? 'awaiting_2fa' : 'running'
  }, [phase, isDone, current2faId])

  const current2fa: Current2FA | null = useMemo(() => {
    if (current2faId === null) return null
    const job = jobs.get(current2faId)
    if (!job) return null
    return {
      credentialId: current2faId,
      jobId: job.job_id,
      bank: credentialBank(current2faId),
      kind:
        job.status === 'awaiting_decoupled_approval'
          ? 'awaiting_decoupled_approval'
          : 'awaiting_2fa',
    }
  }, [current2faId, jobs, credentialBank])

  const submit2fa = useCallback(
    async (code: string) => {
      const activeId = queue[0]
      if (activeId === undefined) return
      const job = jobs.get(activeId)
      if (!job) return
      await api<SyncJob>(`/credentials/${activeId}/sync/${job.job_id}/2fa`, {
        method: 'POST',
        body: { code },
      })
      setQueue((prev) => prev.slice(1))
    },
    [queue, jobs],
  )

  const skip2fa = useCallback(() => {
    setQueue((prev) => prev.slice(1))
  }, [])

  return { start, status, jobs, current2fa, submit2fa, skip2fa }
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
