import { forwardRef, useState } from 'react'
import { createFileRoute, useRouter } from '@tanstack/react-router'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { useTranslation } from 'react-i18next'
import { Check, X } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Checkbox } from '@/components/ui/checkbox'
import { Switch } from '@/components/ui/switch'
import { SingleSelectPopover } from '@/components/ui/single-select-popover'
import { TwoFactorSetup } from '@/components/two-factor-setup'
import { ApiError } from '@/lib/api'
import {
  evaluatePassword,
  redirectIfAuthenticated,
  safeNext,
  useLogin,
  usePasswordRequirements,
  useRegister,
  type PasswordRequirements,
  type Theme,
} from '@/lib/auth'
import { useAppSettings } from '@/lib/settings'
import { useVerifyTwoFactorLogin } from '@/lib/twoFactor'
import { applyTheme, readStoredTheme, THEME_VALUES } from '@/lib/theme'
import { cn } from '@/lib/utils'

const loginSearchSchema = z.object({
  next: z.string().optional(),
})

export const Route = createFileRoute('/login')({
  component: LoginPage,
  validateSearch: (search) => loginSearchSchema.parse(search),
  beforeLoad: async ({ context, search }) => {
    await redirectIfAuthenticated({ queryClient: context.queryClient, next: search.next })
  },
})

type Mode = 'login' | 'register'

function LoginPage() {
  const { next } = Route.useSearch()
  const router = useRouter()
  return (
    <LoginPageContent
      next={next}
      // history.push accepts arbitrary in-app paths (e.g. /account/42/transactions/7)
      // that the typed navigate() API can't represent generically.
      onSuccess={(to) => router.history.push(to)}
    />
  )
}

export function LoginPageContent({
  next,
  onSuccess,
}: {
  next: string | undefined
  onSuccess: (to: string) => void
}) {
  const { t } = useTranslation()
  const [mode, setMode] = useState<Mode>('login')
  const { data: settings } = useAppSettings()

  const handleSuccess = () => {
    onSuccess(safeNext(next))
  }

  return (
    <main className="mx-auto flex min-h-full max-w-sm flex-col gap-6 p-6">
      <h1 className="text-foreground text-2xl font-semibold">Quaestor</h1>

      <div role="tablist" aria-label="Authentication mode" className="bg-muted flex rounded-md p-1">
        <ModeButton mode="login" active={mode === 'login'} onClick={() => setMode('login')}>
          {t('login.loginTab')}
        </ModeButton>
        <ModeButton
          mode="register"
          active={mode === 'register'}
          onClick={() => setMode('register')}
        >
          {t('login.registerTab')}
        </ModeButton>
      </div>

      {mode === 'login' ? (
        <LoginForm onSuccess={handleSuccess} />
      ) : settings?.allow_new_user_registration === false ? (
        <p role="status" className="text-muted-foreground text-sm">
          {t('login.registrationDisabled')}
        </p>
      ) : (
        <RegisterForm onSuccess={handleSuccess} />
      )}
    </main>
  )
}

function ModeButton({
  mode,
  active,
  onClick,
  children,
}: {
  mode: Mode
  active: boolean
  onClick: () => void
  children: React.ReactNode
}) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={active}
      data-mode={mode}
      onClick={onClick}
      className={cn(
        'flex-1 cursor-pointer rounded-sm px-3 py-1.5 text-sm font-medium transition-colors',
        active
          ? 'bg-background text-foreground shadow-sm'
          : 'text-muted-foreground hover:text-foreground',
      )}
    >
      {children}
    </button>
  )
}

interface LoginValues {
  user_name: string
  password: string
  remember_me: boolean
}

function buildLoginSchema(t: (key: string) => string) {
  return z.object({
    user_name: z.string().min(1, { message: t('login.required') }),
    password: z.string().min(1, { message: t('login.required') }),
    remember_me: z.boolean(),
  })
}

interface PendingChallenge {
  challengeToken: string
  rememberMe: boolean
}

