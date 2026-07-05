import { createFileRoute } from '@tanstack/react-router'

import { SettingsAttributionsPage } from '@/pages/settings.attributions'

export const Route = createFileRoute('/settings/attributions')({
  component: SettingsAttributionsPage,
})
