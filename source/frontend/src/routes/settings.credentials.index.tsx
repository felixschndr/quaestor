import { createFileRoute } from '@tanstack/react-router'

import { useAuthMe, type UserRead } from '@/lib/auth'
import { SettingsCredentialsIndexView } from '@/pages/settings.credentials.index'

export const Route = createFileRoute('/settings/credentials/')({
  component: SettingsCredentialsIndexPage,
})

function SettingsCredentialsIndexPage() {
  const { data: user } = useAuthMe()
  if (!user) return null // root guard already redirected on 401
  return <SettingsCredentialsIndexView user={user} />
}

export interface SettingsCredentialsIndexViewProps {
  user: UserRead
}
