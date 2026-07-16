import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'

import { AmountInput } from '@/components/ui/amount-input'
import { Button } from '@/components/ui/button'
import { DatePicker } from '@/components/ui/date-picker'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { SingleSelectPopover } from '@/components/ui/single-select-popover'
import { FormField } from '@/components/form-field'
import {
  TRANSACTION_CATEGORIES,
  TRANSACTION_TYPES,
  useCreateTransaction,
  useUpdateTransaction,
  type TransactionCategory,
  type TransactionPatch,
  type TransactionType,
} from '@/lib/transaction'
import {
  RECURRENCE_FREQUENCIES,
  useCreateRecurringTransaction,
  useUpdateRecurringTransaction,
  type RecurrenceFrequency,
  type RecurringTransactionRead,
} from '@/lib/recurringTransaction'
import type { TransactionRead } from '@/lib/accountHistory'
import { formatAmountForInput, todayIso } from '@/lib/format'

const MONTH_DAYS = Array.from({ length: 31 }, (_, index) => index + 1)
const WEEKDAYS = [0, 1, 2, 3, 4, 5, 6] // 0 = Monday, 6 = Sunday

interface ManualTransactionFormProps {
  accountId: number
  mode: 'create' | 'edit'
  transaction?: TransactionRead
  recurringTransaction?: RecurringTransactionRead
  onDone: () => void
}

