import type { ReactNode } from 'react'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import '@/i18n'

vi.mock('sonner', () => ({ toast: { error: vi.fn(() => 'toast-id'), dismiss: vi.fn() } }))

import { toast } from 'sonner'

import i18n from '@/i18n'
import { toastSyncFailure } from '@/lib/syncToast'

const error = vi.mocked(toast.error)
const dismiss = vi.mocked(toast.dismiss)

function shownToast() {
  const [body, options] = error.mock.calls.at(-1) as [ReactNode, { action?: { label: string } }]
  return { body, options }
}

beforeEach(() => {
  error.mockClear()
  dismiss.mockClear()
})

describe('toastSyncFailure', () => {
  it('names the bank and explains the error code', () => {
    toastSyncFailure({
      t: i18n.t,
      bank: 'ING',
      credentialId: 42,
      errorCode: 'invalid_credentials',
      navigate: vi.fn(),
    })

    render(shownToast().body)
    expect(screen.getByRole('button')).toHaveTextContent("ING couldn't be synced.")
    expect(screen.getByRole('button')).toHaveTextContent('The bank rejected the login.')
  })

  it('opens the credential when the toast is clicked', async () => {
    const navigate = vi.fn()
    toastSyncFailure({ t: i18n.t, bank: 'ING', credentialId: 42, navigate })

    render(shownToast().body)
    await userEvent.click(screen.getByRole('button'))

    expect(navigate).toHaveBeenCalledWith('/settings/credentials/42')
    expect(dismiss).toHaveBeenCalledWith('toast-id')
  })

  it('leaves out the reason when the title already carries it', () => {
    toastSyncFailure({
      t: i18n.t,
      bank: 'ING',
      credentialId: 1,
      errorCode: 'rate_limited',
      navigate: vi.fn(),
    })

    render(shownToast().body)
    expect(screen.getByRole('button')).toHaveTextContent('ING received too many requests.')
    expect(screen.getByRole('button').textContent).not.toContain('blocked too many login attempts')
  })

  it('offers a retry action only when a retry was handed in', () => {
    toastSyncFailure({ t: i18n.t, bank: 'ING', credentialId: 1, navigate: vi.fn() })
    expect(shownToast().options).toBeUndefined()

    toastSyncFailure({
      t: i18n.t,
      bank: 'ING',
      credentialId: 1,
      navigate: vi.fn(),
      onRetry: vi.fn(),
    })
    expect(shownToast().options?.action?.label).toBe('Try again')
  })
})
