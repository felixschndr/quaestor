import { createFileRoute } from '@tanstack/react-router'

import { useAuthMe, type UserRead } from '@/lib/auth'
import { SettingsSessionsView } from '@/pages/settings.user.sessions'

export const Route = createFileRoute('/settings/user/sessions')({
  component: SettingsSessionsPage,
})

function SettingsSessionsPage() {
  const { data: user } = useAuthMe()
  if (!user) return null // root guard already redirected
  return <SettingsSessionsView user={user} />
}

export interface SettingsSessionsViewProps {
  user: UserRead
}
