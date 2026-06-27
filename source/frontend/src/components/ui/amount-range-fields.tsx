import { useState } from 'react'

import { AmountInput } from '@/components/ui/amount-input'
import { Label } from '@/components/ui/label'

/**
 * A linked from/to amount range. The two signs are independent, but the range
 * must stay ordered: "from +, to −" is nonsensical, so making "to" negative
 * pulls "from" negative too, and making "from" positive pushes "to" positive
 * too. Every other combo (incl. from −, to +) is left untouched.
 *
 * This sign-linking logic lives here once and is shared by transaction search
 * and the notification-rule editor.
 */
export function AmountRangeFields({
  idPrefix,
  fromLabel,
  toLabel,
  from,
  to,
  onFromChange,
  onToChange,
}: {
  idPrefix: string
  fromLabel: string
  toLabel: string
  from: number | undefined
  to: number | undefined
  onFromChange: (next: number | undefined) => void
  onToChange: (next: number | undefined) => void
}) {
  // Apply the same sign-linking invariant to the initial state: existing data
  // may carry the forbidden "from +, to −" combo, so a negative "to" pulls the
  // initial "from" sign negative too.
  const [toNegative, setToNegative] = useState<boolean>((to ?? 0) < 0)
  const [fromNegative, setFromNegative] = useState<boolean>((from ?? 0) < 0 || (to ?? 0) < 0)

  const handleFromNegativeChange = (next: boolean) => {
    setFromNegative(next)
    if (!next) setToNegative(false)
  }
  const handleToNegativeChange = (next: boolean) => {
    setToNegative(next)
    if (next) setFromNegative(true)
  }

  const fromId = `${idPrefix}-amount-from`
  const toId = `${idPrefix}-amount-to`

  return (
    <div className="grid grid-cols-2 gap-3">
      <div className="flex flex-col gap-1.5">
        <Label htmlFor={fromId}>{fromLabel}</Label>
        <AmountInput
          id={fromId}
          value={from}
          onChange={onFromChange}
          negative={fromNegative}
          onNegativeChange={handleFromNegativeChange}
        />
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor={toId}>{toLabel}</Label>
        <AmountInput
          id={toId}
          value={to}
          onChange={onToChange}
          negative={toNegative}
          onNegativeChange={handleToNegativeChange}
        />
      </div>
    </div>
  )
}
