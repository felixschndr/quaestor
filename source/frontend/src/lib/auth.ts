import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  onlineManager,
  useMutation,
  useQuery,
  useQueryClient,
  type QueryClient,
} from '@tanstack/react-query'
import { redirect } from '@tanstack/react-router'
import { api, ApiError, NetworkError } from './api'
import { clearOfflineCache } from './offlineCache'
import { accountQueryKeys } from './accountHistory'
import {
  SYNC_POLL_INTERVAL_MS,
  type SyncJob,
  type SyncJobErrorCode,
  type SyncJobStatus,
} from './credentials'

export interface AccountRead {
  id: number
  name: string
  display_name: string | null
  balance: number
  balance_factor: number
  is_hidden: boolean
  include_by_default: boolean
  is_market_valued: boolean
}

export interface CredentialRead {
  id: number
  bank: string
  bank_name: string | null
  bank_icon: string | null
  accounts: AccountRead[]
  last_successful_sync_timestamp: string | null
  requires_two_factor_authentication: boolean
  sync_enabled: boolean
  last_sync_error?: string | null
  last_sync_error_code?: SyncJobErrorCode | null
  shared_from?: string | null
  share_permission?: SharePermission | null
}

export type SharePermission = 'read' | 'write'

export interface AccountShareInvitation {
  id: number
  credential_id: number
  account_name: string
  bank_name: string
  owner_name: string
  permission: SharePermission
}

export type Theme = 'LIGHT' | 'DARK' | 'SYSTEM'

export interface UserRead {
  id: number
  user_name: string
  display_name: string
  language: string
  currency: string
  theme: Theme
  two_factor_enabled: boolean
  show_upcoming_contracts: boolean
  balance: number
  credentials: CredentialRead[]
  account_share_invitations?: AccountShareInvitation[]
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
  passwordRequirements: ['auth', 'password_requirements'] as const,
}

const ME_RECHECK_INTERVAL_MS = 30_000

const meQueryOptions = {
  queryKey: authQueryKeys.me,
  queryFn: () => api<UserRead>('/auth/me'),
  retry: false,
} as const

export function useAuthMe() {
  return useQuery(meQueryOptions)
}

export function safeNext(next: string | undefined): string {
  if (!next) return '/'
  if (!next.startsWith('/') || next.startsWith('//')) return '/'
  return next
}

export async function ensureAuthenticated(args: {
  queryClient: QueryClient
  pathname: string
  search: string
}): Promise<void> {
  if (args.pathname === '/login') return
  const { queryClient } = args
  try {
    if (onlineManager.isOnline() || queryClient.getQueryData(authQueryKeys.me) === undefined) {
      await queryClient.query({ ...meQueryOptions, staleTime: ME_RECHECK_INTERVAL_MS })
    }
  } catch (err) {
    if (err instanceof NetworkError && queryClient.getQueryData(authQueryKeys.me)) return
    if (err instanceof ApiError && err.status === 401) {
      queryClient.removeQueries()
      await clearOfflineCache()
      throw redirect({
        to: '/login',
        search: { next: args.pathname + (args.search ?? '') },
      })
    }
    throw err
  }
}

export async function redirectIfAuthenticated(args: {
  queryClient: QueryClient
  next: string | undefined
}): Promise<void> {
  try {
    await args.queryClient.ensureQueryData(meQueryOptions)
  } catch {
    // Not authenticated (401) or backend unreachable --> show the login form.
    return
  }
  throw redirect({ to: safeNext(args.next) })
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

interface TwoFactorRequiredResponse {
  two_factor_required: true
  challenge_token: string
}

export type LoginResult =
  | { kind: 'authenticated'; user: UserRead }
  | { kind: 'two_factor_required'; challenge_token: string }

function isTwoFactorRequired(value: unknown): value is TwoFactorRequiredResponse {
  return (
    typeof value === 'object' &&
    value !== null &&
    (value as { two_factor_required?: unknown }).two_factor_required === true
  )
}

export function useLogin() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (payload: LoginPayload): Promise<LoginResult> => {
      const response = await api<UserRead | TwoFactorRequiredResponse>('/auth/login', {
        method: 'POST',
        body: payload,
      })
      if (isTwoFactorRequired(response)) {
        return { kind: 'two_factor_required', challenge_token: response.challenge_token }
      }
      queryClient.setQueryData(authQueryKeys.me, response)
      return { kind: 'authenticated', user: response }
    },
  })
}

export interface RegisterPayload {
  user_name: string
  display_name: string
  password: string
  theme?: Theme
  language?: string
  currency?: string
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
  bankName: string | null
  bankIcon: string | null
  kind: 'awaiting_2fa' | 'confirming' | 'awaiting_decoupled_approval'
  authorizationUrl?: string | null
  deviceCode?: string | null
}

