import { useState } from 'react'
import { Link, createFileRoute, useRouter } from '@tanstack/react-router'
import { useTranslation } from 'react-i18next'
import { ChevronLeft, LogOut } from 'lucide-react'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import { useAuthMe, type UserRead } from '@/lib/auth'
import { readApiErrorMessage } from '@/lib/apiError'
import {
  useRevokeAllOtherSessions,
  useRevokeSession,
  useSessions,
  type SessionRead,
} from '@/lib/sessions'
import { useLogout } from '@/lib/user'
import { formatDateTime } from '@/lib/format'

export const Route = createFileRoute('/settings/user/sessions')({
  component: SettingsSessionsPage,
})

function SettingsSessionsPage() {
  const { data: user } = useAuthMe()
  if (!user) return null // root guard already redirected
  return <SettingsSessionsView user={user} />
}

export interface SettingsSessionsViewProps {
  user: UserRead
}

export function SettingsSessionsView({ user }: SettingsSessionsViewProps) {
  const { t } = useTranslation()
  const router = useRouter()
  const sessions = useSessions(user.id)
  const revokeOne = useRevokeSession(user.id)
  const revokeOthers = useRevokeAllOtherSessions(user.id)
  const logout = useLogout()
  const [confirming, setConfirming] = useState(false)

  const handleRevokeOne = async (sessionId: number) => {
    try {
      await revokeOne.mutateAsync(sessionId)
      toast.success(t('sessions.revoked'))
    } catch (err) {
      toast.error(readApiErrorMessage(err, t))
    }
  }

  const handleRevokeOthers = async () => {
    try {
      await revokeOthers.mutateAsync()
      setConfirming(false)
      toast.success(t('sessions.revokedAll'))
    } catch (err) {
      toast.error(readApiErrorMessage(err, t))
    }
  }

  const handleLogout = async () => {
    try {
      await logout.mutateAsync()
      router.history.push('/login')
    } catch (err) {
      toast.error(readApiErrorMessage(err, t))
    }
  }

  const list = sessions.data ?? []
  // Stable order: current session first, then most-recently-used.
  const sortedList = [...list].sort((a, b) => {
    if (a.is_current !== b.is_current) return a.is_current ? -1 : 1
    return b.last_used_at.localeCompare(a.last_used_at)
  })
  const otherSessionCount = list.filter((session) => !session.is_current).length

  return (
    <main className="mx-auto flex min-h-full max-w-2xl flex-col gap-6 p-4">
      <header className="flex items-center gap-2">
        <BackLink />
        <h1 className="text-foreground text-2xl font-semibold flex-1">{t('settings.sessions')}</h1>
        {otherSessionCount > 0 ? (
          confirming ? (
            <div className="flex gap-2">
              <Button
                type="button"
                variant="destructive"
                onClick={handleRevokeOthers}
                disabled={revokeOthers.isPending}
                size="sm"
              >
                {t('sessions.signOutEverywhereConfirm')}
              </Button>
              <Button
                type="button"
                variant="outline"
                onClick={() => setConfirming(false)}
                disabled={revokeOthers.isPending}
                size="sm"
              >
                {t('common.cancel')}
              </Button>
            </div>
          ) : (
            <Button
              type="button"
              variant="destructive"
              onClick={() => setConfirming(true)}
              size="sm"
            >
              <LogOut className="size-3.5" aria-hidden="true" />
              {t('sessions.signOutEverywhere')}
            </Button>
          )
        ) : null}
      </header>

      {sessions.isLoading ? (
        <p className="text-muted-foreground text-sm">{t('common.loading')}</p>
      ) : sessions.isError ? (
        <p className="text-destructive text-sm">{t('sessions.loadError')}</p>
      ) : sortedList.length === 0 ? (
        <p className="text-muted-foreground text-sm">{t('sessions.empty')}</p>
      ) : (
        <ul className="border-border bg-card flex flex-col rounded-lg border">
          {sortedList.map((session) => (
            <SessionRow
              key={session.id}
              session={session}
              onRevoke={() => handleRevokeOne(session.id)}
              onLogout={handleLogout}
              revoking={revokeOne.isPending && revokeOne.variables === session.id}
              loggingOut={logout.isPending}
            />
          ))}
        </ul>
      )}
    </main>
  )
}

function BackLink() {
  const { t } = useTranslation()
  return (
    <Link
      to="/settings/user"
      aria-label={t('settings.back')}
      className="text-primary hover:text-primary/80 -ml-1.5 rounded-md p-1.5 transition-colors"
    >
      <ChevronLeft className="size-5" />
    </Link>
  )
}

function SessionRow({
  session,
  onRevoke,
  onLogout,
  revoking,
  loggingOut,
}: {
  session: SessionRead
  onRevoke: () => void
  onLogout: () => void
  revoking: boolean
  loggingOut: boolean
}) {
  const { t } = useTranslation()
  return (
    <li className="border-border/40 flex flex-col gap-2 border-t p-3 first:border-t-0 sm:flex-row sm:items-center sm:gap-4">
      <div className="flex flex-1 flex-col gap-1 min-w-0">
        <div className="flex items-center gap-2">
          {session.is_current ? (
            <span className="bg-primary/15 text-primary inline-flex items-center rounded-md px-1.5 py-0.5 text-[0.65rem] font-semibold uppercase tracking-wide">
              {t('sessions.currentBadge')}
            </span>
          ) : null}
          <span className="text-sm font-medium truncate" title={session.user_agent ?? undefined}>
            {session.user_agent ?? t('sessions.unknownUserAgent')}
          </span>
        </div>
        <dl className="text-muted-foreground grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 text-xs">
          <dt>{t('sessions.created')}</dt>
          <dd>{formatDateTime(session.created_at)}</dd>
          <dt>{t('sessions.lastUsed')}</dt>
          <dd>{formatDateTime(session.last_used_at)}</dd>
          <dt>{t('sessions.ip')}</dt>
          <dd>{session.ip ?? t('sessions.unknownIp')}</dd>
        </dl>
      </div>
      {/* Fixed min-width so the Log-out and End-session buttons line up
          across rows even when the labels differ in length. */}
      <div className="sm:w-40 sm:self-center">
        {session.is_current ? (
          <Button
            type="button"
            variant="destructive"
            size="sm"
            disabled={loggingOut}
            onClick={onLogout}
            className="w-full"
          >
            {t('common.logout')}
          </Button>
        ) : (
          <Button
            type="button"
            variant="destructive"
            size="sm"
            disabled={revoking}
            onClick={onRevoke}
            className="w-full"
          >
            {t('sessions.endSession')}
          </Button>
        )}
      </div>
    </li>
  )
}
