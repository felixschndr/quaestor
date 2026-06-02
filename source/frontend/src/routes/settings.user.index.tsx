import { useEffect, useState } from 'react'
import { Link, createFileRoute, useRouter } from '@tanstack/react-router'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { useTranslation } from 'react-i18next'
import { Check, ChevronLeft, X } from 'lucide-react'
import { toast } from 'sonner'
import i18n from 'i18next'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { ApiError } from '@/lib/api'
import {
  evaluatePassword,
  useAuthMe,
  usePasswordRequirements,
  type PasswordRequirements,
  type Theme,
  type UserRead,
} from '@/lib/auth'
import { useDeleteUser, useSupportedLanguages, useUpdateUser } from '@/lib/user'
import { useDisableTwoFactor, useRegenerateBackupCodes } from '@/lib/twoFactor'
import { TwoFactorSetup } from '@/components/two-factor-setup'
import { BackupCodes } from '@/components/backup-codes'
import { applyTheme, THEME_VALUES } from '@/lib/theme'
import { cn } from '@/lib/utils'

export const Route = createFileRoute('/settings/user/')({
  component: SettingsUserPage,
})

function SettingsUserPage() {
  const router = useRouter()
  const { data: user } = useAuthMe()
  if (!user) return null // root guard already redirected on 401

  return (
    <SettingsUserPageContent user={user} onAccountDeleted={() => router.history.push('/login')} />
  )
}

export interface SettingsUserPageContentProps {
  user: UserRead
  onAccountDeleted: () => void
}

export function SettingsUserPageContent({ user, onAccountDeleted }: SettingsUserPageContentProps) {
  const { t } = useTranslation()
  return (
    <main className="mx-auto flex min-h-full max-w-2xl flex-col gap-8 p-4">
      <header className="flex items-center gap-2">
        <BackLink />
        <h1 className="text-foreground text-2xl font-semibold">{t('settings.user')}</h1>
      </header>

      <LanguageSection user={user} />
      <ThemeSection user={user} />
      <UserNameSection user={user} />
      <DisplayNameSection user={user} />
      <PasswordSection user={user} />
      <TwoFactorSection user={user} />
      <DangerZone user={user} onAccountDeleted={onAccountDeleted} />
    </main>
  )
}

function BackLink() {
  const { t } = useTranslation()
  return (
    <Link
      to="/settings"
      aria-label={t('settings.back')}
      className="text-primary hover:text-primary/80 -ml-1.5 rounded-md p-1.5 transition-colors"
    >
      <ChevronLeft className="size-5" />
    </Link>
  )
}

function Section({
  title,
  description,
  children,
}: {
  title: string
  description?: string
  children: React.ReactNode
}) {
  return (
    <section className="border-border bg-card flex flex-col gap-4 rounded-lg border p-4">
      <div className="flex flex-col gap-1">
        <h2 className="text-foreground text-lg font-semibold">{title}</h2>
        {description ? <p className="text-muted-foreground text-sm">{description}</p> : null}
      </div>
      {children}
    </section>
  )
}

interface UserNameValues {
  user_name: string
}

function UserNameSection({ user }: { user: UserRead }) {
  const { t } = useTranslation()
  const update = useUpdateUser(user.id)
  const form = useForm<UserNameValues>({
    resolver: zodResolver(
      z.object({
        user_name: z.string().min(1, { message: t('login.required') }),
      }),
    ),
    defaultValues: { user_name: user.user_name },
  })

  useEffect(() => {
    form.reset({ user_name: user.user_name })
  }, [user.user_name, form])

  const onSubmit = form.handleSubmit(async (values) => {
    const normalized = values.user_name.trim().toLowerCase()
    if (normalized === user.user_name) return
    try {
      await update.mutateAsync({ user_name: normalized })
      toast.success(t('settings.userSaved'))
    } catch (err) {
      if (err instanceof ApiError && err.status === 409) {
        form.setError('user_name', { type: 'server', message: t('login.userNameTaken') })
        return
      }
      toast.error(readApiErrorMessage(err, t))
    }
  })

  const dirty = form.watch('user_name').trim().toLowerCase() !== user.user_name

  return (
    <Section title={t('settings.userName')}>
      <form onSubmit={onSubmit} noValidate className="flex flex-col gap-3">
        <FieldRow
          id="user-name"
          label={t('settings.userName')}
          hideLabel
          autoComplete="username"
          error={form.formState.errors.user_name?.message}
          {...form.register('user_name')}
        />
        <Button type="submit" disabled={!dirty || update.isPending} className="w-full">
          {t('common.save')}
        </Button>
      </form>
    </Section>
  )
}

