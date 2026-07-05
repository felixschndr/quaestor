import { useMemo } from 'react'
import { Link, createFileRoute } from '@tanstack/react-router'
import { useTranslation } from 'react-i18next'
import { ChevronLeft } from 'lucide-react'

import { useAccountGroupLayout } from '@/lib/accountGroups'
import { useAuthMe } from '@/lib/auth'
import { GroupsEditorView, buildAccountLookup } from '@/pages/settings.credentials.groups'

export const Route = createFileRoute('/settings/credentials/groups')({
  component: GroupsEditorPage,
})

function GroupsEditorPage() {
  const { data: user } = useAuthMe()
  const layoutQuery = useAccountGroupLayout()
  const accountLookup = useMemo(() => buildAccountLookup(user), [user])

  if (!user) return null
  return (
    <main className="mx-auto flex min-h-full max-w-3xl flex-col gap-6 p-4">
      <Header />
      {layoutQuery.isLoading || !layoutQuery.data ? (
        <LoadingPlaceholder />
      ) : (
        <GroupsEditorView layout={layoutQuery.data} accountLookup={accountLookup} />
      )}
    </main>
  )
}

function Header() {
  const { t } = useTranslation()
  return (
    <header className="flex items-center gap-2">
      <Link
        to="/settings/credentials"
        aria-label={t('credentials.groups.back')}
        className="text-primary hover:text-primary/80 -ml-1.5 rounded-md p-1.5 transition-colors"
      >
        <ChevronLeft className="size-5" />
      </Link>
      <h1 className="text-foreground flex-1 text-2xl font-semibold">
        {t('credentials.groups.title')}
      </h1>
    </header>
  )
}

function LoadingPlaceholder() {
  const { t } = useTranslation()
  return <p className="text-muted-foreground text-sm">{t('common.loading')}</p>
}
