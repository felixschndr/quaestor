import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'

import '@/i18n'
import { CategoryMultiSelect } from '@/components/ui/category-multi-select'
import { CATEGORIES_BY_GROUP, TRANSACTION_CATEGORIES } from '@/lib/transaction'

describe('CategoryMultiSelect', () => {
  it('selects every category of a group through its heading', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()
    render(<CategoryMultiSelect selectedIds={['SALARY']} onChange={onChange} />)

    await user.click(screen.getByLabelText('Categories'))
    await user.click(screen.getByRole('checkbox', { name: 'Mobility' }))

    expect(onChange).toHaveBeenCalledWith(['SALARY', ...CATEGORIES_BY_GROUP.MOBILITY])
  })

  it('completes a partially selected group, and clears a fully selected one', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()
    const { rerender } = render(
      <CategoryMultiSelect selectedIds={['SALARY', 'FUEL']} onChange={onChange} />,
    )

    await user.click(screen.getByLabelText('Categories'))
    const heading = screen.getByRole('checkbox', { name: 'Mobility' })
    expect(heading).toHaveAttribute('data-state', 'indeterminate')
    await user.click(heading)
    expect(onChange).toHaveBeenLastCalledWith(['SALARY', ...CATEGORIES_BY_GROUP.MOBILITY])

    rerender(
      <CategoryMultiSelect
        selectedIds={['SALARY', ...CATEGORIES_BY_GROUP.MOBILITY]}
        onChange={onChange}
      />,
    )
    await user.click(screen.getByRole('checkbox', { name: 'Mobility' }))
    expect(onChange).toHaveBeenLastCalledWith(['SALARY'])
  })

  it('offers every category', async () => {
    const user = userEvent.setup()
    render(<CategoryMultiSelect selectedIds={[]} onChange={vi.fn()} />)

    await user.click(screen.getByLabelText('Categories'))

    expect(screen.getAllByRole('checkbox')).toHaveLength(
      TRANSACTION_CATEGORIES.length + Object.keys(CATEGORIES_BY_GROUP).length,
    )
  })
})
