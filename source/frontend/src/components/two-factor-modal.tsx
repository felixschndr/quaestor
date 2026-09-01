import { useState, type FormEvent } from 'react'
import { useTranslation } from 'react-i18next'
import { Loader2 } from 'lucide-react'

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { BankLogo } from '@/components/BankLogo'
import { DeviceCodeAuthorization } from '@/components/device-code-authorization'
import type { Current2FA } from '@/lib/auth'
import {
  NO_CODE_PLACEHOLDER,
  deviceCodeFromAuthorizationUrl,
  isNoCodeAuthProvider,
} from '@/lib/credentials'

export interface TwoFactorModalProps {
  current2fa: Current2FA | null
  onSubmit: (code: string) => Promise<void>
  onSkip: () => void
}

export function TwoFactorModal({ current2fa, onSubmit, onSkip }: TwoFactorModalProps) {
  const { t } = useTranslation()
  const [code, setCode] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [activeCredentialId, setActiveCredentialId] = useState<number | null>(null)
  if (activeCredentialId !== (current2fa?.credentialId ?? null)) {
    setActiveCredentialId(current2fa?.credentialId ?? null)
    setCode('')
    setSubmitting(false)
  }
  const open = current2fa !== null

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault()
    if (!current2fa) return
    setSubmitting(true)
    try {
      await onSubmit(code)
      setCode('')
    } finally {
      setSubmitting(false)
    }
  }

  const bankTitle = current2fa
    ? (current2fa.bankName ??
      t(`banks.${current2fa.bank}.title`, { defaultValue: current2fa.bank }))
    : ''
  const noCodeRequired = current2fa !== null && isNoCodeAuthProvider(current2fa.bank)
  const deviceCode =
    current2fa?.deviceCode ?? deviceCodeFromAuthorizationUrl(current2fa?.authorizationUrl)

  const handleNoCodeConfirm = async () => {
    setSubmitting(true)
    try {
      await onSubmit(NO_CODE_PLACEHOLDER)
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={(next) => (next ? null : onSkip())}>
      <DialogContent
        onEscapeKeyDown={(event) => event.preventDefault()}
        onInteractOutside={(event) => event.preventDefault()}
      >
        {current2fa?.kind === 'awaiting_decoupled_approval' || current2fa?.kind === 'confirming' ? (
          <>
            <DialogHeader>
              <BankLogo
                icon={current2fa.bankIcon}
                name={bankTitle}
                seed={current2fa.bankName ?? current2fa.bank}
                className="mx-auto size-12"
              />
              <DialogTitle>
                {current2fa.kind === 'confirming'
                  ? t('common.confirming')
                  : t('sync.twoFactor.decoupledTitle', { bank: bankTitle })}
              </DialogTitle>
              <DialogDescription>
                {current2fa.kind === 'confirming'
                  ? t('sync.twoFactor.confirmingDescription')
                  : t('sync.twoFactor.decoupledDescription', { bank: bankTitle })}
              </DialogDescription>
            </DialogHeader>
            <div className="flex justify-center py-4">
              <Loader2 className="size-6 animate-spin text-primary" aria-hidden="true" />
            </div>
          </>
        ) : current2fa?.kind === 'awaiting_2fa' && noCodeRequired ? (
          <div className="flex flex-col gap-4">
            <DialogHeader>
              <BankLogo
                icon={current2fa.bankIcon}
                name={bankTitle}
                seed={current2fa.bankName ?? current2fa.bank}
                className="mx-auto size-12"
              />
              <DialogTitle>
                {t('sync.twoFactor.authorizeNoCodeTitle', { bank: bankTitle })}
              </DialogTitle>
              <DialogDescription>
                {t('sync.twoFactor.authorizeNoCodeDescription', { bank: bankTitle })}
              </DialogDescription>
            </DialogHeader>
            <DeviceCodeAuthorization
              bankTitle={bankTitle}
              authorizationUrl={current2fa.authorizationUrl}
              deviceCode={deviceCode}
              pending={submitting}
              onConfirm={() => void handleNoCodeConfirm()}
            />
          </div>
        ) : current2fa?.kind === 'awaiting_2fa' ? (
          <form onSubmit={handleSubmit} noValidate className="flex flex-col gap-4">
            <DialogHeader>
              <BankLogo
                icon={current2fa.bankIcon}
                name={bankTitle}
                seed={current2fa.bankName ?? current2fa.bank}
                className="mx-auto size-12"
              />
              <DialogTitle>{t('sync.twoFactor.codeTitle', { bank: bankTitle })}</DialogTitle>
              <DialogDescription>
                {current2fa.authorizationUrl
                  ? t('sync.twoFactor.authorizeDescription', { bank: bankTitle })
                  : t('sync.twoFactor.codeDescription')}
              </DialogDescription>
            </DialogHeader>
            {current2fa.authorizationUrl ? (
              <Button asChild variant="outline">
                <a href={current2fa.authorizationUrl} target="_blank" rel="noopener noreferrer">
                  {t('sync.twoFactor.authorizeLink', { bank: bankTitle })}
                </a>
              </Button>
            ) : null}
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="global-sync-2fa-code">{t('common.code')}</Label>
              <Input
                id="global-sync-2fa-code"
                inputMode={current2fa.authorizationUrl ? 'text' : 'numeric'}
                autoComplete="one-time-code"
                autoFocus
                value={code}
                onChange={(event) => setCode(event.target.value)}
              />
            </div>
            <Button type="submit" pending={submitting} disabled={code.length === 0}>
              {submitting ? t('common.confirming') : t('common.confirm')}
            </Button>
          </form>
        ) : null}
      </DialogContent>
    </Dialog>
  )
}
