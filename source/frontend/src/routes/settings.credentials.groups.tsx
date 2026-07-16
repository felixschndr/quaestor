import { useMemo } from 'react'
import { createFileRoute } from '@tanstack/react-router'
import { useTranslation } from 'react-i18next'

import { BackLink } from '@/components/back-link'

import { useAccountGroupLayout } from '@/lib/accountGroups'
import { useAuthMe } from '@/lib/auth'
import { GroupsEditorView, buildAccountLookup } from '@/pages/settings.credentials.groups'

export const Route = createFileRoute('/settings/credentials/groups')({
  component: GroupsEditorPage,
})

function GroupsEditorPage() {
  const { t } = useTranslation()
  const { data: user } = useAuthMe()
  const layoutQuery = useAccountGroupLayout()
  const accountLookup = useMemo(() => buildAccountLookup(user), [user])

  if (!user) return null
  return (
    <main className="mx-auto flex min-h-full max-w-page flex-col gap-6 p-4">
      <header className="flex items-center gap-2">
        <BackLink to="/settings/credentials" />
        <h1 className="text-foreground flex-1 text-2xl font-semibold">
          {t('credentials.groups.title')}
        </h1>
      </header>
      {layoutQuery.isLoading || !layoutQuery.data ? (
        <p className="text-muted-foreground text-sm">{t('common.loading')}</p>
      ) : (
        <GroupsEditorView layout={layoutQuery.data} accountLookup={accountLookup} />
      )}
    </main>
  )
}
