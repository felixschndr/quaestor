import { createFileRoute } from '@tanstack/react-router'

import { SettingsApiKeysView } from '@/pages/settings.user.api-keys'

export const Route = createFileRoute('/settings/user/api-keys')({
  component: SettingsApiKeysView,
})
