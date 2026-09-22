import { createFileRoute } from '@tanstack/react-router'

import { SettingsCategorizationView } from '@/pages/settings.user.categorization'

export const Route = createFileRoute('/settings/user/categorization')({
  component: SettingsCategorizationView,
})
