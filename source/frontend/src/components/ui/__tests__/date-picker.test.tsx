import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'

import '@/i18n'

import { DatePicker, DROPDOWN_YEARS_BACK } from '@/components/ui/date-picker'
import { DATE_PREVIOUS_YEAR, DATE_TODAY } from '@/test/constants'

const DECEMBER = '11' // month option values are zero-based

describe('DatePicker', () => {
  it('jumps to another month and year via the caption instead of paging with the arrows', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()
    render(<DatePicker value={DATE_TODAY} onChange={onChange} />)

    await user.click(screen.getByRole('button'))
    const [monthSelect, yearSelect] = screen.getAllByRole('combobox')
    await user.selectOptions(monthSelect, DECEMBER)
    await user.selectOptions(yearSelect, DATE_PREVIOUS_YEAR.slice(0, 4))
    await user.click(within(screen.getByRole('grid')).getByText(DATE_PREVIOUS_YEAR.slice(8)))

    expect(onChange).toHaveBeenCalledWith(DATE_PREVIOUS_YEAR)
  })

  it('offers the last 30 years up to the current one, or up to max', async () => {
    const user = userEvent.setup()
    const currentYear = new Date().getFullYear()
    const { unmount } = render(<DatePicker value={DATE_TODAY} onChange={vi.fn()} />)
    await user.click(screen.getByRole('button'))
    const years = within(screen.getAllByRole('combobox')[1]).getAllByRole('option')
    expect(years[0]).toHaveTextContent(String(currentYear - DROPDOWN_YEARS_BACK))
    expect(years.at(-1)).toHaveTextContent(String(currentYear))
    unmount()

    render(<DatePicker value={DATE_PREVIOUS_YEAR} max={DATE_PREVIOUS_YEAR} onChange={vi.fn()} />)
    await user.click(screen.getByRole('button'))
    const limitedYears = within(screen.getAllByRole('combobox')[1]).getAllByRole('option')
    expect(limitedYears.at(-1)).toHaveTextContent(DATE_PREVIOUS_YEAR.slice(0, 4))
  })
})
