import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Mock } from 'vitest'

import '@/i18n'
import i18n from 'i18next'

vi.mock('@tanstack/react-router', async () => (await import('./-routerMock')).routerMocks())

const toast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }))
vi.mock('sonner', () => ({ toast }))

import { SettingsAuthenticationView } from '@/pages/settings.user.authentication'
import { Route } from '@/routes/settings.user.authentication'
import { TEST_TOTP_SECRET, TWO_FACTOR_CODE } from '@/test/constants'
import { PASSWORD_REQUIREMENTS, buildUser, jsonResponse, renderWithQuery } from '@/test/helpers'

// PasswordSection fetches the requirements on mount, so every test serves them.
function withPasswordRequirements(
  handler: (url: string, init?: RequestInit) => Promise<Response> | undefined,
) {
  return (url: string, init?: RequestInit) => {
    if (url === '/api/auth/password_requirements') {
      return Promise.resolve(jsonResponse({ status: 200, body: PASSWORD_REQUIREMENTS }))
    }
    const result = handler(url, init)
    if (result) return result
    return Promise.reject(new Error(`unexpected fetch: ${url}`))
  }
}

beforeEach(async () => {
  globalThis.fetch = vi.fn() as unknown as typeof fetch
  await i18n.changeLanguage('en')
})

const CURRENT_PASSWORD = 'old-password-1!'
const STRONG_PASSWORD = 'NewBrandPa55word!'
const GENERIC_ERROR = 'Something went wrong. Please try again.'

function serveOne(method: string, path: string, respond: () => Response) {
  ;(globalThis.fetch as Mock).mockImplementation(
    withPasswordRequirements((url, init) =>
      url === path && init?.method === method ? Promise.resolve(respond()) : undefined,
    ),
  )
}

async function changePassword(newPassword = STRONG_PASSWORD) {
  const user = userEvent.setup()
  await user.type(screen.getByLabelText('Current password'), CURRENT_PASSWORD)
  await user.type(screen.getByLabelText('New password'), newPassword)
  await user.type(screen.getByLabelText('Confirm password'), newPassword)
  await user.click(screen.getByRole('button', { name: 'Change password' }))
}

