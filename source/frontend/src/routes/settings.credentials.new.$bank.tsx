import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react'
import { Link, createFileRoute, useRouter } from '@tanstack/react-router'
import { useTranslation } from 'react-i18next'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { ChevronLeft } from 'lucide-react'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { ApiError } from '@/lib/api'
import {
  useConfirmTwoFactor,
  useCreateCredential,
  useDeleteCredential,
  useStartSync,
  useSupportedBanks,
  useSyncJob,
  type SupportedBank,
} from '@/lib/credentials'

export const Route = createFileRoute('/settings/credentials/new/$bank')({
  component: NewCredentialFormPage,
})

function NewCredentialFormPage() {
  const { bank: bankName } = Route.useParams()
  const banks = useSupportedBanks()
  const router = useRouter()
  const matched = banks.data?.find((b) => b.name === bankName)

  return (
    <NewCredentialFormView
      bankName={bankName}
      bank={matched}
      isLoading={banks.isLoading}
      onCancel={() => router.history.push('/settings/credentials')}
      // Manual credentials land empty (no accounts yet) and need a follow-up
      // visit to /settings/credentials/<id> to add accounts. Synced credentials
      // already have accounts after sync, so jump straight to the overview.
      onConnected={(credentialId) =>
        router.history.push(bankName === 'manual' ? `/settings/credentials/${credentialId}` : '/')
      }
      onSyncFailed={() => router.history.push('/settings/credentials')}
    />
  )
}

export interface NewCredentialFormViewProps {
  bankName: string
  bank: SupportedBank | undefined
  isLoading: boolean
  onCancel: () => void
  /** Called after both create + sync succeed. Receives the new credential id
   *  so the caller can route to a credential-specific page (manual creds need
   *  to land on their detail view to add accounts). */
  onConnected: (credentialId: number) => void
  /**
   * Called after the create succeeded but the follow-up sync failed; bounces the
   * user back to the list with an explanatory toast. A transient failure keeps the
   * credential (so it can be retried); an invalid-credentials failure deletes it
   * first (a wrong login can never sync), handled before this is called.
   */
  onSyncFailed: () => void
}

export function NewCredentialFormView({
  bankName,
  bank,
  isLoading,
  onCancel,
  onConnected,
  onSyncFailed,
}: NewCredentialFormViewProps) {
  const { t } = useTranslation()
  const bankTitle = t(`banks.${bankName}.title`, { defaultValue: bankName })

  return (
    <main className="mx-auto flex min-h-full max-w-2xl flex-col gap-6 p-4">
      <header className="flex items-center gap-2">
        <BackLink />
        <h1 className="text-foreground text-2xl font-semibold">
          {bankName === 'manual'
            ? t('credentials.formTitleManual')
            : t('credentials.formTitle', { bank: bankTitle })}
        </h1>
      </header>

      {isLoading ? (
        <p className="text-muted-foreground text-sm">{t('common.loading')}</p>
      ) : !bank ? (
        // Unknown / removed bank in the URL — bounce the user back to the picker.
        <UnknownBankFallback onCancel={onCancel} />
      ) : (
        <CredentialForm
          bank={bank}
          bankTitle={bankTitle}
          onConnected={onConnected}
          onSyncFailed={onSyncFailed}
        />
      )}
    </main>
  )
}

function UnknownBankFallback({ onCancel }: { onCancel: () => void }) {
  const { t } = useTranslation()
  return (
    <div className="flex flex-col gap-3">
      <p className="text-muted-foreground text-sm">{t('credentials.pickerEmpty')}</p>
      <Button type="button" variant="outline" onClick={onCancel} className="self-start">
        {t('credentials.back')}
      </Button>
    </div>
  )
}

