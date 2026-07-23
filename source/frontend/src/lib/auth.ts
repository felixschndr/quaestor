import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useMutation, useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query'
import { redirect } from '@tanstack/react-router'
import { api, ApiError } from './api'
import type { SyncJob, SyncJobStatus } from './credentials'
import { syncJobWebSocketUrl } from './syncSocket'

export interface AccountRead {
  id: number
  name: string
  display_name: string | null
  balance: number
  balance_factor: number
  is_hidden: boolean
}

export interface CredentialRead {
  id: number
  bank: string
  bank_name: string | null
  bank_icon: string | null
  accounts: AccountRead[]
  last_fetching_timestamp: string | null
  requires_two_factor_authentication: boolean
  sync_enabled: boolean
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
  balance: number
  credentials: CredentialRead[]
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
  try {
    await args.queryClient.ensureQueryData(meQueryOptions)
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
  kind: 'awaiting_2fa' | 'awaiting_decoupled_approval'
  authorizationUrl?: string | null
}

export interface UseGlobalSyncResult {
  start: () => void
  status: GlobalSyncStatus
  jobs: Map<number, SyncJob>
  current2fa: Current2FA | null
  submit2fa: (code: string) => Promise<void>
  skip2fa: () => void
  succeededAt: number | null
  failedAt: number | null
}

const TWO_FACTOR_STATUSES = new Set<SyncJobStatus>(['awaiting_2fa', 'awaiting_decoupled_approval'])
const TERMINAL_STATUSES = new Set<SyncJobStatus>(['completed', 'failed'])

type GlobalSyncPhase = 'idle' | 'starting' | 'active' | 'done' | 'finishing'

function useSyncMachine(startJobs: () => Promise<SyncJob[]>, invalidateAccounts: boolean = false) {
  const queryClient = useQueryClient()
  const [phase, setPhase] = useState<GlobalSyncPhase>('idle')
  const [jobs, setJobs] = useState<Map<number, SyncJob>>(new Map())
  // `queue[0]` is the credential currently prompting the user for 2FA, the
  // remaining entries are queued. Shifted by submit2fa/skip2fa, appended by
  // the WebSocket message handler.
  const [queue, setQueue] = useState<number[]>([])
  const [succeededAt, setSucceededAt] = useState<number | null>(null)
  const [failedAt, setFailedAt] = useState<number | null>(null)
  const queueRef = useRef<number[]>(queue)
  useEffect(() => {
    queueRef.current = queue
  }, [queue])
  const jobsRef = useRef<Map<number, SyncJob>>(jobs)
  useEffect(() => {
    jobsRef.current = jobs
  }, [jobs])

  const current2faId = queue[0] ?? null

  const allJobsTerminal = useMemo(
    () => jobs.size > 0 && Array.from(jobs.values()).every((j) => TERMINAL_STATUSES.has(j.status)),
    [jobs],
  )

  const credentialDisplay = useCallback(
    (credentialId: number) => {
      const user = queryClient.getQueryData<UserRead>(authQueryKeys.me)
      const credential = user?.credentials.find((c) => c.id === credentialId)
      return {
        bank: credential?.bank ?? '',
        bankName: credential?.bank_name ?? null,
        bankIcon: credential?.bank_icon ?? null,
      }
    },
    [queryClient],
  )

  const phaseRef = useRef<GlobalSyncPhase>(phase)
  useEffect(() => {
    phaseRef.current = phase
  }, [phase])

  const start = useCallback(() => {
    if (phaseRef.current === 'starting' || phaseRef.current === 'active') return
    phaseRef.current = 'starting'
    setPhase('starting')
    setJobs(new Map())
    setQueue([])
    setSucceededAt(null)
    setFailedAt(null)
    void (async () => {
      try {
        const started = await startJobs()
        if (started.length === 0) {
          setPhase('finishing')
          return
        }
        const initial = new Map<number, SyncJob>()
        for (const job of started) initial.set(job.credential_id, job)
        setJobs(initial)
        setPhase('active')
      } catch {
        setPhase('finishing')
      }
    })()
  }, [startJobs])

  const jobKeys = useMemo(() => Array.from(jobs.keys()).sort().join(','), [jobs])
  useEffect(() => {
    if (jobs.size === 0) return
    const sockets: WebSocket[] = []
    for (const [credentialId, job] of jobs) {
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
          if (!queueRef.current.includes(update.credential_id)) {
            setQueue((prev) => [...prev, update.credential_id])
          }
        } else if (queueRef.current.includes(update.credential_id)) {
          setQueue((prev) => prev.filter((id) => id !== update.credential_id))
        }
      }
      sockets.push(socket)
    }
    return () => {
      for (const socket of sockets) socket.close()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [jobKeys])

  useEffect(() => {
    if (phase !== 'active') return
    if (!allJobsTerminal || queue.length > 0) return
    phaseRef.current = 'done'
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setPhase('done')
    const reportable = Array.from(jobs.values()).filter((j) => j.error_code !== 'cancelled')
    if (reportable.length > 0) {
      if (reportable.every((j) => j.status === 'completed')) {
        setSucceededAt(Date.now())
      } else {
        setFailedAt(Date.now())
      }
    }
    queryClient.invalidateQueries({ queryKey: authQueryKeys.me })
    if (invalidateAccounts) {
      queryClient.invalidateQueries({ queryKey: ['account'] })
    }
  }, [phase, allJobsTerminal, queue.length, jobs, queryClient, invalidateAccounts])

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
      ...credentialDisplay(current2faId),
      kind:
        job.status === 'awaiting_decoupled_approval'
          ? 'awaiting_decoupled_approval'
          : 'awaiting_2fa',
      authorizationUrl: job.authorization_url ?? null,
    }
  }, [current2faId, jobs, credentialDisplay])

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
      setQueue((prev) => prev.filter((id) => id !== activeId))
    },
    [queue, jobs],
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

  return { start, status, jobs, current2fa, submit2fa, skip2fa, succeededAt, failedAt }
}

export function useGlobalSync(): UseGlobalSyncResult {
  const startJobs = useCallback(() => api<SyncJob[]>('/users/sync', { method: 'POST' }), [])
  return useSyncMachine(startJobs)
}

export type CredentialSyncStatus = GlobalSyncStatus
export type UseCredentialSyncResult = UseGlobalSyncResult

export function useCredentialSync(credentialId: number): UseCredentialSyncResult {
  const startJobs = useCallback(
    async () => [await api<SyncJob>(`/credentials/${credentialId}/sync`, { method: 'POST' })],
    [credentialId],
  )
  return useSyncMachine(startJobs, true)
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
