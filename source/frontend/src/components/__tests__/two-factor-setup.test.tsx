import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { MockInstance } from 'vitest'
import { toast } from 'sonner'

import '@/i18n'

import { TwoFactorSetup, type TwoFactorSetupProps } from '@/components/two-factor-setup'
import { BACKUP_CODES, TEST_TOTP_SECRET, TWO_FACTOR_CODE } from '@/test/constants'

const SETUP_URL = '/api/users/1/2fa/setup'
const ENABLE_URL = '/api/users/1/2fa/enable'
const QR_CODE = 'data:image/svg+xml;base64,PHN2Zz4='
const SETUP = { secret: TEST_TOTP_SECRET, otpauth_uri: 'otpauth://totp/Quaestor', qr_code: QR_CODE }

let fetchMock: MockInstance<typeof fetch>

function json(status: number, body: unknown): Promise<Response> {
  return Promise.resolve(
    new Response(JSON.stringify(body), {
      status,
      headers: { 'content-type': 'application/json' },
    }),
  )
}

function serve(routes: Record<string, () => Promise<Response>>) {
  fetchMock = vi.spyOn(globalThis, 'fetch').mockImplementation((input) => {
    const route = routes[String(input)]
    return route ? route() : Promise.reject(new Error(`unexpected fetch: ${String(input)}`))
  })
}

function renderSetup(props: Partial<TwoFactorSetupProps> = {}) {
  const queryClient = new QueryClient({ defaultOptions: { mutations: { retry: false } } })
  const onFinished = vi.fn()
  render(
    <QueryClientProvider client={queryClient}>
      <TwoFactorSetup userId={1} onFinished={onFinished} {...props} />
    </QueryClientProvider>,
  )
  return { onFinished }
}

afterEach(() => {
  vi.restoreAllMocks()
})

describe('TwoFactorSetup', () => {
  it('shows a spinner until the secret arrives, then the QR code and secret', async () => {
    let respond: (response: Response) => void = () => {}
    serve({ [SETUP_URL]: () => new Promise((resolve) => (respond = resolve)) })
    renderSetup()

    expect(document.querySelector('.animate-spin')).not.toBeNull()
    expect(screen.queryByRole('img')).not.toBeInTheDocument()

    await waitFor(() => expect(fetchMock).toHaveBeenCalled())
    respond(await json(200, SETUP))

    expect(
      await screen.findByRole('img', { name: 'QR code for two-factor authentication setup' }),
    ).toHaveAttribute('src', QR_CODE)
    expect(screen.getByText(TEST_TOTP_SECRET)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Verify and enable' })).toBeDisabled()
    expect(screen.queryByRole('button', { name: 'Cancel' })).not.toBeInTheDocument()
  })

  it('copies the secret for manual entry', async () => {
    const user = userEvent.setup()
    serve({ [SETUP_URL]: () => json(200, SETUP) })
    renderSetup()

    await user.click(await screen.findByRole('button', { name: 'Copy secret' }))

    expect(await navigator.clipboard.readText()).toBe(TEST_TOTP_SECRET)
  })

  it('enables two-factor with the entered code, then shows the backup codes', async () => {
    const user = userEvent.setup()
    const success = vi.spyOn(toast, 'success')
    serve({
      [SETUP_URL]: () => json(200, SETUP),
      [ENABLE_URL]: () => json(200, { backup_codes: BACKUP_CODES }),
    })
    const { onFinished } = renderSetup()

    const input = await screen.findByLabelText('Authentication code')
    await user.type(input, ' ')
    expect(screen.getByRole('button', { name: 'Verify and enable' })).toBeDisabled()
    await user.clear(input)
    await user.type(input, TWO_FACTOR_CODE)
    await user.click(screen.getByRole('button', { name: 'Verify and enable' }))

    expect(await screen.findByText(BACKUP_CODES[0])).toBeInTheDocument()
    const enableCall = fetchMock.mock.calls.find(([url]) => url === ENABLE_URL)!
    expect(JSON.parse(String(enableCall[1]!.body))).toEqual({ code: TWO_FACTOR_CODE })
    expect(success).toHaveBeenCalledWith('Two-factor authentication enabled', {
      description: 'Other sessions signed out',
    })

    await user.click(screen.getByRole('button', { name: "I've saved my backup codes" }))
    expect(onFinished).toHaveBeenCalledOnce()
  })

  it.each([422, 401])('marks the code as wrong on HTTP %i', async (status) => {
    const user = userEvent.setup()
    serve({
      [SETUP_URL]: () => json(200, SETUP),
      [ENABLE_URL]: () => json(status, { detail: 'Invalid code' }),
    })
    renderSetup()

    const input = await screen.findByLabelText('Authentication code')
    await user.type(input, TWO_FACTOR_CODE)
    await user.click(screen.getByRole('button', { name: 'Verify and enable' }))

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'That code is not correct. Please try again.',
    )
    expect(input).toHaveAttribute('aria-invalid', 'true')
    expect(input).toHaveAccessibleDescription('That code is not correct. Please try again.')
  })

  it('shows a generic error for other failures', async () => {
    const user = userEvent.setup()
    serve({
      [SETUP_URL]: () => json(200, SETUP),
      [ENABLE_URL]: () => json(500, { detail: 'boom' }),
    })
    renderSetup()

    await user.type(await screen.findByLabelText('Authentication code'), TWO_FACTOR_CODE)
    await user.click(screen.getByRole('button', { name: 'Verify and enable' }))

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Something went wrong. Please try again.',
    )
  })

  it.each([
    [undefined, 'Cancel'],
    ['Continue without two-factor', 'Continue without two-factor'],
  ])('offers a cancel button labelled %s', async (cancelLabel, shownLabel) => {
    const onCancel = vi.fn()
    serve({ [SETUP_URL]: () => json(200, SETUP) })
    renderSetup({ onCancel, cancelLabel })

    await userEvent.click(await screen.findByRole('button', { name: shownLabel }))

    expect(onCancel).toHaveBeenCalledOnce()
  })

  it('reports a failed setup start and lets the user cancel', async () => {
    const onCancel = vi.fn()
    serve({ [SETUP_URL]: () => json(500, { detail: 'boom' }) })
    renderSetup({ onCancel })

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Could not start two-factor setup. Please try again.',
    )
    await userEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(onCancel).toHaveBeenCalledOnce()
  })

  it('reports a failed setup start without a cancel button when none is wanted', async () => {
    serve({ [SETUP_URL]: () => json(500, { detail: 'boom' }) })
    renderSetup()

    await screen.findByRole('alert')
    expect(screen.queryByRole('button')).not.toBeInTheDocument()
  })

  it('ignores a setup response that arrives after unmounting', async () => {
    let respond: (response: Response) => void = () => {}
    serve({ [SETUP_URL]: () => new Promise((resolve) => (respond = resolve)) })
    const queryClient = new QueryClient()
    const { unmount } = render(
      <QueryClientProvider client={queryClient}>
        <TwoFactorSetup userId={1} onFinished={vi.fn()} />
      </QueryClientProvider>,
    )
    const consoleError = vi.spyOn(console, 'error')

    await waitFor(() => expect(fetchMock).toHaveBeenCalled())
    unmount()
    respond(await json(200, SETUP))

    await waitFor(() =>
      expect(queryClient.getMutationCache().getAll()[0].state.status).toBe('success'),
    )
    expect(consoleError).not.toHaveBeenCalled()
  })
})
