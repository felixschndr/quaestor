import { createFileRoute } from '@tanstack/react-router'

import { useAuthMe } from '@/lib/auth'
import { useSync } from '@/components/sync-provider'
import { OverviewView } from '@/pages'

export const Route = createFileRoute('/')({
  component: OverviewPage,
})

function OverviewPage() {
  const { data: user } = useAuthMe()
  const sync = useSync()

  if (!user) return null // Root guard already redirected to /login on 401.

  const isBusy =
    sync.status === 'starting' || sync.status === 'running' || sync.status === 'awaiting_2fa'

  return (
    <OverviewView
      user={user}
      onSyncClick={() => sync.start()}
      syncDisabled={isBusy}
      syncSpinning={isBusy}
      syncSucceededAt={sync.succeededAt}
      syncJobs={sync.jobs}
    />
  )
}
