import { useEffect } from 'react'
import { onlineManager, useQueryClient, type QueryClient } from '@tanstack/react-query'

import { accountHistoryQuery } from './accountHistory'
import { accountGroupLayoutQuery } from './accountGroups'
import { apiKeysQuery } from './apiKeys'
import { authQueryKeys, type UserRead } from './auth'
import { categorizationQuery, customCategoriesQuery } from './categorization'
import { contractQuery, contractsQuery } from './contract'
import { expectedTransactionsQuery } from './expectedTransaction'
import { notificationLogQuery } from './notificationLog'
import { notificationRulesQuery } from './notificationRules'
import { isOfflineCacheEnabled } from './offlineCache'
import { recurringTransactionsQuery } from './recurringTransaction'
import { sessionsQuery } from './sessions'
import { supportedCurrenciesQuery, supportedLanguagesQuery } from './user'

// Let the page that is being opened load first
const WARM_UP_DELAY_MS = 3_000
const WARM_UP_MIN_GAP_MS = 5 * 60 * 1000
// Don't flood the server with a request per account and contract at once
const PARALLEL_REQUESTS = 4

let lastWarmUp = 0

/**
 * Online, load what the pages show up front, so they work offline without having been opened before. Statistics are
 * left out: what they load depends on each page's filters, so only the views that were visited stay available.
 */
export function useOfflineWarmUp(userId: number | undefined) {
  const queryClient = useQueryClient()
  useEffect(() => {
    if (userId === undefined) return
    const run = () => void warmUp(queryClient)
    const timer = setTimeout(run, WARM_UP_DELAY_MS)
    const unsubscribe = onlineManager.subscribe((online) => {
      if (online) run()
    })
    return () => {
      clearTimeout(timer)
      unsubscribe()
    }
  }, [queryClient, userId])
}

export async function warmUp(queryClient: QueryClient): Promise<void> {
  const user = queryClient.getQueryData<UserRead>(authQueryKeys.me)
  if (!user || !isOfflineCacheEnabled() || !onlineManager.isOnline()) return
  if (Date.now() - lastWarmUp < WARM_UP_MIN_GAP_MS) return
  lastWarmUp = Date.now()

  const accountIds = user.credentials.flatMap((credential) =>
    credential.accounts.map((account) => account.id),
  )
  await runLimited([
    () => queryClient.query(contractsQuery()),
    () => queryClient.query(categorizationQuery()),
    () => queryClient.query(customCategoriesQuery()),
    () => queryClient.query(accountGroupLayoutQuery()),
    () => queryClient.query(notificationLogQuery()),
    () => queryClient.query(notificationRulesQuery()),
    () => queryClient.query(apiKeysQuery()),
    () => queryClient.query(sessionsQuery(user.id)),
    () => queryClient.query(supportedLanguagesQuery()),
    () => queryClient.query(supportedCurrenciesQuery()),
    ...accountIds.flatMap((accountId) => [
      () => queryClient.infiniteQuery(accountHistoryQuery(accountId)),
      () => queryClient.query(expectedTransactionsQuery(accountId)),
      () => queryClient.query(recurringTransactionsQuery(accountId)),
    ]),
  ])
  const contracts = queryClient.getQueryData(contractsQuery().queryKey) ?? []
  await runLimited(contracts.map((contract) => () => queryClient.query(contractQuery(contract.id))))
}

async function runLimited(tasks: (() => Promise<unknown>)[]): Promise<void> {
  const queue = [...tasks]
  const worker = async () => {
    for (let task = queue.shift(); task; task = queue.shift()) {
      await task().catch(() => {})
    }
  }
  await Promise.all(Array.from({ length: PARALLEL_REQUESTS }, worker))
}
