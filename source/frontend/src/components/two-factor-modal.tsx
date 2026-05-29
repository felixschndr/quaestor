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
import { bankIconUrl } from '@/lib/accounts'
import type { Current2FA } from '@/lib/auth'

export interface TwoFactorModalProps {
  current2fa: Current2FA | null
  onSubmit: (code: string) => Promise<void>
  onSkip: () => void
}

export function TwoFactorModal({ current2fa, onSubmit, onSkip }: TwoFactorModalProps) {
  const { t } = useTranslation()
  const [code, setCode] = useState('')
  const [submitting, setSubmitting] = useState(false)
  // Track the credential the input belongs to so a queue advance (credA → credB
  // without passing through null) doesn't leak credA's typed code into credB's
  // form. The setState-during-render pattern is the React-recommended way to
  // adjust state on prop changes — no useEffect flicker.
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
    ? t(`banks.${current2fa.bank}.title`, { defaultValue: current2fa.bank })
    : ''

  return (
    <Dialog open={open} onOpenChange={(next) => (next ? null : onSkip())}>
      <DialogContent>
        {current2fa?.kind === 'awaiting_decoupled_approval' ? (
          <>
            <DialogHeader>
              <BankIcon bank={current2fa.bank} />
              <DialogTitle>{t('sync.twoFactor.decoupledTitle', { bank: bankTitle })}</DialogTitle>
              <DialogDescription>
                {t('sync.twoFactor.decoupledDescription', { bank: bankTitle })}
              </DialogDescription>
            </DialogHeader>
            <div className="flex justify-center py-4">
              <Loader2 className="size-6 animate-spin text-primary" aria-hidden="true" />
            </div>
          </>
        ) : current2fa?.kind === 'awaiting_2fa' ? (
          <form onSubmit={handleSubmit} noValidate className="flex flex-col gap-4">
            <DialogHeader>
              <BankIcon bank={current2fa.bank} />
              <DialogTitle>{t('sync.twoFactor.codeTitle', { bank: bankTitle })}</DialogTitle>
              <DialogDescription>{t('sync.twoFactor.codeDescription')}</DialogDescription>
            </DialogHeader>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="global-sync-2fa-code">{t('sync.twoFactor.codeLabel')}</Label>
              <Input
                id="global-sync-2fa-code"
                inputMode="numeric"
                autoComplete="one-time-code"
                autoFocus
                value={code}
                onChange={(event) => setCode(event.target.value)}
              />
            </div>
            <Button type="submit" disabled={submitting || code.length === 0}>
              {submitting ? t('sync.twoFactor.submitting') : t('sync.twoFactor.submit')}
            </Button>
          </form>
        ) : null}
      </DialogContent>
    </Dialog>
  )
}

function BankIcon({ bank }: { bank: string }) {
  return (
    <img
      src={bankIconUrl(bank)}
      alt=""
      aria-hidden="true"
      className="mx-auto size-12 rounded-lg object-cover"
      onError={(event) => {
        event.currentTarget.style.visibility = 'hidden'
      }}
    />
  )
}
