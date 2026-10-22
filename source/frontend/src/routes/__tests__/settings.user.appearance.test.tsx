import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Mock } from 'vitest'

import '@/i18n'
import i18n from 'i18next'

vi.mock('@tanstack/react-router', async () => (await import('./-routerMock')).routerMocks())

const toast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }))
vi.mock('sonner', () => ({ toast }))

import { setDisplayCurrency } from '@/lib/format'
import { SettingsAppearanceView } from '@/pages/settings.user.appearance'
import { Route } from '@/routes/settings.user.appearance'
import { AMOUNT_S, money } from '@/test/constants'
import { openPopoverOptions, selectFromPopover } from '@/test/popover-select'
import { buildUser, jsonResponse, renderWithQuery } from './-settingsUserTestHelpers'

beforeEach(async () => {
  globalThis.fetch = vi.fn() as unknown as typeof fetch
  await i18n.changeLanguage('en')
})

afterEach(() => {
  vi.restoreAllMocks()
  vi.clearAllMocks()
  setDisplayCurrency('EUR')
  document.documentElement.className = ''
})

function serve(patch: () => Response) {
  const fetchMock = globalThis.fetch as Mock
  fetchMock.mockImplementation((url: string, init?: { method?: string }) => {
    if (url === '/api/i18n/languages') {
      return Promise.resolve(jsonResponse({ status: 200, body: { languages: ['en', 'de'] } }))
    }
    if (url === '/api/i18n/currencies') {
      return Promise.resolve(jsonResponse({ status: 200, body: { currencies: ['EUR', 'USD'] } }))
    }
    if (url === '/api/users/1' && init?.method === 'PATCH') return Promise.resolve(patch())
    return Promise.reject(new Error(`unexpected fetch: ${url}`))
  })
  return fetchMock
}

const failingPatch = () => jsonResponse({ status: 500, body: { detail: 'boom' } })
const GENERIC_ERROR = 'Something went wrong. Please try again.'

function patchBodies(fetchMock: Mock) {
  return fetchMock.mock.calls
    .filter(([url, init]) => url === '/api/users/1' && init?.method === 'PATCH')
    .map(([, init]) => JSON.parse(init.body))
}

