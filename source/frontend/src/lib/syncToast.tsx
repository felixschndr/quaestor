import type { TFunction } from 'i18next'
import { toast } from 'sonner'

import type { SyncJobErrorCode } from './credentials'

interface SyncFailureToast {
  t: TFunction
  bank: string
  credentialId: number
  errorCode?: SyncJobErrorCode | null
  navigate: (path: string) => void
  onRetry?: () => void
}

export function toastSyncFailure({
  t,
  bank,
  credentialId,
  errorCode,
  navigate,
  onRetry,
}: SyncFailureToast): void {
  const titleKey =
    errorCode === 'rate_limited'
      ? 'sync.rateLimited'
      : errorCode === 'unsupported_bank'
        ? 'sync.unsupportedBank'
        : 'sync.failed'
  const reason =
    titleKey === 'sync.failed'
      ? t(`credentials.syncError.reason.${errorCode ?? 'unknown'}`, {
          defaultValue: t('credentials.syncError.reason.unknown'),
        }).replace(/:$/, '')
      : null

  const id = toast.error(
    <button
      type="button"
      className="cursor-pointer text-left"
      onClick={() => {
        toast.dismiss(id)
        navigate(`/settings/credentials/${credentialId}`)
      }}
    >
      <span className="block">{t(titleKey, { bank })}</span>
      {reason ? <span className="mt-0.5 block text-xs opacity-80">{reason}</span> : null}
    </button>,
    onRetry ? { action: { label: t('common.retry'), onClick: onRetry } } : undefined,
  )
}
