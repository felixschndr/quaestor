import { useMemo, useState, type FormEvent } from 'react'
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
  useSupportedBanks,
  useSyncCredential,
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
      onConnected={() => router.history.push('/')}
      onSyncFailed={() => router.history.push('/settings/credentials')}
    />
  )
}

export interface NewCredentialFormViewProps {
  bankName: string
  bank: SupportedBank | undefined
  isLoading: boolean
  onCancel: () => void
  /** Called after both create + sync succeed. */
  onConnected: () => void
  /**
   * Called after the create succeeded but the follow-up sync failed. Per the
   * agreed UX, the credential stays in the database and the user gets bounced
   * back to the list (with a toast that tells them what went wrong).
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
          {t('credentials.formTitle', { bank: bankTitle })}
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
  onConnected: () => void
  onSyncFailed: () => void
}) {
  const { t } = useTranslation()
  const create = useCreateCredential()
  const sync = useSyncCredential()
  const confirm2fa = useConfirmTwoFactor()
  const note = t(`banks.${bank.name}.note`, { defaultValue: '' })

  const [pending2fa, setPending2fa] = useState<{ credentialId: number; token: string } | null>(null)
  const [code, setCode] = useState('')

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

  const submitting = create.isPending || sync.isPending

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
      const result = await sync.mutateAsync(createdId)
      if (result.status === '2fa_required') {
        if (!result.challenge_token) {
          toast.error(t('credentials.syncFailed', { bank: bankTitle }))
          onSyncFailed()
          return
        }
        setPending2fa({ credentialId: createdId, token: result.challenge_token })
        return
      }
      onConnected()
    } catch {
      toast.error(t('credentials.syncFailed', { bank: bankTitle }))
      onSyncFailed()
    }
  })

  const onConfirm2fa = async (event: FormEvent) => {
    event.preventDefault()
    if (!pending2fa) return
    try {
      const result = await confirm2fa.mutateAsync({
        credentialId: pending2fa.credentialId,
        challengeToken: pending2fa.token,
        code,
      })
      if (result.status === 'completed') {
        onConnected()
        return
      }
      // The server should not return another 2fa_required here — treat it as
      // an exhausted challenge so the user can restart the sync.
      toast.error(t('credentials.twoFactor.failed'))
      onSyncFailed()
    } catch {
      toast.error(t('credentials.twoFactor.failed'))
      onSyncFailed()
    }
  }

  if (pending2fa) {
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
          className="self-start"
        >
          {confirm2fa.isPending
            ? t('credentials.twoFactor.submitting')
            : t('credentials.twoFactor.submit')}
        </Button>
      </form>
    )
  }

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

      <Button type="submit" disabled={submitting} className="self-start">
        {sync.isPending
          ? t('credentials.syncing')
          : create.isPending
            ? t('credentials.submitting')
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
