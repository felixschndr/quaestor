import { useTranslation } from 'react-i18next'

import type { VersionInfo } from '@/lib/version'
import type { SettingsVersionViewProps } from '@/routes/settings.version'
import { BackLink } from '@/components/back-link'

export function SettingsVersionView({ versionInfo, isLoading }: SettingsVersionViewProps) {
  const { t } = useTranslation()

  return (
    <main className="mx-auto flex min-h-full max-w-page flex-col gap-6 p-4">
      <header className="flex items-center gap-2">
        <BackLink to="/settings" />
        <h1 className="text-foreground text-2xl font-semibold">{t('version.title')}</h1>
      </header>

      <ul className="border-border bg-card flex flex-col rounded-lg border">
        <li className="border-border/40 flex items-center justify-between border-t px-3 py-3 first:border-t-0">
          <span className="text-muted-foreground text-sm select-none">{t('version.current')}</span>
          <span className="text-sm font-medium">
            {isLoading || !versionInfo ? '…' : versionInfo.current}
          </span>
        </li>
        <li className="border-border/40 flex items-center justify-between border-t px-3 py-3 first:border-t-0">
          <span className="text-muted-foreground text-sm select-none">{t('version.latest')}</span>
          <LatestValue versionInfo={versionInfo} isLoading={isLoading} />
        </li>
        <li className="border-border/40 border-t px-3 py-3 text-sm select-none first:border-t-0">
          <StatusLine versionInfo={versionInfo} isLoading={isLoading} />
        </li>
      </ul>
    </main>
  )
}

function LatestValue({
  versionInfo,
  isLoading,
}: {
  versionInfo: VersionInfo | undefined
  isLoading: boolean
}) {
  const { t } = useTranslation()
  if (isLoading || !versionInfo) return <span className="text-sm font-medium">…</span>
  if (versionInfo.latest === null) {
    return <span className="text-muted-foreground text-sm">{t('version.checkFailed')}</span>
  }
  if (versionInfo.release_url) {
    return (
      <a
        href={versionInfo.release_url}
        target="_blank"
        rel="noopener noreferrer"
        className="text-sm font-medium hover:underline"
      >
        {versionInfo.latest}
      </a>
    )
  }
  return <span className="text-sm font-medium">{versionInfo.latest}</span>
}

function StatusLine({
  versionInfo,
  isLoading,
}: {
  versionInfo: VersionInfo | undefined
  isLoading: boolean
}) {
  const { t } = useTranslation()
  if (isLoading || !versionInfo || versionInfo.latest === null) {
    return <span className="text-muted-foreground">{t('version.checkFailed')}</span>
  }
  if (versionInfo.update_available) {
    return <span className="text-destructive font-medium">{t('version.updateAvailable')}</span>
  }
  return <span className="text-success font-medium">{t('version.upToDate')}</span>
}
