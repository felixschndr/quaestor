import { useTranslation } from 'react-i18next'

import { Button } from '@/components/ui/button'

export interface DeviceCodeAuthorizationProps {
  bankTitle: string
  authorizationUrl: string | null | undefined
  deviceCode: string | null
  pending: boolean
  onConfirm: () => void
}

export function DeviceCodeAuthorization({
  bankTitle,
  authorizationUrl,
  deviceCode,
  pending,
  onConfirm,
}: DeviceCodeAuthorizationProps) {
  const { t } = useTranslation()
  return (
    <>
      {deviceCode ? (
        <div className="border-border bg-card flex flex-col items-center gap-1 rounded-lg border p-3">
          <span className="text-muted-foreground text-xs">
            {t('sync.twoFactor.verifyCodeLabel')}
          </span>
          <span className="font-mono text-lg font-semibold tracking-widest">{deviceCode}</span>
        </div>
      ) : null}
      {authorizationUrl ? (
        <Button asChild variant="outline">
          <a href={authorizationUrl} target="_blank" rel="noopener noreferrer">
            {t('sync.twoFactor.authorizeLink', { bank: bankTitle })}
          </a>
        </Button>
      ) : null}
      <Button type="button" pending={pending} className="w-full" onClick={onConfirm}>
        {pending ? t('common.confirming') : t('sync.twoFactor.authorizeNoCodeConfirm')}
      </Button>
    </>
  )
}
