import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Mock } from 'vitest'

import '@/i18n'

const historyPush = vi.hoisted(() => vi.fn())
vi.mock('@tanstack/react-router', async () =>
  (await import('./-routerMock')).routerMocks({
    useRouter: () => ({ history: { push: historyPush } }),
  }),
)

import { NotificationLogView } from '@/pages/notifications'
import type { NotificationLogEntry } from '@/lib/notificationLog'
import { Route } from '@/routes/notifications'
import { jsonResponse, renderWithQuery } from '@/test/helpers'
import { DATETIME_RECENT } from '@/test/constants'

function buildEntry(overrides: Partial<NotificationLogEntry> = {}): NotificationLogEntry {
  return {
    id: 1,
    title: 'Payment overdue',
    body: 'Wallet: rent overdue since 2026-09-01',
    url: '/contracts/7',
    created_at: DATETIME_RECENT,
    read_at: null,
    ...overrides,
  }
}

function renderLog(entries: NotificationLogEntry[], onOpen = vi.fn(), onMarkAllRead = vi.fn()) {
  render(
    <NotificationLogView
      entries={entries}
      onOpen={onOpen}
      onMarkAllRead={onMarkAllRead}
      retentionDays={14}
    />,
  )
  return onOpen
}

describe('NotificationLogView', () => {
  it('shows the same title and body that went to the device', () => {
    renderLog([buildEntry()])

    expect(screen.getByText('Payment overdue')).toBeInTheDocument()
    expect(screen.getByText('Wallet: rent overdue since 2026-09-01')).toBeInTheDocument()
  })

  it('hands the whole entry back when a row is opened, so it can navigate and mark it read', async () => {
    const entry = buildEntry()
    const onOpen = renderLog([entry])

    await userEvent.click(screen.getByRole('button', { name: /Payment overdue/ }))

    expect(onOpen).toHaveBeenCalledWith(entry)
  })

  it('marks unread entries and leaves read ones unmarked', () => {
    renderLog([
      buildEntry({ id: 1, title: 'Unread one' }),
      buildEntry({ id: 2, title: 'Read one', read_at: DATETIME_RECENT }),
    ])

    expect(screen.getByRole('button', { name: /Unread one/ })).toHaveTextContent('unread')
    expect(screen.getByRole('button', { name: /Read one/ })).not.toHaveTextContent('unread')
  })

  it('keeps an entry without a target clickable so it can still be marked read', async () => {
    const entry = buildEntry({ title: 'Quaestor', body: 'Test push', url: null })
    const onOpen = renderLog([entry])

    await userEvent.click(screen.getByRole('button', { name: /Quaestor/ }))

    expect(onOpen).toHaveBeenCalledWith(entry)
  })

  it('offers marking everything read only while something is unread', async () => {
    const onMarkAllRead = vi.fn()
    const { rerender } = render(
      <NotificationLogView
        entries={[buildEntry()]}
        onOpen={vi.fn()}
        onMarkAllRead={onMarkAllRead}
        retentionDays={14}
      />,
    )

    await userEvent.click(screen.getByRole('button', { name: 'Mark all read' }))
    expect(onMarkAllRead).toHaveBeenCalled()

    rerender(
      <NotificationLogView
        entries={[buildEntry({ read_at: DATETIME_RECENT })]}
        onOpen={vi.fn()}
        onMarkAllRead={onMarkAllRead}
        retentionDays={14}
      />,
    )
    expect(screen.queryByRole('button', { name: 'Mark all read' })).not.toBeInTheDocument()
  })

  it('explains the retention instead of the list when there is nothing yet', () => {
    renderLog([])

    expect(screen.getByText('No notifications received yet.')).toBeInTheDocument()
    expect(screen.queryByText(/deleted automatically/)).not.toBeInTheDocument()
  })

  it('names the retention period below the list', () => {
    renderLog([buildEntry()])

    expect(
      screen.getByText('Notifications are deleted automatically after 14 days.'),
    ).toBeInTheDocument()
  })
})

describe('NotificationLogPage', () => {
  const Page = Route.options.component!

  function serveLog(entries: NotificationLogEntry[]) {
    const fetchMock = vi.fn((url: string, init?: { method?: string }) =>
      Promise.resolve(
        url === '/api/notification_log' && init?.method === 'GET'
          ? jsonResponse({ status: 200, body: entries })
          : jsonResponse({ status: 200, body: {} }),
      ),
    )
    globalThis.fetch = fetchMock as unknown as typeof fetch
    return fetchMock
  }

  function posts(fetchMock: Mock) {
    return fetchMock.mock.calls
      .filter(([, init]) => init?.method === 'POST')
      .map(([url]) => url as string)
  }

  afterEach(() => {
    historyPush.mockReset()
  })

  it('marks an unread entry read and navigates to its target', async () => {
    const fetchMock = serveLog([buildEntry({ id: 5 })])
    renderWithQuery(<Page />)

    await userEvent.click(await screen.findByRole('button', { name: /Payment overdue/ }))

    expect(historyPush).toHaveBeenCalledWith('/contracts/7')
    await waitFor(() => expect(posts(fetchMock)).toEqual(['/api/notification_log/5/read']))
    await waitFor(() =>
      expect(fetchMock.mock.calls.filter(([url]) => url === '/api/notification_log')).toHaveLength(
        2,
      ),
    )
  })

  it('neither re-marks a read entry nor navigates when it has no target', async () => {
    const fetchMock = serveLog([buildEntry({ url: null, read_at: DATETIME_RECENT })])
    renderWithQuery(<Page />)

    await userEvent.click(await screen.findByRole('button', { name: /Payment overdue/ }))

    expect(historyPush).not.toHaveBeenCalled()
    expect(posts(fetchMock)).toEqual([])
  })

  it('marks everything read in one request', async () => {
    const fetchMock = serveLog([buildEntry({ id: 1 }), buildEntry({ id: 2, title: 'Second' })])
    renderWithQuery(<Page />)

    await userEvent.click(await screen.findByRole('button', { name: 'Mark all read' }))

    await waitFor(() => expect(posts(fetchMock)).toEqual(['/api/notification_log/read']))
  })

  it('shows the empty state until the log has loaded', () => {
    globalThis.fetch = vi.fn(() => new Promise<Response>(() => {})) as unknown as typeof fetch
    renderWithQuery(<Page />)

    expect(screen.getByText('No notifications received yet.')).toBeInTheDocument()
  })
})
