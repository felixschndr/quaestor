import { useRef, useState } from 'react'
import { useForm, type UseFormReturn } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { useTranslation } from 'react-i18next'

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
  safeNext,
  useLogin,
  usePasswordRequirements,
  useRegister,
  type PasswordRequirements,
  type Theme,
} from '@/lib/auth'
import { useSupportedCurrencies, useSupportedLanguages } from '@/lib/user'
import { useAppSettings } from '@/lib/settings'
import { useVerifyTwoFactorLogin } from '@/lib/twoFactor'
import { applyTheme, readStoredTheme, THEME_VALUES } from '@/lib/theme'
import { cn } from '@/lib/utils'
import { FieldRow } from '@/components/settings/settings-section'
import { PasswordRequirementsList } from '@/components/password-requirements-list'

type Mode = 'login' | 'register'

export function LoginPageContent({
  next,
  onSuccess,
}: {
  next: string | undefined
  onSuccess: (to: string) => void
}) {
  const { t } = useTranslation()
  const [mode, setMode] = useState<Mode>('login')
  const [inTwoFactorStep, setInTwoFactorStep] = useState(false)
  const { data: settings } = useAppSettings()

  const handleSuccess = () => {
    onSuccess(safeNext(next))
  }

  return (
    <main className="mx-auto flex min-h-full max-w-sm flex-col gap-6 p-6">
      <h1 className="text-foreground text-2xl font-semibold">Quaestor</h1>

      {inTwoFactorStep ? null : (
        <div
          role="tablist"
          aria-label="Authentication mode"
          className="bg-muted flex rounded-md p-1"
        >
          <ModeButton active={mode === 'login'} onClick={() => setMode('login')}>
            {t('login.loginTab')}
          </ModeButton>
          <ModeButton active={mode === 'register'} onClick={() => setMode('register')}>
            {t('login.registerTab')}
          </ModeButton>
        </div>
      )}

      {mode === 'login' ? (
        <LoginForm onSuccess={handleSuccess} onTwoFactorStepChange={setInTwoFactorStep} />
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
  active,
  onClick,
  children,
}: {
  active: boolean
  onClick: () => void
  children: React.ReactNode
}) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={active}
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

export function LoginForm({
  onSuccess,
  onTwoFactorStepChange,
}: {
  onSuccess: () => void
  onTwoFactorStepChange?: (active: boolean) => void
}) {
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
        onTwoFactorStepChange?.(true)
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
        onBack={() => {
          setChallenge(null)
          onTwoFactorStepChange?.(false)
        }}
      />
    )
  }

  return (
    <form onSubmit={onSubmit} noValidate className="flex flex-col gap-4">
      <FieldRow
        id="login-user-name"
        label={t('common.username')}
        autoComplete="username"
        error={form.formState.errors.user_name?.message}
        {...form.register('user_name')}
      />
      <FieldRow
        id="login-password"
        type="password"
        label={t('common.password')}
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
        {t('login.loginTab')}
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

  const submit = async (value: string) => {
    if (verify.isPending) return
    setError(null)
    try {
      await verify.mutateAsync({
        challenge_token: challengeToken,
        code: value.trim(),
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
    <form
      onSubmit={(event) => {
        event.preventDefault()
        void submit(code)
      }}
      noValidate
      className="flex flex-col gap-4"
    >
      <div className="flex flex-col gap-1">
        <h2 className="text-foreground text-lg font-semibold">{t('twoFactor.sectionTitle')}</h2>
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
          onChange={(event) => {
            const next = event.target.value
            setCode(next)
            if (/^\d{6}$/.test(next.trim())) void submit(next)
          }}
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
  enable_two_factor: boolean
  language: string
  currency: string
  theme: Theme
}

const ACCOUNT_FIELDS = ['user_name', 'display_name', 'password', 'password_confirm'] as const

function buildRegisterSchema(
  t: (key: string) => string,
  requirements: PasswordRequirements | undefined,
) {
  return z
    .object({
      user_name: z.string().min(1, { message: t('login.required') }),
      display_name: z.string().min(1, { message: t('login.required') }),
      password: z.string().min(1, { message: t('login.required') }),
      password_confirm: z.string().min(1, { message: t('login.required') }),
      enable_two_factor: z.boolean(),
      language: z.string().min(1),
      currency: z.string().min(1),
      theme: z.enum(THEME_VALUES as readonly [Theme, ...Theme[]]),
    })
    .superRefine((values, ctx) => {
      if (values.password.length === 0) return
      const { unmetRuleNames, tooShort } = evaluatePassword(values.password, requirements)
      if (tooShort || unmetRuleNames.length > 0) {
        ctx.addIssue({
          code: 'custom',
          path: ['password'],
          message: t('common.passwordTooWeak'),
        })
      }
    })
    .refine((values) => values.password === values.password_confirm, {
      path: ['password_confirm'],
      message: t('login.passwordMismatch'),
    })
}

export function RegisterForm({ onSuccess }: { onSuccess: () => void }) {
  const { t, i18n } = useTranslation()
  const register = useRegister()
  const { data: passwordRequirements } = usePasswordRequirements()
  const [setupUserId, setSetupUserId] = useState<number | null>(null)
  const [step, setStep] = useState<'account' | 'appearance'>('account')

  const requirementsRef = useRef(passwordRequirements)
  requirementsRef.current = passwordRequirements

  const form = useForm<RegisterValues>({
    resolver: (values, context, options) =>
      zodResolver(buildRegisterSchema(t, requirementsRef.current))(values, context, options),
    defaultValues: {
      user_name: '',
      display_name: '',
      password: '',
      password_confirm: '',
      enable_two_factor: false,
      language: i18n.language,
      currency: 'EUR',
      theme: readStoredTheme(),
    },
  })

  const goToAppearance = async () => {
    if (await form.trigger(ACCOUNT_FIELDS)) setStep('appearance')
  }

  const onSubmit = form.handleSubmit(async (values) => {
    try {
      const user = await register.mutateAsync({
        user_name: values.user_name,
        display_name: values.display_name,
        password: values.password,
        theme: values.theme,
        language: values.language,
        currency: values.currency,
      })
      if (values.enable_two_factor) {
        setSetupUserId(user.id)
        return
      }
      onSuccess()
    } catch (err) {
      applyServerError(err, form.setError as unknown as SetError, t)
      setStep('account')
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
        <TwoFactorSetup
          userId={setupUserId}
          onFinished={onSuccess}
          onCancel={onSuccess}
          cancelLabel={t('twoFactor.skipSetup')}
        />
      </div>
    )
  }

  return (
    <form onSubmit={onSubmit} noValidate className="flex flex-col gap-4">
      {step === 'account' ? (
        <>
          <FieldRow
            id="register-user-name"
            label={t('common.username')}
            autoComplete="username"
            error={form.formState.errors.user_name?.message}
            {...form.register('user_name')}
          />
          <FieldRow
            id="register-display-name"
            label={t('common.displayName')}
            autoComplete="name"
            error={form.formState.errors.display_name?.message}
            {...form.register('display_name')}
          />
          <FieldRow
            id="register-password"
            type="password"
            label={t('common.password')}
            autoComplete="new-password"
            error={form.formState.errors.password?.message}
            {...form.register('password')}
          />
          <PasswordRequirementsList password={password} requirements={passwordRequirements} />
          <FieldRow
            id="register-password-confirm"
            type="password"
            label={t('login.passwordConfirm')}
            autoComplete="new-password"
            error={form.formState.errors.password_confirm?.message}
            {...form.register('password_confirm')}
          />

          <label className="border-border bg-card flex cursor-pointer items-center justify-between gap-3 rounded-md border p-3">
            <span className="flex flex-col">
              <span className="text-sm font-medium">{t('twoFactor.enable')}</span>
              <span className="text-muted-foreground text-xs">{t('twoFactor.enableHint')}</span>
            </span>
            <Switch
              checked={form.watch('enable_two_factor')}
              onCheckedChange={(checked) => form.setValue('enable_two_factor', checked === true)}
              aria-label={t('twoFactor.enable')}
            />
          </label>

          {topLevelError ? <FormErrorBanner message={topLevelError} /> : null}

          <Button type="button" onClick={() => void goToAppearance()}>
            {t('common.continue')}
          </Button>
        </>
      ) : (
        <>
          <h2 className="text-foreground text-lg font-semibold">{t('settings.appearance')}</h2>

          <RegisterLanguageField form={form} />
          <RegisterCurrencyField form={form} />

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="register-theme">{t('settings.theme')}</Label>
            <SingleSelectPopover
              id="register-theme"
              ariaLabel={t('settings.theme')}
              value={form.watch('theme')}
              onChange={(next) => {
                form.setValue('theme', next)
                applyTheme(next)
              }}
              options={THEME_VALUES.map((value) => ({
                value,
                label: t(`settings.theme${value.charAt(0)}${value.slice(1).toLowerCase()}`),
              }))}
            />
          </div>

          {topLevelError ? <FormErrorBanner message={topLevelError} /> : null}

          <div className="flex gap-2">
            <Button
              type="button"
              variant="outline"
              className="flex-1"
              onClick={() => setStep('account')}
              disabled={register.isPending}
            >
              {t('common.back')}
            </Button>
            <Button type="submit" className="flex-1" disabled={register.isPending}>
              {t('login.submitRegister')}
            </Button>
          </div>
        </>
      )}
    </form>
  )
}

function RegisterLanguageField({ form }: { form: UseFormReturn<RegisterValues> }) {
  const { t, i18n } = useTranslation()
  const { data: languages } = useSupportedLanguages()
  const options = (languages?.languages ?? [form.watch('language')])
    .map((code) => ({ value: code, label: t(`languages.${code}`, { defaultValue: code }) }))
    .sort((a, b) => a.label.localeCompare(b.label, i18n.language))

  return (
    <div className="flex flex-col gap-1.5">
      <Label htmlFor="register-language">{t('settings.language')}</Label>
      <SingleSelectPopover
        id="register-language"
        ariaLabel={t('settings.language')}
        value={form.watch('language')}
        disabled={!languages}
        onChange={(next) => form.setValue('language', next)}
        options={options}
      />
    </div>
  )
}

function RegisterCurrencyField({ form }: { form: UseFormReturn<RegisterValues> }) {
  const { t } = useTranslation()
  const { data: currencies } = useSupportedCurrencies()
  const options = (currencies?.currencies ?? [form.watch('currency')]).map((code) => ({
    value: code,
    label: t(`currencies.${code}`, { defaultValue: code }),
  }))

  return (
    <div className="flex flex-col gap-1.5">
      <Label htmlFor="register-currency">{t('settings.currency')}</Label>
      <SingleSelectPopover
        id="register-currency"
        ariaLabel={t('settings.currency')}
        value={form.watch('currency')}
        disabled={!currencies}
        onChange={(next) => form.setValue('currency', next)}
        options={options}
      />
    </div>
  )
}

function FormErrorBanner({ message }: { message: string }) {
  return (
    <p role="alert" className="bg-destructive/10 text-destructive rounded-md px-3 py-2 text-sm">
      {message}
    </p>
  )
}

type SetError = (name: string, error: { type: string; message: string }) => void

function applyServerError(err: unknown, setError: SetError, t: (key: string) => string) {
  if (!(err instanceof ApiError)) return
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
