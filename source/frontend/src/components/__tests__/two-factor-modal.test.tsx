import { beforeAll, describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import i18n from 'i18next'

import '@/i18n'

import { TwoFactorModal } from '@/components/two-factor-modal'
import type { Current2FA } from '@/lib/auth'

beforeAll(async () => {
  await i18n.changeLanguage('en')
})

function renderModal(props: {
  current2fa: Current2FA | null
  onSubmit?: (code: string) => Promise<void>
  onSkip?: () => void
}) {
  return render(
    <TwoFactorModal
      current2fa={props.current2fa}
      onSubmit={props.onSubmit ?? (async () => {})}
      onSkip={props.onSkip ?? (() => {})}
    />,
  )
}

describe('TwoFactorModal', () => {
  it('renders nothing when current2fa is null', () => {
    renderModal({ current2fa: null })
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('renders code-entry form for awaiting_2fa', async () => {
    const onSubmit = vi.fn().mockResolvedValue(undefined)
    renderModal({
      current2fa: {
        credentialId: 1,
        jobId: 'j',
        bank: 'trade_republic',
        kind: 'awaiting_2fa',
      },
      onSubmit,
    })
    expect(screen.getByRole('dialog')).toBeVisible()
    expect(screen.getByText(/Enter code for Trade Republic/i)).toBeVisible()
    const input = screen.getByLabelText('Code')
    await userEvent.type(input, '123456')
    await userEvent.click(screen.getByRole('button', { name: 'Confirm' }))
    expect(onSubmit).toHaveBeenCalledWith('123456')
  })

  it('renders spinner without submit for awaiting_decoupled_approval', () => {
    renderModal({
      current2fa: {
        credentialId: 1,
        jobId: 'j',
        bank: 'dkb',
        kind: 'awaiting_decoupled_approval',
      },
    })
    expect(screen.getByText(/Approve in DKB/i)).toBeVisible()
    expect(screen.queryByRole('button', { name: 'Confirm' })).toBeNull()
    // The Dialog renders in a portal — query the whole document, not the
    // RTL container, to find the spinner.
    expect(document.querySelector('.animate-spin')).not.toBeNull()
  })

  it('calls onSkip when the close button is clicked', async () => {
    const onSkip = vi.fn()
    renderModal({
      current2fa: {
        credentialId: 1,
        jobId: 'j',
        bank: 'trade_republic',
        kind: 'awaiting_2fa',
      },
      onSkip,
    })
    await userEvent.click(screen.getByRole('button', { name: 'Close' }))
    expect(onSkip).toHaveBeenCalled()
  })

  it('clears typed code when the active credential changes (skip-then-next)', async () => {
    const { rerender } = renderModal({
      current2fa: {
        credentialId: 1,
        jobId: 'job-1',
        bank: 'trade_republic',
        kind: 'awaiting_2fa',
      },
    })
    const initialInput = screen.getByLabelText('Code') as HTMLInputElement
    await userEvent.type(initialInput, '123456')
    expect(initialInput.value).toBe('123456')

    rerender(
      <TwoFactorModal
        current2fa={{
          credentialId: 2,
          jobId: 'job-2',
          bank: 'dkb',
          kind: 'awaiting_2fa',
        }}
        onSubmit={async () => {}}
        onSkip={() => {}}
      />,
    )

    const nextInput = screen.getByLabelText('Code') as HTMLInputElement
    expect(nextInput.value).toBe('')
  })
})