describe('SettingsAuthenticationView — password', () => {
  it('marks the current password field on a 401', async () => {
    const user = userEvent.setup()
    const fetchMock = globalThis.fetch as Mock
    fetchMock.mockImplementation(
      withPasswordRequirements((url, init) => {
        if (url === '/api/users/1' && init?.method === 'PATCH') {
          return Promise.resolve(
            jsonResponse({ status: 401, body: { detail: 'Current password is incorrect' } }),
          )
        }
        return undefined
      }),
    )

    renderWithQuery(<SettingsAuthenticationView user={buildUser()} />)

    await user.type(screen.getByLabelText('Current password'), 'old-password-1!')
    await user.type(screen.getByLabelText('New password'), 'NewBrandPa55word!')
    await user.type(screen.getByLabelText('Confirm password'), 'NewBrandPa55word!')
    await user.click(screen.getByRole('button', { name: 'Change password' }))

    expect(await screen.findByText('Current password is incorrect')).toBeInTheDocument()
  })

  it('blocks the change with a translated message when the new password is too weak', async () => {
    const user = userEvent.setup()
    const fetchMock = globalThis.fetch as Mock
    fetchMock.mockImplementation(withPasswordRequirements(() => undefined))

    renderWithQuery(<SettingsAuthenticationView user={buildUser()} />)
    await screen.findByText('Password must contain:')

    await user.type(screen.getByLabelText('Current password'), 'whatever-current-1!')
    await user.type(screen.getByLabelText('New password'), 'tooshort')
    await user.type(screen.getByLabelText('Confirm password'), 'tooshort')
    await user.click(screen.getByRole('button', { name: 'Change password' }))

    expect(await screen.findByText('Password does not meet all requirements')).toBeInTheDocument()
    expect(
      fetchMock.mock.calls.find(
        ([url, init]) => url === '/api/users/1' && init?.method === 'PATCH',
      ),
    ).toBeUndefined()
    expect(screen.queryByText(/String should have at least/)).not.toBeInTheDocument()
  })

  it('blocks the change when the confirm field does not match', async () => {
    const user = userEvent.setup()
    ;(globalThis.fetch as Mock).mockImplementation(withPasswordRequirements(() => undefined))

    renderWithQuery(<SettingsAuthenticationView user={buildUser()} />)

    await user.type(screen.getByLabelText('Current password'), 'old-password-1!')
    await user.type(screen.getByLabelText('New password'), 'NewBrandPa55word!')
    await user.type(screen.getByLabelText('Confirm password'), 'DifferentPa55!word!')
    await user.click(screen.getByRole('button', { name: 'Change password' }))

    expect(await screen.findByText('Passwords do not match')).toBeInTheDocument()
  })

  it('changes the password, clears the form and mentions the signed-out sessions', async () => {
    serveOne('PATCH', '/api/users/1', () => jsonResponse({ status: 200, body: buildUser() }))
    renderWithQuery(<SettingsAuthenticationView user={buildUser()} />)
    await screen.findByText('Password must contain:')

    await changePassword()

    await waitFor(() =>
      expect(toast.success).toHaveBeenCalledWith('Password changed', {
        description: 'Other sessions signed out',
      }),
    )
    const patch = (globalThis.fetch as Mock).mock.calls.find(
      ([url, init]) => url === '/api/users/1' && init?.method === 'PATCH',
    )
    expect(JSON.parse(patch![1].body)).toEqual({
      current_password: CURRENT_PASSWORD,
      new_password: STRONG_PASSWORD,
    })
    expect(screen.getByLabelText('Current password')).toHaveValue('')
    expect(screen.getByLabelText('New password')).toHaveValue('')
    expect(screen.getByLabelText('Confirm password')).toHaveValue('')
  })

  it('marks the new password as too weak when the server rejects it with a 422', async () => {
    serveOne('PATCH', '/api/users/1', () => jsonResponse({ status: 422, body: { detail: 'weak' } }))
    renderWithQuery(<SettingsAuthenticationView user={buildUser()} />)
    await screen.findByText('Password must contain:')

    await changePassword()

    expect(await screen.findByText('Password does not meet all requirements')).toBeInTheDocument()
    expect(toast.error).not.toHaveBeenCalled()
  })

  it('reports any other failure with a toast', async () => {
    serveOne('PATCH', '/api/users/1', () => jsonResponse({ status: 500, body: { detail: 'boom' } }))
    renderWithQuery(<SettingsAuthenticationView user={buildUser()} />)
    await screen.findByText('Password must contain:')

    await changePassword()

    await waitFor(() => expect(toast.error).toHaveBeenCalledWith(GENERIC_ERROR))
    expect(screen.getByLabelText('New password')).toHaveValue(STRONG_PASSWORD)
  })

  it('leaves the strength check to the server when the requirements could not be loaded', async () => {
    const fetchMock = globalThis.fetch as Mock
    fetchMock.mockImplementation((url: string, init?: RequestInit) => {
      if (url === '/api/users/1' && init?.method === 'PATCH') {
        return Promise.resolve(jsonResponse({ status: 200, body: buildUser() }))
      }
      return Promise.resolve(jsonResponse({ status: 500, body: { detail: 'boom' } }))
    })
    renderWithQuery(<SettingsAuthenticationView user={buildUser()} />)
    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith('/api/auth/password_requirements', expect.anything()),
    )

    await changePassword('short')

    await waitFor(() =>
      expect(toast.success).toHaveBeenCalledWith('Password changed', expect.anything()),
    )
  })
})