interface DisplayNameValues {
  display_name: string
}

function DisplayNameSection({ user }: { user: UserRead }) {
  const { t } = useTranslation()
  const update = useUpdateUser(user.id)
  const form = useForm<DisplayNameValues>({
    resolver: zodResolver(
      z.object({
        display_name: z.string().min(1, { message: t('login.required') }),
      }),
    ),
    defaultValues: { display_name: user.display_name },
  })

  // Re-sync the field if the user changes elsewhere (e.g. after a refetch).
  useEffect(() => {
    form.reset({ display_name: user.display_name })
  }, [user.display_name, form])

  const onSubmit = form.handleSubmit(async (values) => {
    if (values.display_name === user.display_name) return
    try {
      await update.mutateAsync({ display_name: values.display_name })
      toast.success(t('settings.userSaved'))
    } catch (err) {
      toast.error(readApiErrorMessage(err, t))
    }
  })

  const dirty = form.watch('display_name') !== user.display_name

  return (
    <Section title={t('settings.displayName')}>
      <form onSubmit={onSubmit} noValidate className="flex flex-col gap-3">
        <FieldRow
          id="display-name"
          label={t('settings.displayName')}
          hideLabel
          autoComplete="name"
          error={form.formState.errors.display_name?.message}
          {...form.register('display_name')}
        />
        <Button type="submit" disabled={!dirty || update.isPending} className="w-full">
          {t('common.save')}
        </Button>
      </form>
    </Section>
  )
}

function LanguageSection({ user }: { user: UserRead }) {
  const { t, i18n: i18next } = useTranslation()
  const { data: languages } = useSupportedLanguages()
  const update = useUpdateUser(user.id)
  const [pending, setPending] = useState(false)

  const change = async (next: string) => {
    if (next === user.language) return
    setPending(true)
    try {
      await update.mutateAsync({ language: next })
      // Switch i18next immediately so the rest of the UI re-renders without a reload.
      await i18n.changeLanguage(next)
      toast.success(t('settings.userSaved'))
    } catch (err) {
      toast.error(readApiErrorMessage(err, t))
    } finally {
      setPending(false)
    }
  }

  // Sort alphabetically by the localised label in the user's current UI
  // language, so the order matches what they actually read on screen.
  const sortedLanguages = [...(languages?.languages ?? [user.language])]
    .map((code) => ({ code, label: t(`languages.${code}`, { defaultValue: code }) }))
    .sort((a, b) => a.label.localeCompare(b.label, i18next.language))

  return (
    <Section title={t('settings.language')}>
      <div className="flex flex-col gap-2">
        <select
          id="language-select"
          aria-label={t('settings.language')}
          value={user.language}
          disabled={pending || !languages}
          onChange={(event) => void change(event.target.value)}
          className="border-input focus-visible:border-ring focus-visible:ring-ring/50 h-8 w-full rounded-lg border bg-transparent px-2.5 text-sm outline-none transition-colors focus-visible:ring-3 disabled:opacity-50 dark:bg-input/30"
        >
          {sortedLanguages.map(({ code, label }) => (
            <option key={code} value={code}>
              {label}
            </option>
          ))}
        </select>
      </div>
    </Section>
  )
}

