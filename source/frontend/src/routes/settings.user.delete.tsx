import { createFileRoute, useRouter } from '@tanstack/react-router'

import { useAuthMe } from '@/lib/auth'
import { SettingsDeleteAccountView } from '@/pages/settings.user.delete'

export const Route = createFileRoute('/settings/user/delete')({
  component: SettingsDeleteAccountPage,
})

function SettingsDeleteAccountPage() {
  const router = useRouter()
  const { data: user } = useAuthMe()
  if (!user) return null // root guard already redirected on 401
  return (
    <SettingsDeleteAccountView user={user} onAccountDeleted={() => router.history.push('/login')} />
  )
}