export function LoginForm({ onSuccess }: { onSuccess: () => void }) {
  const { t } = useTranslation()
  const login = useLogin()
  const [challenge, setChallenge] = useState<PendingChallenge | null>(null)

  const form = useForm<LoginValues>({
    resolver: zodResolver(buildLoginSchema(t)),
    defaultValues: { user_name: '', password: '', remember_me: false },
  })

  const onSubmit = form.handleSubmit(async (values) => {
    try {
      const result = await login.mutateAsync(values)
      if (result.kind === 'two_factor_required') {
        setChallenge({ challengeToken: result.challenge_token, rememberMe: values.remember_me })
        return
      }
      onSuccess()
    } catch (err) {
      applyServerError(err, form.setError as unknown as SetError, t)
    }
  })

  const topLevelError = readTopLevelError(login.error, t)

  if (challenge) {
    return (
      <TwoFactorLoginStep
        challengeToken={challenge.challengeToken}
        rememberMe={challenge.rememberMe}
        onSuccess={onSuccess}
        onBack={() => setChallenge(null)}
      />
    )
  }

  return (
    <form onSubmit={onSubmit} noValidate className="flex flex-col gap-4">
      <Field
        id="login-user-name"
        label={t('login.username')}
        autoComplete="username"
        error={form.formState.errors.user_name?.message}
        {...form.register('user_name')}
      />
      <Field
        id="login-password"
        type="password"
        label={t('login.password')}
        autoComplete="current-password"
        error={form.formState.errors.password?.message}
        {...form.register('password')}
      />

      <label className="flex cursor-pointer items-center gap-2 text-sm">
        <Checkbox
          checked={form.watch('remember_me')}
          onCheckedChange={(checked) => form.setValue('remember_me', checked === true)}
        />
        <span>{t('login.rememberMe')}</span>
      </label>

      {topLevelError ? <FormErrorBanner message={topLevelError} /> : null}

      <Button type="submit" disabled={login.isPending}>
        {t('login.submitLogin')}
      </Button>
    </form>
  )
}

function TwoFactorLoginStep({
  challengeToken,
  rememberMe,
  onSuccess,
  onBack,
}: {
  challengeToken: string
  rememberMe: boolean
  onSuccess: () => void
  onBack: () => void
}) {
  const { t } = useTranslation()
  const verify = useVerifyTwoFactorLogin()
  const [code, setCode] = useState('')
  const [error, setError] = useState<string | null>(null)

  const onSubmit = async (event: React.FormEvent) => {
    event.preventDefault()
    setError(null)
    try {
      await verify.mutateAsync({
        challenge_token: challengeToken,
        code: code.trim(),
        remember_me: rememberMe,
      })
      onSuccess()
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) {
        setError(t('twoFactor.invalidCode'))
        return
      }
      if (err instanceof ApiError && err.status === 429) {
        setError(t('login.rateLimited'))
        return
      }
      setError(t('login.genericError'))
    }
  }

  return (
    <form onSubmit={onSubmit} noValidate className="flex flex-col gap-4">
      <div className="flex flex-col gap-1">
        <h2 className="text-foreground text-lg font-semibold">{t('twoFactor.loginTitle')}</h2>
        <p className="text-muted-foreground text-sm">{t('twoFactor.loginHint')}</p>
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="login-2fa-code">{t('twoFactor.codeLabel')}</Label>
        <Input
          id="login-2fa-code"
          inputMode="numeric"
          autoComplete="one-time-code"
          autoFocus
          value={code}
          onChange={(event) => setCode(event.target.value)}
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? 'login-2fa-code-error' : undefined}
        />
        {error ? (
          <p id="login-2fa-code-error" role="alert" className="text-destructive text-xs">
            {error}
          </p>
        ) : null}
      </div>
      <p className="text-muted-foreground text-xs">{t('twoFactor.backupLoginHint')}</p>
      <Button type="submit" disabled={verify.isPending || code.trim().length === 0}>
        {t('twoFactor.verifyLogin')}
      </Button>
      <Button type="button" variant="outline" onClick={onBack} disabled={verify.isPending}>
        {t('common.cancel')}
      </Button>
    </form>
  )
}

