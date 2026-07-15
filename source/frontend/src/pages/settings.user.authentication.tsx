import { useState } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { useTranslation } from 'react-i18next'
import { Check, X } from 'lucide-react'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import { FieldRow, Section, SettingsSubPage } from '@/components/settings/settings-section'
import { readApiErrorMessage } from '@/lib/apiError'
import { ApiError } from '@/lib/api'
import {
  evaluatePassword,
  usePasswordRequirements,
  type PasswordRequirements,
  type UserRead,
} from '@/lib/auth'
import { useUpdateUser } from '@/lib/user'
import { useDisableTwoFactor, useRegenerateBackupCodes } from '@/lib/twoFactor'
import { TwoFactorSetup } from '@/components/two-factor-setup'
import { BackupCodes } from '@/components/backup-codes'
import { cn } from '@/lib/utils'

export function SettingsAuthenticationView({ user }: { user: UserRead }) {
  const { t } = useTranslation()
  return (
    <SettingsSubPage title={t('settings.authentication')}>
      <PasswordSection user={user} />
      <TwoFactorSection user={user} />
    </SettingsSubPage>
  )
}

interface PasswordValues {
  current_password: string
  new_password: string
  password_confirm: string
}

function PasswordSection({ user }: { user: UserRead }) {
  const { t } = useTranslation()
  const update = useUpdateUser(user.id)
  const { data: passwordRequirements } = usePasswordRequirements()

  const form = useForm<PasswordValues>({
    resolver: zodResolver(
      z
        .object({
          current_password: z.string().min(1, { message: t('login.required') }),
          new_password: z.string().min(1, { message: t('login.required') }),
          password_confirm: z.string().min(1, { message: t('login.required') }),
        })
        .refine((values) => values.new_password === values.password_confirm, {
          path: ['password_confirm'],
          message: t('login.passwordMismatch'),
        }),
    ),
    defaultValues: { current_password: '', new_password: '', password_confirm: '' },
  })

  const newPassword = form.watch('new_password')

  const onSubmit = form.handleSubmit(async (values) => {
    // Block submit client-side when the new password fails the live rules, so
    // we never surface the backend's untranslated Pydantic 422 message
    // ("String should have at least 15 characters") in the UI.
    if (passwordRequirements) {
      const { unmetRuleNames, tooShort } = evaluatePassword(
        values.new_password,
        passwordRequirements,
      )
      if (tooShort || unmetRuleNames.length > 0) {
        form.setError('new_password', {
          type: 'validate',
          message: t('settings.passwordTooWeak'),
        })
        return
      }
    }
    try {
      await update.mutateAsync({
        current_password: values.current_password,
        new_password: values.new_password,
      })
      form.reset({ current_password: '', new_password: '', password_confirm: '' })
      toast.success(t('settings.passwordChanged'), { description: t('sessions.revokedAll') })
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) {
        form.setError('current_password', {
          type: 'server',
          message: t('settings.wrongCurrentPassword'),
        })
        return
      }
      // 422 from the server only fires if the user raced the requirements
      // query (or the rules drifted). Pin the inline error to the password
      // field with a translated message instead of leaking Pydantic's English.
      if (err instanceof ApiError && err.status === 422) {
        form.setError('new_password', {
          type: 'server',
          message: t('settings.passwordTooWeak'),
        })
        return
      }
      toast.error(readApiErrorMessage(err, t))
    }
  })

  return (
    <Section title={t('common.password')}>
      <PasswordRequirementsList password={newPassword} requirements={passwordRequirements} />
      <form onSubmit={onSubmit} noValidate className="flex flex-col gap-3">
        <FieldRow
          id={`current-password-${user.id}`}
          label={t('settings.currentPassword')}
          type="password"
          autoComplete="current-password"
          error={form.formState.errors.current_password?.message}
          {...form.register('current_password')}
        />
        <FieldRow
          id={`new-password-${user.id}`}
          label={t('settings.newPassword')}
          type="password"
          autoComplete="new-password"
          error={form.formState.errors.new_password?.message}
          {...form.register('new_password')}
        />
        <FieldRow
          id={`confirm-password-${user.id}`}
          label={t('login.passwordConfirm')}
          type="password"
          autoComplete="new-password"
          error={form.formState.errors.password_confirm?.message}
          {...form.register('password_confirm')}
        />
        <Button type="submit" disabled={update.isPending} className="w-full">
          {t('settings.changePassword')}
        </Button>
      </form>
    </Section>
  )
}

