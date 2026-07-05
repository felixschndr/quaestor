import { createFileRoute } from '@tanstack/react-router'

import { useServerVersion, type VersionInfo } from '@/lib/version'
import { SettingsVersionView } from '@/pages/settings.version'

export const Route = createFileRoute('/settings/version')({
  component: SettingsVersionPage,
})

function SettingsVersionPage() {
  const { data, isLoading } = useServerVersion()
  return <SettingsVersionView versionInfo={data} isLoading={isLoading} />
}

export interface SettingsVersionViewProps {
  versionInfo: VersionInfo | undefined
  isLoading: boolean
}
