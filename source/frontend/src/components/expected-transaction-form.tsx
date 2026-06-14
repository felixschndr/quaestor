import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { FormField, SELECT_INPUT_CLASS } from '@/components/form-field'
import {
  DEFAULT_MATCH_TOLERANCE,
  MATCH_TOLERANCES,
  useCreateExpectedTransaction,
  useUpdateExpectedTransaction,
  type ExpectedTransactionRead,
} from '@/lib/expectedTransaction'
import { formatAmountForInput } from '@/lib/format'

type Direction = 'in' | 'out'

interface ExpectedTransactionFormProps {
  accountId: number
  /** When provided, the form edits this expectation instead of creating a new one. */
  expected?: ExpectedTransactionRead
  onDone: () => void
}

export function ExpectedTransactionForm({
  accountId,
  expected,
  onDone,
}: ExpectedTransactionFormProps) {
  const { t } = useTranslation()
  const isEdit = !!expected
  const [direction, setDirection] = useState<Direction>(
    expected && expected.amount < 0 ? 'out' : 'in',
  )
  const [amount, setAmount] = useState(
    expected ? formatAmountForInput(Math.abs(expected.amount)) : '',
  )
  const [otherParty, setOtherParty] = useState(expected?.other_party ?? '')
  const [note, setNote] = useState(expected?.note ?? '')
  const [tolerance, setTolerance] = useState<number>(
    expected?.match_tolerance_percent ?? DEFAULT_MATCH_TOLERANCE,
  )
  const [attemptedSubmit, setAttemptedSubmit] = useState(false)

  const create = useCreateExpectedTransaction(accountId)
  const update = useUpdateExpectedTransaction(accountId)
  const pending = isEdit ? update.isPending : create.isPending

  // The user always enters a positive magnitude; the direction toggle sets the sign.
  const parsedAmount = Math.abs(Number(amount.replace(',', '.')))
  const validAmount = amount.trim() !== '' && Number.isFinite(parsedAmount) && parsedAmount !== 0
  const canSubmit = validAmount && !pending

  const submit = async () => {
    if (!canSubmit) {
      setAttemptedSubmit(true)
      return
    }
    const signedAmount = direction === 'out' ? -parsedAmount : parsedAmount
    const trimmedOther = otherParty.trim() === '' ? null : otherParty.trim()
    const trimmedNote = note.trim() === '' ? null : note.trim()
    const payload = {
      amount: signedAmount,
      other_party: trimmedOther,
      note: trimmedNote,
      match_tolerance_percent: tolerance,
    }
    try {
      if (expected) {
        await update.mutateAsync({ expectedTransactionId: expected.id, payload })
        toast.success(t('expectedTransactions.updated'))
      } else {
        await create.mutateAsync(payload)
        toast.success(t('expectedTransactions.created'))
      }
      onDone()
    } catch {
      toast.error(
        isEdit ? t('expectedTransactions.updateFailed') : t('expectedTransactions.createFailed'),
      )
    }
  }

  const fieldIdPrefix = `expected-form-${isEdit ? expected.id : accountId}`

  return (
    <form
      onSubmit={(event) => {
        event.preventDefault()
        void submit()
      }}
      onKeyDown={(event) => {
        const target = event.target as HTMLElement
        if (event.key === 'Enter' && target.tagName !== 'BUTTON' && target.tagName !== 'TEXTAREA') {
          event.preventDefault()
        }
      }}
      className="border-border bg-card flex flex-col gap-3 rounded-lg border p-4"
    >
      <div className="grid grid-cols-2 gap-3">
        <FormField
          id={`${fieldIdPrefix}-direction`}
          label={t('expectedTransactions.fieldDirection')}
        >
          <select
            id={`${fieldIdPrefix}-direction`}
            value={direction}
            onChange={(event) => setDirection(event.target.value as Direction)}
            className={SELECT_INPUT_CLASS}
          >
            <option value="in">{t('expectedTransactions.directionIn')}</option>
            <option value="out">{t('expectedTransactions.directionOut')}</option>
          </select>
        </FormField>
        <FormField id={`${fieldIdPrefix}-amount`} label={t('expectedTransactions.fieldAmount')}>
          <Input
            id={`${fieldIdPrefix}-amount`}
            type="text"
            inputMode="decimal"
            value={amount}
            onChange={(event) => setAmount(event.target.value)}
            onBlur={() => {
              if (validAmount) setAmount(formatAmountForInput(parsedAmount))
            }}
            placeholder={formatAmountForInput(0)}
            aria-invalid={(attemptedSubmit && !validAmount) || undefined}
          />
        </FormField>
      </div>
      <FormField
        id={`${fieldIdPrefix}-tolerance`}
        label={t('expectedTransactions.fieldTolerance')}
        hint={t('expectedTransactions.toleranceHint')}
      >
        <select
          id={`${fieldIdPrefix}-tolerance`}
          value={tolerance}
          onChange={(event) => setTolerance(Number(event.target.value))}
          className={SELECT_INPUT_CLASS}
        >
          {MATCH_TOLERANCES.map((value) => (
            <option key={value} value={value}>
              {value === 0 ? t('expectedTransactions.toleranceExact') : `± ${value} %`}
            </option>
          ))}
        </select>
      </FormField>
      <FormField id={`${fieldIdPrefix}-other`} label={t('expectedTransactions.fieldOtherParty')}>
        <Input
          id={`${fieldIdPrefix}-other`}
          value={otherParty}
          onChange={(event) => setOtherParty(event.target.value)}
        />
      </FormField>
      <FormField id={`${fieldIdPrefix}-note`} label={t('expectedTransactions.fieldNote')}>
        <Input
          id={`${fieldIdPrefix}-note`}
          value={note}
          onChange={(event) => setNote(event.target.value)}
        />
      </FormField>
      <div className="flex gap-2">
        <Button
          type="button"
          variant="outline"
          onClick={onDone}
          disabled={pending}
          className="flex-1"
        >
          {t('expectedTransactions.cancel')}
        </Button>
        <Button type="submit" disabled={pending} className="flex-1">
          {pending ? t('expectedTransactions.saving') : t('expectedTransactions.save')}
        </Button>
      </div>
    </form>
  )
}
