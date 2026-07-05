import { createFileRoute } from '@tanstack/react-router'

import { useAuthMe } from '@/lib/auth'
import { SettingsAppearanceView } from '@/pages/settings.user.appearance'

export const Route = createFileRoute('/settings/user/appearance')({
  component: SettingsAppearancePage,
})

function SettingsAppearancePage() {
  const { data: user } = useAuthMe()
  if (!user) return null // root guard already redirected on 401
  return <SettingsAppearanceView user={user} />
}