interface RegisterValues {
  user_name: string
  display_name: string
  password: string
  password_confirm: string
  theme: Theme
  enable_two_factor: boolean
}

function buildRegisterSchema(t: (key: string) => string) {
  return z
    .object({
      user_name: z.string().min(1, { message: t('login.required') }),
      display_name: z.string().min(1, { message: t('login.required') }),
      password: z.string().min(1, { message: t('login.required') }),
      password_confirm: z.string().min(1, { message: t('login.required') }),
      theme: z.enum(THEME_VALUES as readonly [Theme, ...Theme[]]),
      enable_two_factor: z.boolean(),
    })
    .refine((values) => values.password === values.password_confirm, {
      path: ['password_confirm'],
      message: t('login.passwordMismatch'),
    })
}

export function RegisterForm({ onSuccess }: { onSuccess: () => void }) {
  const { t } = useTranslation()
  const register = useRegister()
  const { data: passwordRequirements } = usePasswordRequirements()
  const [setupUserId, setSetupUserId] = useState<number | null>(null)

  const form = useForm<RegisterValues>({
    resolver: zodResolver(buildRegisterSchema(t)),
    defaultValues: {
      user_name: '',
      display_name: '',
      password: '',
      password_confirm: '',
      // Pre-fill with whatever the user already picked pre-login (or SYSTEM
      // for a first-time visitor); the select reflects this default.
      theme: readStoredTheme(),
      enable_two_factor: false,
    },
  })

  const onSubmit = form.handleSubmit(async (values) => {
    try {
      const user = await register.mutateAsync({
        user_name: values.user_name,
        display_name: values.display_name,
        password: values.password,
        theme: values.theme,
      })
      if (values.enable_two_factor) {
        setSetupUserId(user.id)
        return
      }
      onSuccess()
    } catch (err) {
      applyServerError(err, form.setError as unknown as SetError, t)
    }
  })

  const topLevelError = readTopLevelError(register.error, t)
  const password = form.watch('password')

  if (setupUserId !== null) {
    return (
      <div className="flex flex-col gap-4">
        <div className="flex flex-col gap-1">
          <h2 className="text-foreground text-lg font-semibold">{t('twoFactor.setupTitle')}</h2>
        </div>
        {/* No cancel here: the account already exists; finishing (or skipping via "done"
            after enabling) is the only forward path. */}
        <TwoFactorSetup userId={setupUserId} onFinished={onSuccess} />
      </div>
    )
  }

  return (
    <form onSubmit={onSubmit} noValidate className="flex flex-col gap-4">
      <Field
        id="register-user-name"
        label={t('login.username')}
        autoComplete="username"
        error={form.formState.errors.user_name?.message}
        {...form.register('user_name')}
      />
      <Field
        id="register-display-name"
        label={t('login.displayName')}
        autoComplete="name"
        error={form.formState.errors.display_name?.message}
        {...form.register('display_name')}
      />
      <Field
        id="register-password"
        type="password"
        label={t('login.password')}
        autoComplete="new-password"
        error={form.formState.errors.password?.message}
        {...form.register('password')}
      />
      <PasswordRequirementsList password={password} requirements={passwordRequirements} />
      <Field
        id="register-password-confirm"
        type="password"
        label={t('login.passwordConfirm')}
        autoComplete="new-password"
        error={form.formState.errors.password_confirm?.message}
        {...form.register('password_confirm')}
      />

      <div className="flex flex-col gap-1.5">
        <Label htmlFor="register-theme">{t('login.theme')}</Label>
        <SingleSelectPopover
          id="register-theme"
          ariaLabel={t('login.theme')}
          value={form.watch('theme')}
          onChange={(next) => {
            form.setValue('theme', next)
            // Live preview: applies to the whole page immediately so the user
            // sees what they're picking before they submit.
            applyTheme(next)
          }}
          options={THEME_VALUES.map((value) => ({
            value,
            label: t(`settings.theme${value.charAt(0)}${value.slice(1).toLowerCase()}`),
          }))}
        />
      </div>

      <label className="border-border bg-card flex cursor-pointer items-center justify-between gap-3 rounded-md border p-3">
        <span className="flex flex-col">
          <span className="text-sm font-medium">{t('twoFactor.enableLabel')}</span>
          <span className="text-muted-foreground text-xs">{t('twoFactor.enableHint')}</span>
        </span>
        <Switch
          checked={form.watch('enable_two_factor')}
          onCheckedChange={(checked) => form.setValue('enable_two_factor', checked === true)}
          aria-label={t('twoFactor.enableLabel')}
        />
      </label>

      {topLevelError ? <FormErrorBanner message={topLevelError} /> : null}

      <Button type="submit" disabled={register.isPending}>
        {t('login.submitRegister')}
      </Button>
    </form>
  )
}

