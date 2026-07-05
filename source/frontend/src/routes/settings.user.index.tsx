import { createFileRoute } from '@tanstack/react-router'

import { SettingsUserIndexView } from '@/pages/settings.user.index'

export const Route = createFileRoute('/settings/user/')({
  component: SettingsUserIndexView,
})
