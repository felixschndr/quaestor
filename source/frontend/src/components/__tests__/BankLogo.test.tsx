import { render, screen, fireEvent } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { BankLogo } from '@/components/BankLogo'

describe('BankLogo', () => {
  it('renders the image when an icon URL is provided', () => {
    const { container } = render(
      <BankLogo icon="/static/banks/sparkasse.png" name="Sparkasse München" seed="70150000" />,
    )
    const img = container.querySelector('img')
    expect(img).not.toBeNull()
    expect(img).toHaveAttribute('src', '/static/banks/sparkasse.png')
  })

  it('renders a monogram when icon is null', () => {
    const { container } = render(<BankLogo icon={null} name="Deutsche Bank" seed="10070000" />)
    expect(container.querySelector('img')).toBeNull()
    expect(screen.getByText('DB')).toBeInTheDocument()
  })

  it('falls back to a monogram when the image fails to load', () => {
    const { container } = render(
      <BankLogo icon="/static/banks/missing.png" name="Commerzbank" seed="10040000" />,
    )
    fireEvent.error(container.querySelector('img')!)
    expect(container.querySelector('img')).toBeNull()
    expect(screen.getByText('CO')).toBeInTheDocument()
  })
})