interface FieldProps extends React.InputHTMLAttributes<HTMLInputElement> {
  id: string
  label: string
  error?: string
}

const Field = forwardRef<HTMLInputElement, FieldProps>(({ id, label, error, ...rest }, ref) => (
  <div className="flex flex-col gap-1.5">
    <Label htmlFor={id}>{label}</Label>
    <Input
      id={id}
      ref={ref}
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
))
Field.displayName = 'Field'

function FormErrorBanner({ message }: { message: string }) {
  return (
    <p role="alert" className="bg-destructive/10 text-destructive rounded-md px-3 py-2 text-sm">
      {message}
    </p>
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
      // Use the backend description as fallback so a new rule we haven't translated
      // yet still renders something useful in the UI.
      label: t(`login.passwordRule.${rule.name}`, { defaultValue: rule.description }),
    })),
  ]
  return (
    <ul aria-label={t('login.passwordRules')} className="flex flex-col gap-1 text-xs">
      {items.map((item) => (
        <li
          key={item.key}
          className={cn(
            'flex items-center gap-1.5',
            item.ok ? 'text-success' : 'text-muted-foreground',
          )}
        >
          {item.ok ? <Check className="size-3.5" /> : <X className="size-3.5" />}
          {item.label}
        </li>
      ))}
    </ul>
  )
}

type SetError = (name: string, error: { type: string; message: string }) => void

function applyServerError(err: unknown, setError: SetError, t: (key: string) => string) {
  if (!(err instanceof ApiError)) return
  // 401 (invalid credentials) is surfaced via the top-level banner — we can't
  // safely blame a specific field because the backend doesn't tell which one
  // is wrong.
  if (err.status === 409) {
    setError('user_name', { type: 'server', message: t('login.userNameTaken') })
    return
  }
  if (err.status === 422 && err.body && typeof err.body === 'object') {
    const detail = (err.body as { detail?: unknown }).detail
    if (Array.isArray(detail)) {
      for (const item of detail) {
        if (item && typeof item === 'object' && 'loc' in item && 'msg' in item) {
          const loc = (item as { loc: unknown[] }).loc
          const msg = String((item as { msg: unknown }).msg)
          const field = loc[loc.length - 1]
          if (typeof field === 'string') setError(field, { type: 'server', message: msg })
        }
      }
      return
    }
    if (typeof detail === 'string') {
      setError('password', { type: 'server', message: detail })
      return
    }
  }
}

function readTopLevelError(err: unknown, t: (key: string) => string): string | null {
  if (!(err instanceof ApiError)) return null
  if (err.status === 401) return t('login.invalidCredentials')
  if (err.status === 409) return null // surfaced inline on user_name
  if (err.status === 422) return null // surfaced inline per field
  if (err.status === 429) return t('login.rateLimited')
  if (err.status === 403 && err.body && typeof err.body === 'object') {
    const detail = (err.body as { detail?: unknown }).detail
    if (typeof detail === 'string') return detail
  }
  return t('login.genericError')
}
