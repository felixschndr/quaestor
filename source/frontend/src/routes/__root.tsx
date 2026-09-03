import { useEffect } from 'react'
import {
  Outlet,
  createRootRouteWithContext,
  useRouter,
  useRouterState,
} from '@tanstack/react-router'
import { Toaster } from 'sonner'
import { Loader2, CloudOff, AlertTriangle } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { useQueryClient, type QueryClient } from '@tanstack/react-query'

import { BottomTabBar } from '@/components/bottom-tab-bar'
import { Button } from '@/components/ui/button'
import { NetworkError } from '@/lib/api'
import { authQueryKeys, ensureAuthenticated, useAuthMe, type UserRead } from '@/lib/auth'
import { ensureAppSettings } from '@/lib/settings'
import { autoSubscribe } from '@/lib/push'
import { consumeClickedNotification } from '@/lib/notificationLog'
import { readStoredTheme, useResolvedTheme } from '@/lib/theme'
import { setDisplayCurrency } from '@/lib/format'
import { useApplyUserLanguage } from '@/i18n'

const NO_TAB_BAR_PREFIXES = ['/login', '/banking']

export const Route = createRootRouteWithContext<{
  queryClient: QueryClient
}>()({
  beforeLoad: async ({ context, location }) => {
    await ensureAppSettings(context.queryClient)
    await ensureAuthenticated({
      queryClient: context.queryClient,
      pathname: location.pathname,
      search: location.searchStr,
    })
    const user = context.queryClient.getQueryData<UserRead>(authQueryKeys.me)
    if (user?.currency) setDisplayCurrency(user.currency)
  },
  component: RootComponent,
  pendingComponent: LoadingScreen,
  errorComponent: RootErrorScreen,
})

function RootComponent() {
  const { data: user } = useAuthMe()
  const preference = user?.theme ?? readStoredTheme()
  const resolved = useResolvedTheme(preference)
  useApplyUserLanguage(user?.language)
  if (user?.currency) setDisplayCurrency(user.currency)
  const userId = user?.id
  const queryClient = useQueryClient()
  useEffect(() => {
    if (userId) void autoSubscribe()
  }, [userId])
  useEffect(() => {
    if (userId) void consumeClickedNotification(queryClient)
  }, [userId, queryClient])
  const pathname = useRouterState({ select: (s) => s.location.pathname })
  const showTabBar = !NO_TAB_BAR_PREFIXES.some((p) => pathname.startsWith(p))
  return (
    <>
      <div className={showTabBar ? 'pb-16 sm:pb-0' : undefined}>
        <Outlet />
      </div>
      {showTabBar ? <BottomTabBar /> : null}
      <Toaster position="bottom-center" theme={resolved === 'DARK' ? 'dark' : 'light'} richColors />
    </>
  )
}

export function LoadingScreen() {
  const { t } = useTranslation()
  const label = t('common.loading')
  return (
    <main
      role="status"
      aria-live="polite"
      aria-label={label}
      className="flex min-h-screen items-center justify-center"
    >
      <Loader2 className="text-primary size-8 animate-spin" aria-hidden="true" />
      <span className="sr-only">{label}</span>
    </main>
  )
}

export function RootErrorScreen({ error, reset }: { error: Error; reset: () => void }) {
  const { t } = useTranslation()
  const router = useRouter()
  const isOffline = error instanceof NetworkError
  const Icon = isOffline ? CloudOff : AlertTriangle
  const title = isOffline ? t('errors.serverOffline.title') : t('errors.unexpected.title')
  const description = isOffline
    ? t('errors.serverOffline.description')
    : t('errors.unexpected.description')
  const handleRetry = () => {
    reset()
    void router.invalidate()
  }
  return (
    <main
      role="alert"
      className="bg-background text-foreground flex min-h-screen items-center justify-center p-6"
    >
      <div className="border-border bg-card flex max-w-xl flex-col items-center gap-4 rounded-lg border p-6 text-center shadow-sm">
        <Icon className="text-muted-foreground size-10" aria-hidden="true" />
        <h1 className="text-lg font-semibold">{title}</h1>
        <p className="text-muted-foreground text-sm">{description}</p>
        <Button onClick={handleRetry} size="sm">
          {t('common.retry')}
        </Button>
      </div>
    </main>
  )
}