describe('SettingsAuthenticationView — two-factor', () => {
  it('enables two-factor: shows QR + secret, verifies, then reveals backup codes', async () => {
    const user = userEvent.setup()
    ;(globalThis.fetch as Mock).mockImplementation(
      withPasswordRequirements((url) => {
        if (url === '/api/users/1/2fa/setup') {
          return Promise.resolve(
            jsonResponse({
              status: 200,
              body: {
                secret: TEST_TOTP_SECRET,
                otpauth_uri: 'otpauth://x',
                qr_code: 'data:image/svg+xml;base64,abc',
              },
            }),
          )
        }
        if (url === '/api/users/1/2fa/enable') {
          return Promise.resolve(
            jsonResponse({ status: 200, body: { backup_codes: ['AAAAA-BBBBB-CCCCC'] } }),
          )
        }
        return undefined
      }),
    )

    renderWithQuery(<SettingsAuthenticationView user={buildUser({ two_factor_enabled: false })} />)

    expect(screen.getByText('Two-factor authentication is off')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Enable two-factor authentication' }))

    expect(await screen.findByText(TEST_TOTP_SECRET)).toBeInTheDocument()
    await user.type(screen.getByLabelText('Authentication code'), '123456')
    await user.click(screen.getByRole('button', { name: 'Verify and enable' }))

    expect(await screen.findByText('AAAAA-BBBBB-CCCCC')).toBeInTheDocument()
    const enableCall = (globalThis.fetch as Mock).mock.calls.find(
      ([url]) => url === '/api/users/1/2fa/enable',
    )
    expect(JSON.parse(enableCall![1].body)).toEqual({ code: '123456' })

    await user.click(screen.getByRole('button', { name: "I've saved my backup codes" }))
    expect(screen.queryByText('AAAAA-BBBBB-CCCCC')).not.toBeInTheDocument()
    expect(screen.queryByLabelText('Authentication code')).not.toBeInTheDocument()
  })

  it('cancels the two-factor setup without enabling it', async () => {
    const user = userEvent.setup()
    serveOne('POST', '/api/users/1/2fa/setup', () =>
      jsonResponse({
        status: 200,
        body: { secret: TEST_TOTP_SECRET, otpauth_uri: 'otpauth://x', qr_code: 'data:,' },
      }),
    )
    renderWithQuery(<SettingsAuthenticationView user={buildUser({ two_factor_enabled: false })} />)

    await user.click(screen.getByRole('button', { name: 'Enable two-factor authentication' }))
    await screen.findByText(TEST_TOTP_SECRET)
    await user.click(screen.getByRole('button', { name: 'Cancel' }))

    expect(screen.getByText('Two-factor authentication is off')).toBeInTheDocument()
    expect(
      (globalThis.fetch as Mock).mock.calls.some(([url]) => url === '/api/users/1/2fa/enable'),
    ).toBe(false)
  })

  it('disables two-factor by submitting a current code', async () => {
    const user = userEvent.setup()
    ;(globalThis.fetch as Mock).mockImplementation(
      withPasswordRequirements((url, init) => {
        if (url === '/api/users/1/2fa/disable' && init?.method === 'POST') {
          return Promise.resolve(new Response(null, { status: 204 }))
        }
        return undefined
      }),
    )

    renderWithQuery(<SettingsAuthenticationView user={buildUser({ two_factor_enabled: true })} />)

    expect(screen.getByText('Two-factor authentication is on')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Disable two-factor authentication' }))
    await user.type(screen.getByLabelText('Authentication code'), '654321')
    await user.click(screen.getByRole('button', { name: 'Disable' }))

    await waitFor(() => {
      const disableCall = (globalThis.fetch as Mock).mock.calls.find(
        ([url]) => url === '/api/users/1/2fa/disable',
      )
      expect(disableCall).toBeTruthy()
      expect(JSON.parse(disableCall![1].body)).toEqual({ code: '654321' })
    })
    await waitFor(() =>
      expect(toast.success).toHaveBeenCalledWith('Two-factor authentication disabled'),
    )
    expect(screen.queryByLabelText('Authentication code')).not.toBeInTheDocument()
  })

  it.each([401, 422])(
    'keeps the disable form open with an inline hint when the code is rejected (%i)',
    async (status) => {
      const user = userEvent.setup()
      serveOne('POST', '/api/users/1/2fa/disable', () =>
        jsonResponse({ status, body: { detail: 'bad code' } }),
      )
      renderWithQuery(<SettingsAuthenticationView user={buildUser({ two_factor_enabled: true })} />)

      await user.click(screen.getByRole('button', { name: 'Disable two-factor authentication' }))
      await user.type(screen.getByLabelText('Authentication code'), TWO_FACTOR_CODE)
      await user.click(screen.getByRole('button', { name: 'Disable' }))

      expect(
        await screen.findByText('That code is not correct. Please try again.'),
      ).toBeInTheDocument()
      expect(toast.error).not.toHaveBeenCalled()
    },
  )

  it('reports other failures while disabling with a toast', async () => {
    const user = userEvent.setup()
    serveOne('POST', '/api/users/1/2fa/disable', () =>
      jsonResponse({ status: 500, body: { detail: 'boom' } }),
    )
    renderWithQuery(<SettingsAuthenticationView user={buildUser({ two_factor_enabled: true })} />)

    await user.click(screen.getByRole('button', { name: 'Disable two-factor authentication' }))
    await user.type(screen.getByLabelText('Authentication code'), TWO_FACTOR_CODE)
    await user.click(screen.getByRole('button', { name: 'Disable' }))

    await waitFor(() => expect(toast.error).toHaveBeenCalledWith(GENERIC_ERROR))
    expect(screen.getByLabelText('Authentication code')).toHaveValue(TWO_FACTOR_CODE)
  })

  it('leaves two-factor on when the disable form is cancelled', async () => {
    const user = userEvent.setup()
    ;(globalThis.fetch as Mock).mockImplementation(withPasswordRequirements(() => undefined))
    renderWithQuery(<SettingsAuthenticationView user={buildUser({ two_factor_enabled: true })} />)

    await user.click(screen.getByRole('button', { name: 'Disable two-factor authentication' }))
    expect(screen.getByRole('button', { name: 'Disable' })).toBeDisabled()
    await user.click(screen.getByRole('button', { name: 'Cancel' }))

    expect(screen.getByText('Two-factor authentication is on')).toBeInTheDocument()
    expect(
      (globalThis.fetch as Mock).mock.calls.some(([url]) => url === '/api/users/1/2fa/disable'),
    ).toBe(false)
  })

  it('regenerates backup codes and reveals the new set', async () => {
    const user = userEvent.setup()
    ;(globalThis.fetch as Mock).mockImplementation(
      withPasswordRequirements((url, init) => {
        if (url === '/api/users/1/2fa/backup-codes' && init?.method === 'POST') {
          return Promise.resolve(
            jsonResponse({ status: 200, body: { backup_codes: ['ZZZZZ-YYYYY-XXXXX'] } }),
          )
        }
        return undefined
      }),
    )

    renderWithQuery(<SettingsAuthenticationView user={buildUser({ two_factor_enabled: true })} />)

    await user.click(screen.getByRole('button', { name: 'Regenerate backup codes' }))

    expect(await screen.findByText('ZZZZZ-YYYYY-XXXXX')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: "I've saved my backup codes" }))
    expect(screen.queryByText('ZZZZZ-YYYYY-XXXXX')).not.toBeInTheDocument()
    expect(screen.getByText('Two-factor authentication is on')).toBeInTheDocument()
  })

  it('keeps the old backup codes and reports the error when regenerating fails', async () => {
    const user = userEvent.setup()
    serveOne('POST', '/api/users/1/2fa/backup-codes', () =>
      jsonResponse({ status: 500, body: { detail: 'boom' } }),
    )
    renderWithQuery(<SettingsAuthenticationView user={buildUser({ two_factor_enabled: true })} />)

    await user.click(screen.getByRole('button', { name: 'Regenerate backup codes' }))

    await waitFor(() => expect(toast.error).toHaveBeenCalledWith(GENERIC_ERROR))
    expect(screen.queryByText('Save your backup codes')).not.toBeInTheDocument()
    expect(screen.getByText('Two-factor authentication is on')).toBeInTheDocument()
  })
})

describe('SettingsAuthenticationPage', () => {
  const Page = Route.options.component!

  it('shows the two-factor state of the signed-in user', async () => {
    ;(globalThis.fetch as Mock).mockImplementation(
      withPasswordRequirements((url) =>
        url === '/api/auth/me'
          ? Promise.resolve(
              jsonResponse({ status: 200, body: buildUser({ two_factor_enabled: true }) }),
            )
          : undefined,
      ),
    )

    renderWithQuery(<Page />)

    expect(await screen.findByText('Two-factor authentication is on')).toBeInTheDocument()
  })

  it('renders nothing while the signed-in user is unknown', async () => {
    ;(globalThis.fetch as Mock).mockResolvedValue(jsonResponse({ status: 401 }))

    const { container } = renderWithQuery(<Page />)

    await waitFor(() => expect(globalThis.fetch).toHaveBeenCalled())
    expect(container).toBeEmptyDOMElement()
  })
})