describe('SettingsAppearanceView', () => {
  it('prefills the language and sorts the dropdown by localised label', async () => {
    const user = userEvent.setup()
    ;(globalThis.fetch as Mock).mockImplementation((url: string) => {
      if (url === '/api/i18n/languages') {
        // Server returns "en" before "de"; the UI must reorder alphabetically by label.
        return Promise.resolve(jsonResponse({ status: 200, body: { languages: ['en', 'de'] } }))
      }
      return Promise.reject(new Error(`unexpected fetch: ${url}`))
    })

    renderWithQuery(<SettingsAppearanceView user={buildUser()} />)

    expect(await screen.findByLabelText('Language')).toHaveTextContent('English')
    const labels = await openPopoverOptions(user, 'Language')
    expect(labels).toEqual(['English', 'German'])
  })

  it('PATCHes the language when the dropdown changes', async () => {
    const user = userEvent.setup()
    const fetchMock = globalThis.fetch as Mock
    fetchMock.mockImplementation((url: string) => {
      if (url === '/api/i18n/languages') {
        return Promise.resolve(jsonResponse({ status: 200, body: { languages: ['en', 'de'] } }))
      }
      if (url === '/api/users/1') {
        return Promise.resolve(jsonResponse({ status: 200, body: buildUser({ language: 'de' }) }))
      }
      return Promise.reject(new Error(`unexpected fetch: ${url}`))
    })

    renderWithQuery(<SettingsAppearanceView user={buildUser()} />)

    await screen.findByLabelText('Language')
    await selectFromPopover(user, 'Language', 'German')

    await waitFor(() => {
      const patch = fetchMock.mock.calls.find(
        ([url, init]) => url === '/api/users/1' && init?.method === 'PATCH',
      )
      expect(patch).toBeTruthy()
      expect(JSON.parse(patch![1].body)).toEqual({ language: 'de' })
    })
  })

  it('PATCHes the theme when the dropdown changes', async () => {
    const user = userEvent.setup()
    const fetchMock = globalThis.fetch as Mock
    fetchMock.mockImplementation((url: string) => {
      if (url === '/api/i18n/languages') {
        return Promise.resolve(jsonResponse({ status: 200, body: { languages: ['en'] } }))
      }
      if (url === '/api/users/1') {
        return Promise.resolve(jsonResponse({ status: 200, body: buildUser({ theme: 'DARK' }) }))
      }
      return Promise.reject(new Error(`unexpected fetch: ${url}`))
    })

    renderWithQuery(<SettingsAppearanceView user={buildUser()} />)

    await selectFromPopover(user, 'Appearance', 'Dark')

    await waitFor(() => {
      const patch = fetchMock.mock.calls.find(
        ([url, init]) => url === '/api/users/1' && init?.method === 'PATCH',
      )
      expect(patch).toBeTruthy()
      expect(JSON.parse(patch![1].body)).toEqual({ theme: 'DARK' })
    })
  })
  it('PATCHes the "due soon" toggle', async () => {
    const user = userEvent.setup()
    const fetchMock = globalThis.fetch as Mock
    fetchMock.mockImplementation((url: string) => {
      if (url === '/api/i18n/languages') {
        return Promise.resolve(jsonResponse({ status: 200, body: { languages: ['en'] } }))
      }
      if (url === '/api/users/1') {
        return Promise.resolve(
          jsonResponse({ status: 200, body: buildUser({ show_upcoming_contracts: false }) }),
        )
      }
      return Promise.reject(new Error(`unexpected fetch: ${url}`))
    })

    renderWithQuery(<SettingsAppearanceView user={buildUser()} />)

    const toggle = screen.getByRole('checkbox', {
      name: 'Show overdue contracts and the next payments in the overview, above the accounts',
    })
    expect(toggle).toBeChecked()
    await user.click(toggle)

    await waitFor(() => {
      const patch = fetchMock.mock.calls.find(
        ([url, init]) => url === '/api/users/1' && init?.method === 'PATCH',
      )
      expect(patch).toBeTruthy()
      expect(JSON.parse(patch![1].body)).toEqual({ show_upcoming_contracts: false })
    })
    expect(toggle).not.toBeChecked()
  })

  it('switches the display currency once the server accepted it', async () => {
    const user = userEvent.setup()
    const fetchMock = serve(() =>
      jsonResponse({ status: 200, body: buildUser({ currency: 'USD' }) }),
    )
    renderWithQuery(<SettingsAppearanceView user={buildUser()} />)

    await waitFor(() => expect(screen.getByLabelText('Currency')).toBeEnabled())
    await selectFromPopover(user, 'Currency', 'US Dollar ($)')

    await waitFor(() => expect(toast.success).toHaveBeenCalledWith('Saved'))
    expect(patchBodies(fetchMock)).toEqual([{ currency: 'USD' }])
    expect(money(AMOUNT_S)).toContain('$')
  })

  it('keeps the display currency when the server rejects the change', async () => {
    const user = userEvent.setup()
    serve(failingPatch)
    renderWithQuery(<SettingsAppearanceView user={buildUser()} />)

    await waitFor(() => expect(screen.getByLabelText('Currency')).toBeEnabled())
    await selectFromPopover(user, 'Currency', 'US Dollar ($)')

    await waitFor(() => expect(toast.error).toHaveBeenCalledWith(GENERIC_ERROR))
    expect(money(AMOUNT_S)).toContain('€')
    expect(screen.getByLabelText('Currency')).toBeEnabled()
  })

  it('keeps the UI language when the server rejects the change', async () => {
    const user = userEvent.setup()
    serve(failingPatch)
    renderWithQuery(<SettingsAppearanceView user={buildUser()} />)

    await waitFor(() => expect(screen.getByLabelText('Language')).toBeEnabled())
    await selectFromPopover(user, 'Language', 'German')

    await waitFor(() => expect(toast.error).toHaveBeenCalledWith(GENERIC_ERROR))
    expect(i18n.language).toBe('en')
    expect(toast.success).not.toHaveBeenCalled()
  })

  it('reverts to the saved theme when the server rejects the change', async () => {
    const user = userEvent.setup()
    serve(failingPatch)
    renderWithQuery(<SettingsAppearanceView user={buildUser({ theme: 'LIGHT' })} />)

    await selectFromPopover(user, 'Appearance', 'Dark')

    await waitFor(() => expect(toast.error).toHaveBeenCalledWith(GENERIC_ERROR))
    expect(document.documentElement).toHaveClass('light')
    expect(document.documentElement).not.toHaveClass('dark')
  })

  it('unticks the "due soon" toggle again when saving it fails', async () => {
    const user = userEvent.setup()
    serve(failingPatch)
    renderWithQuery(<SettingsAppearanceView user={buildUser()} />)

    const toggle = screen.getByRole('checkbox', {
      name: 'Show overdue contracts and the next payments in the overview, above the accounts',
    })
    await user.click(toggle)

    await waitFor(() => expect(toast.error).toHaveBeenCalledWith(GENERIC_ERROR))
    expect(toggle).toBeChecked()
  })

  it('sends nothing when the current language, currency or theme is picked again', async () => {
    const user = userEvent.setup()
    const fetchMock = serve(failingPatch)
    renderWithQuery(<SettingsAppearanceView user={buildUser()} />)

    await waitFor(() => expect(screen.getByLabelText('Currency')).toBeEnabled())
    await selectFromPopover(user, 'Language', 'English')
    await selectFromPopover(user, 'Currency', 'Euro (€)')
    await selectFromPopover(user, 'Appearance', 'System')

    expect(patchBodies(fetchMock)).toEqual([])
    expect(toast.success).not.toHaveBeenCalled()
  })
})

describe('SettingsAppearancePage', () => {
  const Page = Route.options.component!

  it('shows the appearance settings of the signed-in user', async () => {
    ;(globalThis.fetch as Mock).mockImplementation((url: string) =>
      Promise.resolve(
        url === '/api/auth/me'
          ? jsonResponse({ status: 200, body: buildUser({ theme: 'DARK' }) })
          : jsonResponse({ status: 404 }),
      ),
    )

    renderWithQuery(<Page />)

    expect(await screen.findByLabelText('Appearance')).toHaveTextContent('Dark')
  })

  it('renders nothing while the signed-in user is unknown', async () => {
    ;(globalThis.fetch as Mock).mockResolvedValue(jsonResponse({ status: 401 }))

    const { container } = renderWithQuery(<Page />)

    await waitFor(() => expect(globalThis.fetch).toHaveBeenCalled())
    expect(container).toBeEmptyDOMElement()
  })
})