function CredentialForm({
  bank,
  bankTitle,
  onConnected,
  onSyncFailed,
}: {
  bank: SupportedBank
  bankTitle: string
  onConnected: (credentialId: number) => void
  onSyncFailed: () => void
}) {
  const { t } = useTranslation()
  const create = useCreateCredential()
  const startSync = useStartSync()
  const confirm2fa = useConfirmTwoFactor()
  // mutate is referentially stable (React Query), so it's safe in effect deps.
  const { mutate: deleteCredential } = useDeleteCredential()
  const note = t(`banks.${bank.name}.note`, { defaultValue: '' })

  const [activeJob, setActiveJob] = useState<{ credentialId: number; jobId: string } | null>(null)
  const [code, setCode] = useState('')
  const { job } = useSyncJob(activeJob?.credentialId ?? null, activeJob?.jobId ?? null)
  // Track which job's terminal state we've already acted on, keyed by job_id, so a retry
  // (a fresh job) is handled again while we never act on the same job twice.
  const handledJobId = useRef<string | null>(null)

  useEffect(() => {
    if (!job || handledJobId.current === job.job_id) return
    if (job.status === 'completed') {
      handledJobId.current = job.job_id
      if (activeJob) onConnected(activeJob.credentialId)
    } else if (job.status === 'failed') {
      handledJobId.current = job.job_id
      if (job.error_code === 'invalid_credentials') {
        // Wrong login → the credential we just created can never sync, so delete it. We
        // stay on the form (a failed job already re-enables it) so the user can fix the
        // credentials and try again — the next attempt is a new job, handled afresh.
        if (activeJob) deleteCredential(activeJob.credentialId)
        toast.error(t('credentials.invalidCredentials', { bank: bankTitle }))
      } else {
        // A transient failure (e.g. bank unreachable) — keep the credential and bounce
        // back to the list so the user can retry the sync later.
        toast.error(t('credentials.syncFailed', { bank: bankTitle }))
        onSyncFailed()
      }
    }
  }, [job, activeJob, onConnected, onSyncFailed, deleteCredential, t, bankTitle])

  const schema = useMemo(() => {
    const shape: Record<string, z.ZodString> = {}
    for (const field of bank.required_fields) {
      shape[field] = z.string().min(1, { message: t('login.required') })
    }
    return z.object(shape)
  }, [bank.required_fields, t])

  type FormValues = Record<string, string>
  const form = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: Object.fromEntries(bank.required_fields.map((field) => [field, ''])),
  })

  const onSubmit = form.handleSubmit(async (values) => {
    let createdId: number
    try {
      const created = await create.mutateAsync({ bank: bank.name, credentials: values })
      createdId = created.id
    } catch (err) {
      handleCreateError(err, form.setError, t, bankTitle)
      return
    }

    try {
      const started = await startSync.mutateAsync(createdId)
      setActiveJob({ credentialId: createdId, jobId: started.job_id })
    } catch {
      toast.error(t('credentials.syncFailed', { bank: bankTitle }))
      onSyncFailed()
    }
  })

  const onConfirm2fa = async (event: FormEvent) => {
    event.preventDefault()
    if (!activeJob) return
    try {
      await confirm2fa.mutateAsync({
        credentialId: activeJob.credentialId,
        jobId: activeJob.jobId,
        code,
      })
      // Wait for the WebSocket to push the terminal state (handled in the effect above).
    } catch {
      toast.error(t('credentials.twoFactor.failed'))
      onSyncFailed()
    }
  }

  const showCodeForm = job?.status === 'awaiting_2fa'
  const showDecoupledApproval = job?.status === 'awaiting_decoupled_approval'
  const isSyncing =
    activeJob !== null &&
    (job === null || job.status === 'running' || job.status === 'awaiting_decoupled_approval')

  if (showDecoupledApproval) {
    return (
      <div role="status" aria-live="polite" className="flex flex-col gap-2">
        <p className="text-foreground text-sm font-medium">
          {t('credentials.decoupledApproval.title')}
        </p>
        <p className="text-muted-foreground text-sm">
          {t('credentials.decoupledApproval.description')}
        </p>
      </div>
    )
  }

  if (showCodeForm) {
    return (
      <form onSubmit={onConfirm2fa} noValidate className="flex flex-col gap-4">
        <p className="text-muted-foreground text-sm">{t('credentials.twoFactor.description')}</p>
        <FieldRow
          id="credential-2fa-code"
          label={t('credentials.twoFactor.codeLabel')}
          inputMode="numeric"
          autoComplete="one-time-code"
          autoFocus
          value={code}
          onChange={(event) => setCode(event.target.value)}
        />
        <Button
          type="submit"
          disabled={confirm2fa.isPending || code.length === 0}
          className="w-full"
        >
          {confirm2fa.isPending
            ? t('credentials.twoFactor.submitting')
            : t('credentials.twoFactor.submit')}
        </Button>
      </form>
    )
  }

  const submitting = create.isPending || startSync.isPending || isSyncing

  return (
    <form onSubmit={onSubmit} noValidate className="flex flex-col gap-4">
      {note ? <p className="text-muted-foreground text-sm">{note}</p> : null}
      {bank.required_fields.map((field) => (
        <FieldRow
          key={field}
          id={`credential-${bank.name}-${field}`}
          label={t(`banks.field.${field}`, { defaultValue: field })}
          type={maskedField(field) ? 'password' : 'text'}
          autoComplete={autoCompleteFor(field)}
          error={form.formState.errors[field]?.message as string | undefined}
          {...form.register(field)}
        />
      ))}

      <Button type="submit" disabled={submitting} className="w-full">
        {isSyncing
          ? t('credentials.syncing')
          : create.isPending || startSync.isPending
            ? t('credentials.submitting')
            : bank.name === 'manual'
              ? t('credentials.submitManual')
              : t('credentials.submit')}
      </Button>
    </form>
  )
}

