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
 * Internal state-machine phase. The public `status` maps from this:
 * - 'idle' → 'idle'
 * - 'starting' → 'starting'
 * - 'active' + current2faId → 'awaiting_2fa'
 * - 'active' otherwise → 'running'
 * - 'done' / 'finishing' → 'done'
 *
 * `'done'` and `'finishing'` are both terminal but distinguished so the
 * "refresh /auth/me" side effect only fires after a real sync, not after a
 * zero-credential or error short-circuit.
 */
type GlobalSyncPhase = 'idle' | 'starting' | 'active' | 'done' | 'finishing'

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

  const allJobsTerminal = useMemo(
    () => jobs.size > 0 && Array.from(jobs.values()).every((j) => TERMINAL_STATUSES.has(j.status)),
    [jobs],
  )

  const credentialBank = useCallback(
    (credentialId: number): string => {
      const user = queryClient.getQueryData<UserRead>(authQueryKeys.me)
      return user?.credentials.find((c) => c.id === credentialId)?.bank ?? ''
    },
    [queryClient],
  )

  const phaseRef = useRef<GlobalSyncPhase>(phase)
  useEffect(() => {
    phaseRef.current = phase
  }, [phase])

  const start = useCallback(() => {
    // Only allow start from a settled phase. 'done' / 'finishing' / 'idle' are
    // re-entry points; 'starting' / 'active' mean a sync is mid-flight.
    if (phaseRef.current === 'starting' || phaseRef.current === 'active') return
    phaseRef.current = 'starting'
    setPhase('starting')
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

  // Advance phase 'active' → 'done' when every job is terminal and no 2FA
  // prompt is queued. Also invalidates /auth/me so the post-sync balance lands
  // in the cache. The 'finishing' phase (zero credentials / POST error) is
  // already terminal, so it doesn't pass through here. The single follow-up
  // render is acceptable — it happens once per sync run, when every WebSocket
  // has just announced the last update.
  useEffect(() => {
    if (phase !== 'active') return
    if (!allJobsTerminal || queue.length > 0) return
    phaseRef.current = 'done'
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setPhase('done')
    queryClient.invalidateQueries({ queryKey: authQueryKeys.me })
  }, [phase, allJobsTerminal, queue.length, queryClient])

  const status: GlobalSyncStatus = useMemo(() => {
    if (phase === 'idle') return 'idle'
    if (phase === 'starting') return 'starting'
    if (phase === 'done' || phase === 'finishing') return 'done'
    return current2faId !== null ? 'awaiting_2fa' : 'running'
  }, [phase, current2faId])

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
