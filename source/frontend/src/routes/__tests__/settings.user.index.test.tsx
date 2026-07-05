import { render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

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

import { SettingsUserIndexView } from '@/pages/settings.user.index'

beforeEach(async () => {
  await i18n.changeLanguage('en')
})

describe('SettingsUserIndexView', () => {
  it('renders a link to each user-settings sub-page', () => {
    render(<SettingsUserIndexView />)

    const expectedLinks: Array<[string, string]> = [
      ['Profile', '/settings/user/profile'],
      ['Appearance', '/settings/user/appearance'],
      ['Authentication', '/settings/user/authentication'],
      ['Sessions', '/settings/user/sessions'],
      ['API keys', '/settings/user/api-keys'],
      ['Delete account', '/settings/user/delete'],
    ]

    for (const [label, href] of expectedLinks) {
      const link = screen.getByRole('link', { name: new RegExp(label) })
      expect(link).toHaveAttribute('href', href)
    }
  })

  it('links back to the settings overview', () => {
    render(<SettingsUserIndexView />)

    const back = screen.getByRole('link', { name: 'Back' })
    expect(back).toHaveAttribute('href', '/settings')
  })
})
