import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react'
import { Link } from '@tanstack/react-router'
import { useTranslation } from 'react-i18next'
import { useForm, type Resolver } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { ChevronLeft } from 'lucide-react'
import { toast } from 'sonner'
import type { TFunction } from 'i18next'

import { Button } from '@/components/ui/button'
import { FieldRow } from '@/components/settings/settings-section'
import { ApiError } from '@/lib/api'
import { ibanToBlz } from '@/lib/bankIdentity'
import {
  useConfirmTwoFactor,
  useCreateCredential,
  useDeleteCredential,
  useStartSync,
  useSyncJob,
  type CredentialFieldSpec,
  type SupportedBank,
} from '@/lib/credentials'

export interface NewCredentialFormViewProps {
  bankKey: string
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
  bankKey,
  bank,
  isLoading,
  onCancel,
  onConnected,
  onSyncFailed,
}: NewCredentialFormViewProps) {
  const { t } = useTranslation()
  // Special providers keep their curated i18n title; grouped FinTS banks use their catalog name.
  const bankTitle = bank
    ? displayName(t, bank)
    : t(`banks.${bankKey}.title`, { defaultValue: bankKey })

  return (
    <main className="mx-auto flex min-h-full max-w-3xl flex-col gap-6 p-4">
      <header className="flex items-center gap-2">
        <BackLink />
        <h1 className="text-foreground text-2xl font-semibold">
          {bankKey === 'manual'
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
  const note = t(`banks.${bank.provider}.note`, { defaultValue: '' })
  const needsIban = bank.provider === 'fints' && bank.blzs.length > 1

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
    const shape: Record<string, z.ZodType<string>> = {}
    for (const field of bank.required_fields) {
      const base = z.string().min(1, { message: t('login.required') })
      const spec = bank.field_rules?.[field]
      shape[field] = spec
        ? base.superRefine((value, ctx) => {
            const candidate = spec.strip_whitespace ? value.replace(/\s/g, '') : value
            for (const rule of spec.rules) {
              if (!new RegExp(rule.regex).test(candidate)) {
                ctx.addIssue({
                  code: 'custom',
                  message: t(`credentials.fieldRule.${rule.name}`, {
                    defaultValue: rule.description,
                  }),
                })
              }
            }
          })
        : base
    }
    if (needsIban) {
      // The IBAN is never sent to the backend; we only use it to derive the branch BLZ
      shape.iban = z.string().superRefine((value, ctx) => {
        const blz = ibanToBlz(value)
        if (blz === null || !bank.blzs.includes(blz)) {
          ctx.addIssue({ code: 'custom', message: t('credentials.ibanMismatch') })
        }
      })
    }
    return z.object(shape)
  }, [bank.required_fields, bank.field_rules, bank.blzs, needsIban, t])

  type FormValues = Record<string, string>
  const form = useForm<FormValues>({
    resolver: zodResolver(schema) as Resolver<FormValues>,
    defaultValues: Object.fromEntries(
      [...bank.required_fields, ...(needsIban ? ['iban'] : [])].map((field) => [field, '']),
    ),
  })

  const onSubmit = form.handleSubmit(async (values) => {
    let createdId: number
    const declared = Object.fromEntries(bank.required_fields.map((field) => [field, values[field]]))
    const credentials = stripCredentialWhitespace(declared, bank.field_rules)
    let submitProvider = bank.provider
    if (bank.provider === 'fints') {
      credentials.blz = bank.blzs.length > 1 ? ibanToBlz(values.iban)! : bank.blzs[0]
      submitProvider = 'fints'
    }
    try {
      const created = await create.mutateAsync({ bank: submitProvider, credentials })
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
          id={`credential-${bank.key}-${field}`}
          label={t(`banks.field.${field}`, { defaultValue: field })}
          type={maskedField(field) ? 'password' : 'text'}
          autoComplete={autoCompleteFor(field)}
          error={form.formState.errors[field]?.message as string | undefined}
          {...form.register(field)}
        />
      ))}
      {needsIban ? (
        <FieldRow
          id={`credential-${bank.key}-iban`}
          label={t('credentials.ibanLabel')}
          autoComplete="off"
          error={form.formState.errors.iban?.message as string | undefined}
          {...form.register('iban')}
        />
      ) : null}

      <Button type="submit" disabled={submitting} className="w-full">
        {isSyncing
          ? t('credentials.syncing')
          : create.isPending || startSync.isPending
            ? t('credentials.submitting')
            : bank.provider === 'manual'
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

function stripCredentialWhitespace(
  values: Record<string, string>,
  fieldRules: Record<string, CredentialFieldSpec> | undefined,
): Record<string, string> {
  if (!fieldRules) return values
  const result = { ...values }
  for (const [field, spec] of Object.entries(fieldRules)) {
    if (spec.strip_whitespace && field in result) {
      result[field] = result[field].replace(/\s/g, '')
    }
  }
  return result
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

function displayName(t: TFunction, bank: SupportedBank): string {
  return bank.provider === bank.key
    ? t(`banks.${bank.provider}.title`, { defaultValue: bank.name })
    : bank.name
}

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
