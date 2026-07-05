import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Mock } from 'vitest'

import '@/i18n'
import i18n from 'i18next'

vi.mock('@tanstack/react-router', () => ({
  Link: ({
    to,
    children,
    ...rest
  }: { to: string; children: React.ReactNode } & React.AnchorHTMLAttributes<HTMLAnchorElement>) => (
    <a href={to} {...rest}>
      {children}
    </a>
  ),
  createFileRoute: () => () => ({}),
}))

import { SettingsAuthenticationView } from '@/pages/settings.user.authentication'
import {
  PASSWORD_REQUIREMENTS,
  buildUser,
  jsonResponse,
  renderWithQuery,
} from './-settingsUserTestHelpers'

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

afterEach(() => {
  vi.restoreAllMocks()
})

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
                secret: 'JBSWY3DPEHPK3PXP',
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

    expect(await screen.findByText('JBSWY3DPEHPK3PXP')).toBeInTheDocument()
    await user.type(screen.getByLabelText('Authentication code'), '123456')
    await user.click(screen.getByRole('button', { name: 'Verify and enable' }))

    expect(await screen.findByText('AAAAA-BBBBB-CCCCC')).toBeInTheDocument()
    const enableCall = (globalThis.fetch as Mock).mock.calls.find(
      ([url]) => url === '/api/users/1/2fa/enable',
    )
    expect(JSON.parse(enableCall![1].body)).toEqual({ code: '123456' })
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
  })
})