export interface SyncStartOptions {
  dueOnly?: boolean
  credentialId?: number
}

export interface CredentialSyncState {
  busy: boolean
  succeededAt: number | null
}

export interface UseAppSyncResult {
  start: (options?: SyncStartOptions) => Promise<SyncJob[]>
  adopt: () => Promise<void>
  credential: (credentialId: number) => CredentialSyncState
  status: GlobalSyncStatus
  jobs: Map<number, SyncJob>
  current2fa: Current2FA | null
  submit2fa: (code: string) => Promise<void>
  skip2fa: () => void
  succeededAt: number | null
  failedAt: number | null
}

const TWO_FACTOR_STATUSES = new Set<SyncJobStatus>([
  'awaiting_2fa',
  'confirming_2fa',
  'awaiting_decoupled_approval',
])
const TERMINAL_STATUSES = new Set<SyncJobStatus>(['completed', 'failed'])
const ALL_CREDENTIALS = 'all'
type StartKey = number | typeof ALL_CREDENTIALS

function isRunning(job: SyncJob | undefined): boolean {
  return job !== undefined && !TERMINAL_STATUSES.has(job.status)
}

export function useAppSync(): UseAppSyncResult {
  const queryClient = useQueryClient()
  const [phase, setPhase] = useState<'idle' | 'active' | 'done'>('idle')
  const [jobs, setJobs] = useState<Map<number, SyncJob>>(new Map())
  const [queue, setQueue] = useState<number[]>([])
  const [starting, setStarting] = useState<ReadonlySet<StartKey>>(new Set())
  const [finishedAt, setFinishedAt] = useState<ReadonlyMap<number, number>>(new Map())
  const [succeededAt, setSucceededAt] = useState<number | null>(null)
  const [failedAt, setFailedAt] = useState<number | null>(null)
  const jobsRef = useRef(jobs)
  const queueRef = useRef(queue)
  const startingRef = useRef(new Set<StartKey>())
  const startFailedRef = useRef(false)
  useEffect(() => {
    queueRef.current = queue
  }, [queue])

  const commitJobs = useCallback((next: Map<number, SyncJob>) => {
    jobsRef.current = next
    setJobs(next)
  }, [])

  const changeStarting = useCallback((change: (keys: Set<StartKey>) => void) => {
    change(startingRef.current)
    setStarting(new Set(startingRef.current))
  }, [])

  const isBusy = useCallback(
    () =>
      startingRef.current.size > 0 ||
      queueRef.current.length > 0 ||
      Array.from(jobsRef.current.values()).some(isRunning),
    [],
  )

  const beginRound = useCallback(() => {
    commitJobs(new Map())
    setQueue([])
    setSucceededAt(null)
    setFailedAt(null)
    startFailedRef.current = false
    setPhase('active')
  }, [commitJobs])

  const track = useCallback(
    (started: SyncJob[]) => {
      const next = new Map(jobsRef.current)
      for (const job of started) next.set(job.credential_id, job)
      commitJobs(next)
    },
    [commitJobs],
  )

  const applyUpdate = useCallback(
    (update: SyncJob) => {
      const previous = jobsRef.current.get(update.credential_id)
      track([update])
      if (TERMINAL_STATUSES.has(update.status) && isRunning(previous)) {
        setFinishedAt((prev) => new Map(prev).set(update.credential_id, Date.now()))
        void queryClient.invalidateQueries({ queryKey: authQueryKeys.me })
        void queryClient.invalidateQueries({ queryKey: accountQueryKeys.all })
      }
      setQueue((prev) => {
        const queued = prev.includes(update.credential_id)
        if (TWO_FACTOR_STATUSES.has(update.status)) {
          return queued ? prev : [...prev, update.credential_id]
        }
        return queued ? prev.filter((id) => id !== update.credential_id) : prev
      })
    },
    [track, queryClient],
  )

  const start = useCallback(
    async ({ credentialId, dueOnly = false }: SyncStartOptions = {}): Promise<SyncJob[]> => {
      const key: StartKey = credentialId ?? ALL_CREDENTIALS
      if (isBusy()) {
        if (credentialId === undefined) return []
        if (startingRef.current.has(ALL_CREDENTIALS) || startingRef.current.has(credentialId)) {
          return []
        }
        if (isRunning(jobsRef.current.get(credentialId))) return []
      } else {
        beginRound()
      }
      changeStarting((keys) => keys.add(key))
      try {
        const started =
          credentialId === undefined
            ? await api<SyncJob[]>(`/users/sync${dueOnly ? '?due_only=true' : ''}`, {
                method: 'POST',
              })
            : [await api<SyncJob>(`/credentials/${credentialId}/sync`, { method: 'POST' })]
        track(started)
        return started
      } catch (error) {
        startFailedRef.current = true
        throw error
      } finally {
        changeStarting((keys) => keys.delete(key))
      }
    },
    [isBusy, beginRound, changeStarting, track],
  )

  const adopt = useCallback(async () => {
    let serverJobs: SyncJob[]
    try {
      serverJobs = await api<SyncJob[]>('/credentials/sync')
    } catch {
      return
    }
    const untracked = serverJobs.filter(
      (job) => isRunning(job) && !isRunning(jobsRef.current.get(job.credential_id)),
    )
    if (untracked.length === 0) return
    if (!isBusy()) beginRound()
    track(untracked)
  }, [isBusy, beginRound, track])

  const jobKeys = useMemo(() => Array.from(jobs.keys()).sort().join(','), [jobs])
  useEffect(() => {
    if (jobs.size === 0) return
    let stopped = false
    const poll = async () => {
      const tracked = Array.from(jobsRef.current.values())
      if (!tracked.some(isRunning)) return
      const trackedJobIds = new Set(tracked.map((job) => job.job_id))
      try {
        const updates = await api<SyncJob[]>('/credentials/sync')
        if (stopped) return
        for (const update of updates) {
          if (trackedJobIds.has(update.job_id)) applyUpdate(update)
        }
      } catch {
        // Transient failure; the next tick retries.
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [jobKeys])

  const anyRunning = useMemo(() => Array.from(jobs.values()).some(isRunning), [jobs])
  const busy = starting.size > 0 || queue.length > 0 || anyRunning
  useEffect(() => {
    if (phase !== 'active' || busy) return
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setPhase('done')
    const reportable = Array.from(jobs.values()).filter((j) => j.error_code !== 'cancelled')
    if (startFailedRef.current || reportable.some((j) => j.status === 'failed')) {
      setFailedAt(Date.now())
    } else if (reportable.length > 0) {
      setSucceededAt(Date.now())
    }
  }, [phase, busy, jobs])

  const current2faId = queue[0] ?? null
  const status: GlobalSyncStatus = useMemo(() => {
    if (phase === 'idle') return 'idle'
    if (phase === 'done') return 'done'
    if (current2faId !== null) return 'awaiting_2fa'
    return anyRunning ? 'running' : 'starting'
  }, [phase, current2faId, anyRunning])

  const credential = useCallback(
    (credentialId: number): CredentialSyncState => {
      const job = jobs.get(credentialId)
      return {
        busy: starting.has(credentialId) || starting.has(ALL_CREDENTIALS) || isRunning(job),
        succeededAt: job?.status === 'completed' ? (finishedAt.get(credentialId) ?? null) : null,
      }
    },
    [jobs, starting, finishedAt],
  )

  const current2fa: Current2FA | null = useMemo(() => {
    if (current2faId === null) return null
    const job = jobs.get(current2faId)
    if (!job) return null
    const user = queryClient.getQueryData<UserRead>(authQueryKeys.me)
    const credentialRead = user?.credentials.find((c) => c.id === current2faId)
    return {
      credentialId: current2faId,
      jobId: job.job_id,
      bank: credentialRead?.bank ?? '',
      bankName: credentialRead?.bank_name ?? null,
      bankIcon: credentialRead?.bank_icon ?? null,
      kind:
        job.status === 'awaiting_decoupled_approval'
          ? 'awaiting_decoupled_approval'
          : job.status === 'confirming_2fa'
            ? 'confirming'
            : 'awaiting_2fa',
      authorizationUrl: job.authorization_url ?? null,
      deviceCode: job.device_code ?? null,
    }
  }, [current2faId, jobs, queryClient])

  const submit2fa = useCallback(
    async (code: string) => {
      const activeId = queueRef.current[0]
      if (activeId === undefined) return
      const job = jobsRef.current.get(activeId)
      if (!job) return
      const updated = await api<SyncJob>(`/credentials/${activeId}/sync/${job.job_id}/2fa`, {
        method: 'POST',
        body: { code },
      })
      applyUpdate(updated)
    },
    [applyUpdate],
  )

  const skip2fa = useCallback(() => {
    const activeId = queueRef.current[0]
    if (activeId === undefined) return
    setQueue((prev) => prev.filter((id) => id !== activeId))
    const job = jobsRef.current.get(activeId)
    if (job) {
      void api(`/credentials/${activeId}/sync/${job.job_id}`, { method: 'DELETE' }).catch(() => {})
    }
  }, [])

  return {
    start,
    adopt,
    credential,
    status,
    jobs,
    current2fa,
    submit2fa,
    skip2fa,
    succeededAt,
    failedAt,
  }
}

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