function ThemeSection({ user }: { user: UserRead }) {
  const { t } = useTranslation()
  const update = useUpdateUser(user.id)
  const [pending, setPending] = useState(false)

  const change = async (next: Theme) => {
    if (next === user.theme) return

    applyTheme(next)
    setPending(true)
    try {
      await update.mutateAsync({ theme: next })
      toast.success(t('settings.userSaved'))
    } catch (err) {
      applyTheme(user.theme)
      toast.error(readApiErrorMessage(err, t))
    } finally {
      setPending(false)
    }
  }

  return (
    <Section title={t('settings.theme')}>
      <div className="flex flex-col gap-2">
        <select
          id="theme-select"
          aria-label={t('settings.theme')}
          value={user.theme}
          disabled={pending}
          onChange={(event) => void change(event.target.value as Theme)}
          className="border-input focus-visible:border-ring focus-visible:ring-ring/50 h-8 w-full rounded-lg border bg-transparent px-2.5 text-sm outline-none transition-colors focus-visible:ring-3 disabled:opacity-50 dark:bg-input/30"
        >
          {THEME_VALUES.map((value) => (
            <option key={value} value={value}>
              {t(`settings.theme${value.charAt(0)}${value.slice(1).toLowerCase()}`)}
            </option>
          ))}
        </select>
      </div>
    </Section>
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
    <Section title={t('settings.password')}>
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

function DangerZone({ user, onAccountDeleted }: { user: UserRead; onAccountDeleted: () => void }) {
  const { t } = useTranslation()
  const remove = useDeleteUser(user.id)
  const [confirming, setConfirming] = useState(false)

  const onConfirm = async () => {
    try {
      await remove.mutateAsync()
      onAccountDeleted()
    } catch (err) {
      toast.error(readApiErrorMessage(err, t))
      setConfirming(false)
    }
  }

  if (!confirming) {
    return (
      <Section title={t('settings.dangerZone')} description={t('settings.deleteDescription')}>
        <Button
          type="button"
          variant="destructive"
          onClick={() => setConfirming(true)}
          className="w-full"
        >
          {t('settings.deleteAccount')}
        </Button>
      </Section>
    )
  }

  return (
    <Section title={t('settings.dangerZone')} description={t('settings.deleteConfirm')}>
      <div className="flex flex-col gap-2">
        <Button
          type="button"
          variant="destructive"
          onClick={onConfirm}
          disabled={remove.isPending}
          className="w-full"
        >
          {t('settings.deleteAccountConfirm')}
        </Button>
        <Button
          type="button"
          variant="outline"
          onClick={() => setConfirming(false)}
          disabled={remove.isPending}
          className="w-full"
        >
          {t('common.cancel')}
        </Button>
      </div>
    </Section>
  )
}

interface FieldRowProps extends React.ComponentProps<'input'> {
  id: string
  label: string
  error?: string
  hideLabel?: boolean
}

const FieldRow = ({ id, label, error, hideLabel, ...rest }: FieldRowProps) => (
  <div className="flex flex-col gap-1.5">
    {hideLabel ? null : <Label htmlFor={id}>{label}</Label>}
    <Input
      id={id}
      aria-label={hideLabel ? label : undefined}
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

function readApiErrorMessage(err: unknown, t: (key: string) => string): string {
  if (err instanceof ApiError) {
    if (err.status === 422 && err.body && typeof err.body === 'object') {
      const detail = (err.body as { detail?: unknown }).detail
      if (Array.isArray(detail) && detail.length > 0) {
        const first = detail[0]
        if (first && typeof first === 'object' && 'msg' in first) {
          return String((first as { msg: unknown }).msg)
        }
      }
      if (typeof detail === 'string') return detail
    }
    if (err.status === 429) return t('login.rateLimited')
  }
  return t('login.genericError')
}
