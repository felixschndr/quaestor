import { useEffect, useState, type FormEvent } from 'react'
import { useTranslation } from 'react-i18next'
import { Loader2 } from 'lucide-react'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { CopyButton } from '@/components/copy-button'
import { ApiError } from '@/lib/api'
import {
  useEnableTwoFactor,
  useStartTwoFactorSetup,
  type TwoFactorSetup as Setup,
} from '@/lib/twoFactor'
import { BackupCodes } from '@/components/backup-codes'

export interface TwoFactorSetupProps {
  userId: number
  onFinished: () => void
  onCancel?: () => void
  cancelLabel?: string
}

export function TwoFactorSetup({ userId, onFinished, onCancel, cancelLabel }: TwoFactorSetupProps) {
  const { t } = useTranslation()
  const start = useStartTwoFactorSetup(userId)
  const enable = useEnableTwoFactor(userId)
  const [setup, setSetup] = useState<Setup | null>(null)
  const [code, setCode] = useState('')
  const [codeError, setCodeError] = useState<string | null>(null)
  const [backupCodes, setBackupCodes] = useState<string[] | null>(null)

  const startMutate = start.mutateAsync
  useEffect(() => {
    let active = true
    startMutate()
      .then((result) => {
        if (active) setSetup(result)
      })
      .catch(() => {
        // Surfaced via start.isError below.
      })
    return () => {
      active = false
    }
  }, [startMutate])

  if (backupCodes) {
    return <BackupCodes codes={backupCodes} onDone={onFinished} />
  }

  if (start.isError) {
    return (
      <div className="flex flex-col gap-3">
        <p role="alert" className="text-destructive text-sm">
          {t('twoFactor.setupFailed')}
        </p>
        {onCancel ? (
          <Button type="button" variant="outline" onClick={onCancel} className="self-start">
            {cancelLabel ?? t('common.cancel')}
          </Button>
        ) : null}
      </div>
    )
  }

  if (!setup) {
    return (
      <div className="flex justify-center py-6">
        <Loader2 className="text-primary size-6 animate-spin" aria-hidden="true" />
      </div>
    )
  }

  const onSubmit = async (event: FormEvent) => {
    event.preventDefault()
    setCodeError(null)
    try {
      const result = await enable.mutateAsync(code.trim())
      toast.success(t('twoFactor.enabledToast'), { description: t('sessions.revokedAll') })
      setBackupCodes(result.backup_codes)
    } catch (err) {
      if (err instanceof ApiError && (err.status === 422 || err.status === 401)) {
        setCodeError(t('twoFactor.invalidCode'))
        return
      }
      setCodeError(t('login.genericError'))
    }
  }

  return (
    <form onSubmit={onSubmit} noValidate className="flex flex-col gap-4">
      <p className="text-muted-foreground text-sm">{t('twoFactor.scanHint')}</p>

      <img
        src={setup.qr_code}
        alt={t('twoFactor.qrAlt')}
        className="border-border mx-auto size-44 rounded-md border bg-white p-2"
      />

      <div className="flex flex-col gap-1.5">
        <Label htmlFor="two-factor-secret">{t('twoFactor.secretLabel')}</Label>
        <div className="flex items-center gap-2">
          <code
            id="two-factor-secret"
            className="border-border bg-muted/40 flex-1 rounded-md border px-2.5 py-1.5 font-mono text-sm break-all"
          >
            {setup.secret}
          </code>
          <CopyButton
            value={setup.secret}
            label={t('twoFactor.copySecret')}
            className="text-muted-foreground -m-0.5 shrink-0 p-1.5"
          />
        </div>
      </div>

      <div className="flex flex-col gap-1.5">
        <Label htmlFor="two-factor-enable-code">{t('twoFactor.codeLabel')}</Label>
        <Input
          id="two-factor-enable-code"
          inputMode="numeric"
          autoComplete="one-time-code"
          maxLength={6}
          autoFocus
          value={code}
          onChange={(event) => setCode(event.target.value)}
          aria-invalid={codeError ? true : undefined}
          aria-describedby={codeError ? 'two-factor-enable-code-error' : undefined}
        />
        {codeError ? (
          <p id="two-factor-enable-code-error" role="alert" className="text-destructive text-xs">
            {codeError}
          </p>
        ) : null}
      </div>

      <div className="flex flex-col gap-2">
        <Button
          type="submit"
          disabled={enable.isPending || code.trim().length === 0}
          className="w-full"
        >
          {t('twoFactor.verifyAndEnable')}
        </Button>
        {onCancel ? (
          <Button
            type="button"
            variant="outline"
            onClick={onCancel}
            disabled={enable.isPending}
            className="w-full"
          >
            {cancelLabel ?? t('common.cancel')}
          </Button>
        ) : null}
      </div>
    </form>
  )
}
