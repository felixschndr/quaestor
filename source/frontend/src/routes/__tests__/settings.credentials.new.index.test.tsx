import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import '@/i18n'

vi.mock('@tanstack/react-router', () => ({
  Link: ({
    to,
    params,
    children,
    ...rest
  }: {
    to: string
    params?: Record<string, string>
    children: React.ReactNode
  } & React.AnchorHTMLAttributes<HTMLAnchorElement>) => {
    let href = to
    if (params)
      for (const [key, value] of Object.entries(params)) href = href.replace(`$${key}`, value)
    return (
      <a href={href} {...rest}>
        {children}
      </a>
    )
  },
  createFileRoute: () => () => ({}),
}))

import { BankPickerView } from '@/routes/settings.credentials.new.index'

describe('BankPickerView', () => {
  it('renders one link per bank and sorts them alphabetically by localised title', () => {
    render(
      <BankPickerView
        isLoading={false}
        isError={false}
        existingAccountCounts={{}}
        banks={[
          {
            name: 'trade_republic',
            required_fields: ['phone', 'pin'],
            icon: '/static/banks/trade_republic.png',
          },
          { name: 'ing', required_fields: ['username', 'password'], icon: '/static/banks/ing.png' },
          {
            name: 'dfs',
            required_fields: ['username', 'password'],
            icon: '/static/banks/dfs.png',
          },
        ]}
      />,
    )

    const items = screen.getAllByRole('listitem')
    expect(items.map((item) => item.textContent)).toEqual([
      expect.stringContaining('DFS'),
      expect.stringContaining('ING'),
      expect.stringContaining('Trade Republic'),
    ])
    expect(screen.getByRole('link', { name: /ING/ })).toHaveAttribute(
      'href',
      '/settings/credentials/new/ing',
    )
    expect(screen.getByRole('link', { name: /DFS/ })).toHaveAttribute(
      'href',
      '/settings/credentials/new/dfs',
    )
  })

  it('renders the loading state while the banks query is in flight', () => {
    render(
      <BankPickerView isLoading={true} isError={false} banks={[]} existingAccountCounts={{}} />,
    )
    expect(screen.getByText('Loading…')).toBeInTheDocument()
  })

  it('renders an error message when the query failed', () => {
    render(
      <BankPickerView isLoading={false} isError={true} banks={[]} existingAccountCounts={{}} />,
    )
    expect(screen.getByText('Something went wrong. Please try again.')).toBeInTheDocument()
  })

  it('renders an empty-state message when the bank list is empty', () => {
    render(
      <BankPickerView isLoading={false} isError={false} banks={[]} existingAccountCounts={{}} />,
    )
    expect(screen.getByText('No banks available.')).toBeInTheDocument()
  })

  it('includes a back link to the credentials list', () => {
    render(
      <BankPickerView isLoading={false} isError={false} banks={[]} existingAccountCounts={{}} />,
    )
    expect(screen.getByRole('link', { name: 'Back' })).toHaveAttribute(
      'href',
      '/settings/credentials',
    )
  })

  it('shows the account count under each bank, falling back to zero when missing', () => {
    render(
      <BankPickerView
        isLoading={false}
        isError={false}
        existingAccountCounts={{ ing: 4, dfs: 1 }}
        banks={[
          { name: 'ing', required_fields: ['username', 'password'], icon: '/static/banks/ing.png' },
          { name: 'dfs', required_fields: ['username', 'password'], icon: '/static/banks/dfs.png' },
          {
            name: 'trade_republic',
            required_fields: ['phone', 'pin'],
            icon: '/static/banks/trade_republic.png',
          },
        ]}
      />,
    )
    expect(screen.getByRole('link', { name: /ING/ })).toHaveTextContent('4 accounts already added')
    expect(screen.getByRole('link', { name: /DFS/ })).toHaveTextContent('1 account already added')
    expect(screen.getByRole('link', { name: /Trade Republic/ })).toHaveTextContent(
      'No accounts added yet',
    )
  })
})
