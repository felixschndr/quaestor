import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import '@/i18n'
import i18n from 'i18next'

vi.mock('@tanstack/react-router', async () => (await import('./-routerMock')).routerMocks())

const toast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }))
vi.mock('sonner', () => ({ toast }))

import type { UserRead } from '@/lib/auth'
import { setDisplayCurrency } from '@/lib/format'
import { SettingsAppearanceView } from '@/pages/settings.user.appearance'
import { Route } from '@/routes/settings.user.appearance'
import { AMOUNT_S, money } from '@/test/constants'
import { openPopoverOptions, selectFromPopover } from '@/test/popover-select'
import { bodyOf, buildUser, renderWithQuery, requestsTo, serve } from '@/test/helpers'

beforeEach(async () => {
  globalThis.fetch = vi.fn() as unknown as typeof fetch
  await i18n.changeLanguage('en')
})

afterEach(() => {
  setDisplayCurrency('EUR')
  document.documentElement.className = ''
})

const USER_URL = '/api/users/1'
const FAILING_PATCH = { status: 500, body: { detail: 'boom' } }
const GENERIC_ERROR = 'Something went wrong. Please try again.'
const DUE_SOON_TOGGLE =
  'Show overdue contracts and the next payments in the overview, above the accounts'

function serveAppearance(patch: { status: number; body?: unknown } = FAILING_PATCH) {
  serve({
    // Server returns "en" before "de"; the UI must reorder alphabetically by label.
    'GET /api/i18n/languages': { status: 200, body: { languages: ['en', 'de'] } },
    'GET /api/i18n/currencies': { status: 200, body: { currencies: ['EUR', 'USD'] } },
    [`PATCH ${USER_URL}`]: patch,
  })
}

describe('SettingsAppearanceView', () => {
  it('prefills the language and sorts the dropdown by localised label', async () => {
    const user = userEvent.setup()
    serveAppearance()

    renderWithQuery(<SettingsAppearanceView user={buildUser()} />)

    expect(await screen.findByLabelText('Language')).toHaveTextContent('English')
    const labels = await openPopoverOptions(user, 'Language')
    expect(labels).toEqual(['English', 'German'])
  })

  it.each<[string, string, Partial<UserRead>]>([
    ['Language', 'German', { language: 'de' }],
    ['Appearance', 'Dark', { theme: 'DARK' }],
  ])('PATCHes the %s when the dropdown changes', async (label, option, payload) => {
    const user = userEvent.setup()
    serveAppearance({ status: 200, body: buildUser(payload) })

    renderWithQuery(<SettingsAppearanceView user={buildUser()} />)

    await screen.findByLabelText(label)
    await selectFromPopover(user, label, option)

    await waitFor(() => expect(bodyOf('PATCH', USER_URL)).toEqual(payload))
  })

  it('PATCHes the "due soon" toggle', async () => {
    const user = userEvent.setup()
    serveAppearance({ status: 200, body: buildUser({ show_upcoming_contracts: false }) })

    renderWithQuery(<SettingsAppearanceView user={buildUser()} />)

    const toggle = screen.getByRole('checkbox', { name: DUE_SOON_TOGGLE })
    expect(toggle).toBeChecked()
    await user.click(toggle)

    await waitFor(() =>
      expect(bodyOf('PATCH', USER_URL)).toEqual({ show_upcoming_contracts: false }),
    )
    expect(toggle).not.toBeChecked()
  })

  it('switches the display currency once the server accepted it', async () => {
    const user = userEvent.setup()
    serveAppearance({ status: 200, body: buildUser({ currency: 'USD' }) })
    renderWithQuery(<SettingsAppearanceView user={buildUser()} />)

    await waitFor(() => expect(screen.getByLabelText('Currency')).toBeEnabled())
    await selectFromPopover(user, 'Currency', 'US Dollar ($)')

    await waitFor(() => expect(toast.success).toHaveBeenCalledWith('Saved'))
    expect(requestsTo('PATCH', USER_URL)).toHaveLength(1)
    expect(bodyOf('PATCH', USER_URL)).toEqual({ currency: 'USD' })
    expect(money(AMOUNT_S)).toContain('$')
  })

  it('keeps the display currency when the server rejects the change', async () => {
    const user = userEvent.setup()
    serveAppearance()
    renderWithQuery(<SettingsAppearanceView user={buildUser()} />)

    await waitFor(() => expect(screen.getByLabelText('Currency')).toBeEnabled())
    await selectFromPopover(user, 'Currency', 'US Dollar ($)')

    await waitFor(() => expect(toast.error).toHaveBeenCalledWith(GENERIC_ERROR))
    expect(money(AMOUNT_S)).toContain('€')
    expect(screen.getByLabelText('Currency')).toBeEnabled()
  })

  it('keeps the UI language when the server rejects the change', async () => {
    const user = userEvent.setup()
    serveAppearance()
    renderWithQuery(<SettingsAppearanceView user={buildUser()} />)

    await waitFor(() => expect(screen.getByLabelText('Language')).toBeEnabled())
    await selectFromPopover(user, 'Language', 'German')

    await waitFor(() => expect(toast.error).toHaveBeenCalledWith(GENERIC_ERROR))
    expect(i18n.language).toBe('en')
    expect(toast.success).not.toHaveBeenCalled()
  })

  it('reverts to the saved theme when the server rejects the change', async () => {
    const user = userEvent.setup()
    serveAppearance()
    renderWithQuery(<SettingsAppearanceView user={buildUser({ theme: 'LIGHT' })} />)

    await selectFromPopover(user, 'Appearance', 'Dark')

    await waitFor(() => expect(toast.error).toHaveBeenCalledWith(GENERIC_ERROR))
    expect(document.documentElement).toHaveClass('light')
    expect(document.documentElement).not.toHaveClass('dark')
  })

  it('unticks the "due soon" toggle again when saving it fails', async () => {
    const user = userEvent.setup()
    serveAppearance()
    renderWithQuery(<SettingsAppearanceView user={buildUser()} />)

    const toggle = screen.getByRole('checkbox', { name: DUE_SOON_TOGGLE })
    await user.click(toggle)

    await waitFor(() => expect(toast.error).toHaveBeenCalledWith(GENERIC_ERROR))
    expect(toggle).toBeChecked()
  })

  it('sends nothing when the current language, currency or theme is picked again', async () => {
    const user = userEvent.setup()
    serveAppearance()
    renderWithQuery(<SettingsAppearanceView user={buildUser()} />)

    await waitFor(() => expect(screen.getByLabelText('Currency')).toBeEnabled())
    await selectFromPopover(user, 'Language', 'English')
    await selectFromPopover(user, 'Currency', 'Euro (€)')
    await selectFromPopover(user, 'Appearance', 'System')

    expect(requestsTo('PATCH', USER_URL)).toHaveLength(0)
    expect(toast.success).not.toHaveBeenCalled()
  })
})

describe('SettingsAppearancePage', () => {
  const Page = Route.options.component!

  it('shows the appearance settings of the signed-in user', async () => {
    serve({ 'GET /api/auth/me': { status: 200, body: buildUser({ theme: 'DARK' }) } })

    renderWithQuery(<Page />)

    expect(await screen.findByLabelText('Appearance')).toHaveTextContent('Dark')
  })

  it('renders nothing while the signed-in user is unknown', async () => {
    serve({ 'GET /api/auth/me': { status: 401 } })

    const { container } = renderWithQuery(<Page />)

    await waitFor(() => expect(globalThis.fetch).toHaveBeenCalled())
    expect(container).toBeEmptyDOMElement()
  })
})
