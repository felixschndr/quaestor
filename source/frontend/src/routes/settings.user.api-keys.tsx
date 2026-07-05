import { createFileRoute } from '@tanstack/react-router'

import { useAuthMe } from '@/lib/auth'
import { SettingsApiKeysView } from '@/pages/settings.user.api-keys'

export const Route = createFileRoute('/settings/user/api-keys')({
  component: SettingsApiKeysPage,
})

function SettingsApiKeysPage() {
  const { data: user } = useAuthMe()
  if (!user) return null // root guard already redirected on 401
  return <SettingsApiKeysView />
}
