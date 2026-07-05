import { createFileRoute } from '@tanstack/react-router'

import { useAuthMe } from '@/lib/auth'
import { SettingsNotificationsView } from '@/pages/settings.user.notifications'

export const Route = createFileRoute('/settings/user/notifications')({
  component: SettingsNotificationsPage,
})

function SettingsNotificationsPage() {
  const { data: user } = useAuthMe()
  if (!user) return null // root guard already redirected on 401
  return <SettingsNotificationsView user={user} />
}
