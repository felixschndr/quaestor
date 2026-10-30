import { act, fireEvent, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import '@/i18n'
import i18n from 'i18next'

vi.mock('@tanstack/react-router', async () => (await import('./-routerMock')).routerMocks())

const toast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }))
vi.mock('sonner', () => ({ toast }))

import { SettingsProfileView } from '@/pages/settings.user.profile'
import { Route } from '@/routes/settings.user.profile'
import { bodyOf, buildUser, renderWithQuery, requestsTo, serve } from '@/test/helpers'

beforeEach(async () => {
  globalThis.fetch = vi.fn() as unknown as typeof fetch
  await i18n.changeLanguage('en')
})

const USER_URL = '/api/users/1'

function servePatch(patch: { status: number; body?: unknown }) {
  serve({ [`PATCH ${USER_URL}`]: patch })
}

async function saveField(label: string, value: string) {
  const user = userEvent.setup()
  const input = screen.getByLabelText(label)
  await user.clear(input)
  if (value) await user.type(input, value)
  await user.click(within(input.closest('form')!).getByRole('button', { name: 'Save' }))
}

describe('SettingsProfileView', () => {
  it('prefills the username and display name', () => {
    renderWithQuery(<SettingsProfileView user={buildUser()} />)

    expect(screen.getByLabelText('Username')).toHaveValue('alice')
    expect(screen.getByLabelText('Display name')).toHaveValue('Alice')
  })

  it.each([
    ['display name', 'Display name', 'Renamed', { display_name: 'Renamed' }],
    ['username (normalised)', 'Username', '  NewName  ', { user_name: 'newname' }],
  ])('PATCHes the %s when the user saves', async (_, label, value, payload) => {
    servePatch({ status: 200, body: buildUser(payload) })
    renderWithQuery(<SettingsProfileView user={buildUser()} />)

    await saveField(label, value)

    await waitFor(() => expect(bodyOf('PATCH', USER_URL)).toEqual(payload))
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith('Saved'))
    expect(toast.error).not.toHaveBeenCalled()
  })

  it('shows an inline error on the username field when the server returns 409', async () => {
    servePatch({ status: 409, body: { detail: 'User name already taken' } })
    renderWithQuery(<SettingsProfileView user={buildUser()} />)

    await saveField('Username', 'taken')

    expect(await screen.findByText('This username is already taken')).toBeInTheDocument()
  })

  it.each([
    ['Username', 'bob'],
    ['Display name', 'Bob'],
  ])('reports a failed %s change with a toast', async (label, value) => {
    servePatch({ status: 500, body: { detail: 'boom' } })
    renderWithQuery(<SettingsProfileView user={buildUser()} />)

    await saveField(label, value)

    await waitFor(() =>
      expect(toast.error).toHaveBeenCalledWith('Something went wrong. Please try again.'),
    )
    expect(toast.success).not.toHaveBeenCalled()
  })

  it.each(['Username', 'Display name'])('requires a %s before saving', async (label) => {
    renderWithQuery(<SettingsProfileView user={buildUser()} />)

    await saveField(label, '')

    expect(await screen.findByText('This field is required')).toBeInTheDocument()
    expect(requestsTo('PATCH', USER_URL)).toHaveLength(0)
  })

  it('keeps Save disabled and sends nothing while the values are unchanged', async () => {
    renderWithQuery(<SettingsProfileView user={buildUser()} />)

    for (const label of ['Username', 'Display name']) {
      const form = screen.getByLabelText(label).closest('form')!
      expect(within(form).getByRole('button', { name: 'Save' })).toBeDisabled()
      await act(async () => fireEvent.submit(form))
    }

    expect(requestsTo('PATCH', USER_URL)).toHaveLength(0)
  })

  it('ignores a username that only differs in case and surrounding spaces', async () => {
    const user = userEvent.setup()
    renderWithQuery(<SettingsProfileView user={buildUser()} />)

    const input = screen.getByLabelText('Username')
    await user.clear(input)
    await user.type(input, ' ALICE ')

    expect(within(input.closest('form')!).getByRole('button', { name: 'Save' })).toBeDisabled()
  })
})

describe('SettingsProfilePage', () => {
  const Page = Route.options.component!

  it('shows the profile of the signed-in user', async () => {
    serve({ 'GET /api/auth/me': { status: 200, body: buildUser({ display_name: 'Alice Doe' }) } })

    renderWithQuery(<Page />)

    expect(await screen.findByLabelText('Display name')).toHaveValue('Alice Doe')
  })

  it('renders nothing while the signed-in user is unknown', async () => {
    serve({ 'GET /api/auth/me': { status: 401 } })

    const { container } = renderWithQuery(<Page />)

    await waitFor(() => expect(globalThis.fetch).toHaveBeenCalled())
    expect(container).toBeEmptyDOMElement()
  })
})
