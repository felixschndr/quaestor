import { createFileRoute } from '@tanstack/react-router'

import { useAuthMe } from '@/lib/auth'
import { SettingsProfileView } from '@/pages/settings.user.profile'

export const Route = createFileRoute('/settings/user/profile')({
  component: SettingsProfilePage,
})

function SettingsProfilePage() {
  const { data: user } = useAuthMe()
  if (!user) return null // root guard already redirected on 401
  return <SettingsProfileView user={user} />
}