export function ManualTransactionForm({
  accountId,
  mode,
  transaction,
  recurringTransaction,
  onDone,
}: ManualTransactionFormProps) {
  const { t } = useTranslation()
  const isRecurringEdit = mode === 'edit' && !!recurringTransaction
  const seed = recurringTransaction ?? transaction
  const [date, setDate] = useState(transaction?.date ?? todayIso())
  const [amount, setAmount] = useState<number | undefined>(seed?.amount)
  const [attemptedSubmit, setAttemptedSubmit] = useState(false)
  const [purpose, setPurpose] = useState(seed?.purpose ?? '')
  const [otherParty, setOtherParty] = useState(seed?.other_party ?? '')
  const [txnType, setTxnType] = useState<TransactionType | ''>(
    (seed?.transaction_type as TransactionType | undefined) ?? '',
  )
  const [category, setCategory] = useState<TransactionCategory | ''>(
    (seed?.category as TransactionCategory | undefined) ?? '',
  )
  const [note, setNote] = useState(seed?.note ?? '')

  const [recurring, setRecurring] = useState(isRecurringEdit)
  const [frequency, setFrequency] = useState<RecurrenceFrequency>(
    recurringTransaction?.frequency ?? 'MONTHLY',
  )
  const [dayOfMonth, setDayOfMonth] = useState(
    () => recurringTransaction?.day_of_month ?? new Date().getDate(),
  )
  const [dayOfWeek, setDayOfWeek] = useState(recurringTransaction?.day_of_week ?? 0) // Monday
  const [bookToday, setBookToday] = useState(false)

  const create = useCreateTransaction(accountId)
  const update = useUpdateTransaction(accountId, transaction?.id ?? 0)
  const createRecurring = useCreateRecurringTransaction(accountId)
  const updateRecurring = useUpdateRecurringTransaction(accountId)
  const pending =
    mode === 'create'
      ? recurring
        ? createRecurring.isPending
        : create.isPending
      : isRecurringEdit
        ? updateRecurring.isPending
        : update.isPending

  const validAmount = amount !== undefined
  const parsedAmount = amount ?? 0
  const today = todayIso()
  // The backend (account_service.create_manual_transaction) hard-rejects
  // date > today, so mirror that client-side: the date picker's `max` keeps
  // the UI honest and canSubmit guards the case where the user types it.
  const validDate = /^\d{4}-\d{2}-\d{2}$/.test(date) && date <= today
  const canSubmit = validAmount && (recurring || validDate) && !pending

  const submit = async () => {
    if (!canSubmit) {
      setAttemptedSubmit(true)
      return
    }
    const trimmedPurpose = purpose.trim() === '' ? null : purpose.trim()
    const trimmedOther = otherParty.trim() === '' ? null : otherParty.trim()
    const trimmedNote = note.trim() === '' ? null : note.trim()
    const txnTypeValue = txnType === '' ? null : txnType
    const categoryValue = category === '' ? null : category

    const schedule = {
      day_of_month: frequency === 'MONTHLY' ? dayOfMonth : null,
      day_of_week: frequency === 'WEEKLY' ? dayOfWeek : null,
    }

    try {
      if (mode === 'edit' && recurringTransaction) {
        await updateRecurring.mutateAsync({
          recurringTransactionId: recurringTransaction.id,
          payload: {
            amount: parsedAmount,
            purpose: trimmedPurpose,
            other_party: trimmedOther,
            transaction_type: txnTypeValue,
            category: categoryValue,
            note: trimmedNote,
            frequency,
            ...schedule,
          },
        })
        toast.success(t('credentials.manualTransactions.recurringUpdated'))
      } else if (mode === 'create' && recurring) {
        await createRecurring.mutateAsync({
          amount: parsedAmount,
          purpose: trimmedPurpose,
          other_party: trimmedOther,
          transaction_type: txnTypeValue,
          category: categoryValue,
          note: trimmedNote,
          frequency,
          ...schedule,
          book_immediately: bookToday,
        })
        toast.success(t('credentials.manualTransactions.recurringCreated'))
      } else if (mode === 'create') {
        await create.mutateAsync({
          amount: parsedAmount,
          date,
          purpose: trimmedPurpose,
          other_party: trimmedOther,
          transaction_type: txnTypeValue,
          category: categoryValue,
          note: trimmedNote,
        })
        toast.success(t('credentials.manualTransactions.created'))
      } else {
        // Only send changed fields. The backend's manual-only gate kicks in on
        // the financial fields when a synced account tries to edit them — here
        // we already know the account is manual, but the diff still keeps the
        // PATCH minimal.
        const patch: TransactionPatch = {}
        if (parsedAmount !== transaction?.amount) patch.amount = parsedAmount
        if (date !== transaction?.date) patch.date = date
        if (trimmedPurpose !== (transaction?.purpose ?? null)) patch.purpose = trimmedPurpose
        if (trimmedOther !== (transaction?.other_party ?? null)) patch.other_party = trimmedOther
        if (txnTypeValue !== (transaction?.transaction_type ?? null))
          patch.transaction_type = txnTypeValue
        if (categoryValue && categoryValue !== transaction?.category) patch.category = categoryValue
        if (trimmedNote !== (transaction?.note ?? null)) patch.note = trimmedNote
        if (Object.keys(patch).length > 0) {
          await update.mutateAsync(patch)
        }
        toast.success(t('common.saved'))
      }
      onDone()
    } catch {
      toast.error(
        isRecurringEdit
          ? t('credentials.manualTransactions.recurringUpdateFailed')
          : mode === 'create'
            ? recurring
              ? t('credentials.manualTransactions.recurringCreateFailed')
              : t('credentials.manualTransactions.createFailed')
            : t('credentials.manualTransactions.updateFailed'),
      )
    }
  }

  const fieldIdPrefix = `txn-form-${mode}-${recurringTransaction ? 'rec' : 'txn'}-${transaction?.id ?? recurringTransaction?.id ?? 'new'}`

  return (
    <form
      onSubmit={(event) => {
        event.preventDefault()
        void submit()
      }}
      onKeyDown={(event) => {
        // Enter in a plain text/number field saves the form. The date picker is
        // a button (opens its calendar instead) and selects open their dropdown
        // via openSelectOnEnter, so those are intentionally left alone.
        if (event.key === 'Enter' && (event.target as HTMLElement).tagName === 'INPUT') {
          event.preventDefault()
          void submit()
        }
      }}
      className="border-border bg-card flex flex-col gap-3 rounded-lg border p-4"
    >
      {mode === 'create' ? (
        <div className="flex items-center justify-between gap-2">
          <Label
            htmlFor={`${fieldIdPrefix}-recurring`}
            className="text-muted-foreground cursor-pointer text-[0.65rem] font-medium uppercase tracking-wide"
          >
            {t('credentials.manualTransactions.fieldRecurring')}
          </Label>
          <Switch
            id={`${fieldIdPrefix}-recurring`}
            checked={recurring}
            onCheckedChange={setRecurring}
          />
        </div>
      ) : null}
      <div className={recurring ? '' : 'grid grid-cols-2 gap-3'}>
        {recurring ? null : (
          <FormField
            id={`${fieldIdPrefix}-date`}
            label={t('credentials.manualTransactions.fieldDate')}
          >
            <DatePicker id={`${fieldIdPrefix}-date`} value={date} max={today} onChange={setDate} />
          </FormField>
        )}
        <FormField id={`${fieldIdPrefix}-amount`} label={t('common.amount')}>
          <AmountInput
            id={`${fieldIdPrefix}-amount`}
            value={amount}
            onChange={setAmount}
            placeholder={formatAmountForInput(0)}
            aria-invalid={(attemptedSubmit && !validAmount) || undefined}
            formatOnBlur
          />
        </FormField>
      </div>
      <FormField
        id={`${fieldIdPrefix}-other`}
        label={t('credentials.manualTransactions.fieldOtherParty')}
      >
        <Input
          id={`${fieldIdPrefix}-other`}
          value={otherParty}
          onChange={(event) => setOtherParty(event.target.value)}
        />
      </FormField>
      <FormField id={`${fieldIdPrefix}-purpose`} label={t('common.purpose')}>
        <Input
          id={`${fieldIdPrefix}-purpose`}
          value={purpose}
          onChange={(event) => setPurpose(event.target.value)}
        />
      </FormField>
      <div className="grid grid-cols-2 gap-3">
        <FormField id={`${fieldIdPrefix}-type`} label={t('common.type')}>
          <SingleSelectPopover
            id={`${fieldIdPrefix}-type`}
            ariaLabel={t('common.type')}
            value={txnType}
            onChange={setTxnType}
            options={[
              { value: '', label: t('common.any') },
              ...TRANSACTION_TYPES.map((type) => ({
                value: type,
                label: t(`transactionType.${type}`),
              })),
            ]}
          />
        </FormField>
        <FormField id={`${fieldIdPrefix}-category`} label={t('common.category')}>
          <SingleSelectPopover
            id={`${fieldIdPrefix}-category`}
            ariaLabel={t('common.category')}
            value={category}
            onChange={setCategory}
            options={[
              { value: '', label: t('common.any') },
              ...TRANSACTION_CATEGORIES.map((cat) => ({
                value: cat,
                label: t(`category.${cat}`),
              })),
            ]}
          />
        </FormField>
      </div>
      <FormField id={`${fieldIdPrefix}-note`} label={t('common.note')}>
        <Input
          id={`${fieldIdPrefix}-note`}
          value={note}
          onChange={(event) => setNote(event.target.value)}
        />
      </FormField>
      {recurring ? (
        <>
          <div className="grid grid-cols-2 gap-3">
            <FormField
              id={`${fieldIdPrefix}-frequency`}
              label={t('credentials.manualTransactions.fieldFrequency')}
            >
              <SingleSelectPopover
                id={`${fieldIdPrefix}-frequency`}
                ariaLabel={t('credentials.manualTransactions.fieldFrequency')}
                value={frequency}
                onChange={setFrequency}
                options={RECURRENCE_FREQUENCIES.map((freq) => ({
                  value: freq,
                  label: t(`credentials.manualTransactions.frequency.${freq}`),
                }))}
              />
            </FormField>
            {frequency === 'MONTHLY' ? (
              <FormField
                id={`${fieldIdPrefix}-day-of-month`}
                label={t('credentials.manualTransactions.fieldDayOfMonth')}
                hint={t('credentials.manualTransactions.dayOfMonthHint')}
              >
                <SingleSelectPopover
                  id={`${fieldIdPrefix}-day-of-month`}
                  ariaLabel={t('credentials.manualTransactions.fieldDayOfMonth')}
                  value={String(dayOfMonth)}
                  onChange={(next) => setDayOfMonth(Number(next))}
                  options={MONTH_DAYS.map((day) => ({
                    value: String(day),
                    label: String(day).padStart(2, '0'),
                  }))}
                />
              </FormField>
            ) : (
              <FormField
                id={`${fieldIdPrefix}-day-of-week`}
                label={t('credentials.manualTransactions.fieldDayOfWeek')}
              >
                <SingleSelectPopover
                  id={`${fieldIdPrefix}-day-of-week`}
                  ariaLabel={t('credentials.manualTransactions.fieldDayOfWeek')}
                  value={String(dayOfWeek)}
                  onChange={(next) => setDayOfWeek(Number(next))}
                  options={WEEKDAYS.map((day) => ({
                    value: String(day),
                    label: t(`credentials.manualTransactions.weekday.${day}`),
                  }))}
                />
              </FormField>
            )}
          </div>
          {/* "Book today" is a one-off action only relevant when creating a rule. */}
          {mode === 'create' ? (
            <div className="flex items-center justify-between gap-2">
              <Label
                htmlFor={`${fieldIdPrefix}-book-today`}
                className="text-muted-foreground cursor-pointer text-[0.65rem] font-medium uppercase tracking-wide"
              >
                {t('credentials.manualTransactions.bookToday')}
              </Label>
              <Switch
                id={`${fieldIdPrefix}-book-today`}
                checked={bookToday}
                onCheckedChange={setBookToday}
              />
            </div>
          ) : null}
        </>
      ) : null}
      <div className="flex gap-2">
        <Button
          type="button"
          variant="outline"
          onClick={onDone}
          disabled={pending}
          className="flex-1"
        >
          {t('common.cancel')}
        </Button>
        {/* Enabled even when invalid so a save attempt can surface the
            validation state (e.g. an empty amount turns red). */}
        <Button type="submit" disabled={pending} className="flex-1">
          {pending ? t('common.saving') : t('common.save')}
        </Button>
      </div>
    </form>
  )
}