function maskedField(field: string): boolean {
  // Any field whose name conventionally holds a secret gets a password input
  // so the value is masked and never offered for browser autofill suggestions.
  const lowered = field.toLowerCase()
  return (
    lowered.includes('password') ||
    lowered.includes('passwort') ||
    lowered.includes('pin') ||
    lowered.includes('secret')
  )
}

function autoCompleteFor(field: string): string {
  if (field === 'username') return 'username'
  if (maskedField(field)) return 'current-password'
  return 'off'
}

function handleCreateError(
  err: unknown,
  setError: (field: string, error: { type: string; message: string }) => void,
  t: (key: string, opts?: Record<string, unknown>) => string,
  bankTitle: string,
) {
  if (err instanceof ApiError && err.status === 409) {
    toast.error(t('credentials.alreadyExists', { bank: bankTitle }))
    return
  }
  if (err instanceof ApiError && err.status === 422 && err.body && typeof err.body === 'object') {
    const detail = (err.body as { detail?: unknown }).detail
    if (Array.isArray(detail)) {
      for (const item of detail) {
        if (item && typeof item === 'object' && 'loc' in item && 'msg' in item) {
          const loc = (item as { loc: unknown[] }).loc
          const fieldName = loc[loc.length - 1]
          if (typeof fieldName === 'string') {
            setError(fieldName, {
              type: 'server',
              message: String((item as { msg: unknown }).msg),
            })
          }
        }
      }
      return
    }
  }
  toast.error(t('credentials.connectFailed', { bank: bankTitle }))
}

interface FieldRowProps extends React.ComponentProps<'input'> {
  id: string
  label: string
  error?: string
}

const FieldRow = ({ id, label, error, ...rest }: FieldRowProps) => (
  <div className="flex flex-col gap-1.5">
    <Label htmlFor={id}>{label}</Label>
    <Input
      id={id}
      aria-invalid={error ? true : undefined}
      aria-describedby={error ? `${id}-error` : undefined}
      {...rest}
    />
    {error ? (
      <p id={`${id}-error`} role="alert" className="text-destructive text-xs">
        {error}
      </p>
    ) : null}
  </div>
)

function BackLink() {
  const { t } = useTranslation()
  return (
    <Link
      to="/settings/credentials/new"
      aria-label={t('credentials.back')}
      className="text-primary hover:text-primary/80 -ml-1.5 rounded-md p-1.5 transition-colors"
    >
      <ChevronLeft className="size-5" />
    </Link>
  )
}
