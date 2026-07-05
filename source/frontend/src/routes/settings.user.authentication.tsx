import { createFileRoute } from '@tanstack/react-router'

import { useAuthMe } from '@/lib/auth'
import { SettingsAuthenticationView } from '@/pages/settings.user.authentication'

export const Route = createFileRoute('/settings/user/authentication')({
  component: SettingsAuthenticationPage,
})

function SettingsAuthenticationPage() {
  const { data: user } = useAuthMe()
  if (!user) return null // root guard already redirected on 401
  return <SettingsAuthenticationView user={user} />
}
