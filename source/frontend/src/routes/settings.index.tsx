import { createFileRoute, useRouter } from '@tanstack/react-router'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'

import { useLogout } from '@/lib/user'
import { useServerVersion, type VersionInfo } from '@/lib/version'
import { SettingsIndexView } from '@/pages/settings.index'

export const Route = createFileRoute('/settings/')({
  component: SettingsIndexPage,
})

function SettingsIndexPage() {
  const router = useRouter()
  const logout = useLogout()
  const { t } = useTranslation()
  const { data: serverVersion } = useServerVersion()

  const handleLogout = async () => {
    try {
      await logout.mutateAsync()
      router.history.push('/login')
    } catch {
      toast.error(t('settings.logoutFailed'))
    }
  }

  return (
    <SettingsIndexView
      logoutPending={logout.isPending}
      onLogout={handleLogout}
      serverVersion={serverVersion}
    />
  )
}

export interface SettingsIndexViewProps {
  logoutPending: boolean
  onLogout: () => void
  serverVersion?: VersionInfo
}
