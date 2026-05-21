import { forwardRef, useState } from 'react'
import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { useTranslation } from 'react-i18next'
import { Check, X } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Checkbox } from '@/components/ui/checkbox'
import { ApiError } from '@/lib/api'
import {
  evaluatePassword,
  useLogin,
  usePasswordRequirements,
  useRegister,
  useRegistrationAllowed,
  type PasswordRequirements,
} from '@/lib/auth'
import { cn } from '@/lib/utils'

const loginSearchSchema = z.object({
  next: z.string().optional(),
})

export const Route = createFileRoute('/login')({
  component: LoginPage,
  validateSearch: (search) => loginSearchSchema.parse(search),
})

type Mode = 'login' | 'register'

function LoginPage() {
  const { next } = Route.useSearch()
  const navigate = useNavigate()
  return <LoginPageContent next={next} onSuccess={(to) => navigate({ to })} />
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
  const { data: registrationAllowed } = useRegistrationAllowed()

  const handleSuccess = () => {
    onSuccess(next ?? '/')
  }

  return (
    <main className="mx-auto flex min-h-full max-w-sm flex-col gap-6 p-6">
      <h1 className="text-foreground text-2xl font-semibold">Finanzguru Clone</h1>

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
      ) : registrationAllowed?.allowed === false ? (
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
        'flex-1 rounded-sm px-3 py-1.5 text-sm font-medium transition-colors',
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

export function LoginForm({ onSuccess }: { onSuccess: () => void }) {
  const { t } = useTranslation()
  const login = useLogin()

  const form = useForm<LoginValues>({
    resolver: zodResolver(buildLoginSchema(t)),
    defaultValues: { user_name: '', password: '', remember_me: false },
  })

  const onSubmit = form.handleSubmit(async (values) => {
    try {
      await login.mutateAsync(values)
      onSuccess()
    } catch (err) {
      applyServerError(err, form.setError as unknown as SetError, t)
    }
  })

  const topLevelError = readTopLevelError(login.error, t)

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

      <label className="flex items-center gap-2 text-sm">
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

interface RegisterValues {
  user_name: string
  display_name: string
  password: string
  password_confirm: string
}

function buildRegisterSchema(t: (key: string) => string) {
  return z
    .object({
      user_name: z.string().min(1, { message: t('login.required') }),
      display_name: z.string().min(1, { message: t('login.required') }),
      password: z.string().min(1, { message: t('login.required') }),
      password_confirm: z.string().min(1, { message: t('login.required') }),
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

  const form = useForm<RegisterValues>({
    resolver: zodResolver(buildRegisterSchema(t)),
    defaultValues: { user_name: '', display_name: '', password: '', password_confirm: '' },
  })

  const onSubmit = form.handleSubmit(async (values) => {
    try {
      await register.mutateAsync({
        user_name: values.user_name,
        display_name: values.display_name,
        password: values.password,
      })
      onSuccess()
    } catch (err) {
      applyServerError(err, form.setError as unknown as SetError, t)
    }
  })

  const topLevelError = readTopLevelError(register.error, t)
  const password = form.watch('password')

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