function PasswordRequirementsList({
  password,
  requirements,
}: {
  password: string
  requirements: PasswordRequirements | undefined
}) {
  const { t } = useTranslation()
  if (!requirements) return null
  const { unmetRuleNames, tooShort } = evaluatePassword(password, requirements)
  const items: { key: string; ok: boolean; label: string }[] = [
    {
      key: 'min_length',
      ok: !tooShort,
      label: t('login.passwordRuleMinLength', { count: requirements.min_length }),
    },
    ...requirements.rules.map((rule) => ({
      key: rule.name,
      ok: !unmetRuleNames.includes(rule.name),
      label: t(`login.passwordRule.${rule.name}`, { defaultValue: rule.description }),
    })),
  ]
  // Empty password ⇒ render the rules as plain expectations (no green/red), so
  // the section reads as "here is what's required" rather than "you failed
  // these checks". Once the user types, the live success ticks kick in.
  const showStatus = password.length > 0
  return (
    <div className="flex flex-col gap-1.5 text-xs">
      <p className="text-muted-foreground">{t('login.passwordRules')}</p>
      <ul aria-label={t('login.passwordRules')} className="flex flex-col gap-1">
        {items.map((item) => (
          <li
            key={item.key}
            className={cn(
              'flex items-center gap-1.5',
              showStatus && item.ok ? 'text-success' : 'text-muted-foreground',
            )}
          >
            {showStatus ? (
              item.ok ? (
                <Check className="size-3.5" />
              ) : (
                <X className="size-3.5" />
              )
            ) : (
              <span aria-hidden="true" className="size-3.5 text-center leading-none">
                •
              </span>
            )}
            {item.label}
          </li>
        ))}
      </ul>
    </div>
  )
}

function TwoFactorSection({ user }: { user: UserRead }) {
  const { t } = useTranslation()
  const [mode, setMode] = useState<'idle' | 'enabling' | 'disabling'>('idle')
  const regenerate = useRegenerateBackupCodes(user.id)
  const [regeneratedCodes, setRegeneratedCodes] = useState<string[] | null>(null)

  const handleRegenerate = async () => {
    try {
      const result = await regenerate.mutateAsync()
      setRegeneratedCodes(result.backup_codes)
    } catch (err) {
      toast.error(readApiErrorMessage(err, t))
    }
  }

  function renderBody() {
    if (mode === 'enabling') {
      return (
        <TwoFactorSetup
          userId={user.id}
          onFinished={() => setMode('idle')}
          onCancel={() => setMode('idle')}
        />
      )
    }
    if (mode === 'disabling') {
      return <DisableTwoFactorForm user={user} onDone={() => setMode('idle')} />
    }
    if (regeneratedCodes) {
      return <BackupCodes codes={regeneratedCodes} onDone={() => setRegeneratedCodes(null)} />
    }
    if (!user.two_factor_enabled) {
      return (
        <div className="flex flex-col gap-3">
          <p className="text-muted-foreground text-sm">{t('twoFactor.statusDisabled')}</p>
          <Button type="button" onClick={() => setMode('enabling')} className="w-full">
            {t('twoFactor.enable')}
          </Button>
        </div>
      )
    }
    return (
      <div className="flex flex-col gap-3">
        <p className="text-success flex items-center gap-1.5 text-sm font-medium">
          <Check className="size-4" />
          {t('twoFactor.statusEnabled')}
        </p>
        <div className="flex flex-wrap gap-2">
          <Button
            type="button"
            variant="outline"
            onClick={handleRegenerate}
            disabled={regenerate.isPending}
            className="grow basis-40"
          >
            {t('twoFactor.regenerate')}
          </Button>
          <Button
            type="button"
            variant="destructive"
            onClick={() => setMode('disabling')}
            className="grow basis-40"
          >
            {t('twoFactor.disable')}
          </Button>
        </div>
      </div>
    )
  }

  return (
    <Section title={t('twoFactor.sectionTitle')} description={t('twoFactor.sectionDescription')}>
      {renderBody()}
    </Section>
  )
}

function DisableTwoFactorForm({ user, onDone }: { user: UserRead; onDone: () => void }) {
  const { t } = useTranslation()
  const disable = useDisableTwoFactor(user.id)
  const [code, setCode] = useState('')
  const [error, setError] = useState<string | null>(null)

  const onSubmit = async (event: React.FormEvent) => {
    event.preventDefault()
    setError(null)
    try {
      await disable.mutateAsync(code.trim())
      toast.success(t('twoFactor.disabledToast'))
      onDone()
    } catch (err) {
      if (err instanceof ApiError && (err.status === 422 || err.status === 401)) {
        setError(t('twoFactor.invalidCode'))
        return
      }
      toast.error(readApiErrorMessage(err, t))
    }
  }

  return (
    <form onSubmit={onSubmit} noValidate className="flex flex-col gap-3">
      <p className="text-muted-foreground text-sm">{t('twoFactor.disableHint')}</p>
      <FieldRow
        id={`disable-2fa-code-${user.id}`}
        label={t('twoFactor.codeLabel')}
        inputMode="numeric"
        autoComplete="one-time-code"
        value={code}
        onChange={(event) => setCode(event.target.value)}
        error={error ?? undefined}
      />
      <div className="flex flex-col gap-2">
        <Button
          type="submit"
          variant="destructive"
          disabled={disable.isPending || code.trim().length === 0}
          className="w-full"
        >
          {t('twoFactor.confirmDisable')}
        </Button>
        <Button
          type="button"
          variant="outline"
          onClick={onDone}
          disabled={disable.isPending}
          className="w-full"
        >
          {t('common.cancel')}
        </Button>
      </div>
    </form>
  )
}
