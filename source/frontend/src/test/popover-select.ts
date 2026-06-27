import { screen, within } from '@testing-library/react'
import type { UserEvent } from '@testing-library/user-event'

export async function selectFromPopover(
  user: UserEvent,
  triggerLabel: string | RegExp,
  optionLabel: string | RegExp,
): Promise<void> {
  await user.click(screen.getByLabelText(triggerLabel))
  const list = await screen.findByRole('list', { name: triggerLabel })
  await user.click(within(list).getByRole('button', { name: optionLabel }))
}

export async function openPopoverOptions(
  user: UserEvent,
  triggerLabel: string | RegExp,
): Promise<string[]> {
  await user.click(screen.getByLabelText(triggerLabel))
  const list = await screen.findByRole('list', { name: triggerLabel })
  return within(list)
    .getAllByRole('button')
    .map((button) => button.textContent ?? '')
}
