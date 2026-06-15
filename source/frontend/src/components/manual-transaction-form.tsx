import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { Info } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { DatePicker } from '@/components/ui/date-picker'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { FormField, SELECT_INPUT_CLASS } from '@/components/form-field'
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

function openSelectOnEnter(event: React.KeyboardEvent<HTMLSelectElement>): void {
  if (event.key !== 'Enter') return
  event.preventDefault()
  try {
    event.currentTarget.showPicker()
  } catch {
    // showPicker() isn't available in every browser; the form's keydown guard
    // still prevents an accidental submit, so there's nothing else to do.
  }
}

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
  const [amount, setAmount] = useState(
    seed?.amount !== undefined ? formatAmountForInput(seed.amount) : '',
  )
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

  const parsedAmount = Number(amount.replace(',', '.'))
  const validAmount = amount.trim() !== '' && Number.isFinite(parsedAmount)
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
        toast.success(t('credentials.manualTransactions.updated'))
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
            className="text-muted-foreground text-[0.65rem] font-medium uppercase tracking-wide"
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
        <FormField
          id={`${fieldIdPrefix}-amount`}
          label={t('credentials.manualTransactions.fieldAmount')}
        >
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
        id={`${fieldIdPrefix}-other`}
        label={t('credentials.manualTransactions.fieldOtherParty')}
      >
        <Input
          id={`${fieldIdPrefix}-other`}
          value={otherParty}
          onChange={(event) => setOtherParty(event.target.value)}
        />
      </FormField>
      <FormField
        id={`${fieldIdPrefix}-purpose`}
        label={t('credentials.manualTransactions.fieldPurpose')}
      >
        <Input
          id={`${fieldIdPrefix}-purpose`}
          value={purpose}
          onChange={(event) => setPurpose(event.target.value)}
        />
      </FormField>
      <div className="grid grid-cols-2 gap-3">
        <FormField
          id={`${fieldIdPrefix}-type`}
          label={t('credentials.manualTransactions.fieldType')}
        >
          <select
            id={`${fieldIdPrefix}-type`}
            value={txnType}
            onChange={(event) => setTxnType(event.target.value as TransactionType | '')}
            className={SELECT_INPUT_CLASS}
            onKeyDown={openSelectOnEnter}
          >
            <option value="">{t('credentials.manualTransactions.anyOption')}</option>
            {TRANSACTION_TYPES.map((type) => (
              <option key={type} value={type}>
                {t(`transactionType.${type}`)}
              </option>
            ))}
          </select>
        </FormField>
        <FormField
          id={`${fieldIdPrefix}-category`}
          label={t('credentials.manualTransactions.fieldCategory')}
        >
          <select
            id={`${fieldIdPrefix}-category`}
            value={category}
            onChange={(event) => setCategory(event.target.value as TransactionCategory | '')}
            className={SELECT_INPUT_CLASS}
            onKeyDown={openSelectOnEnter}
          >
            <option value="">{t('credentials.manualTransactions.anyOption')}</option>
            {TRANSACTION_CATEGORIES.map((cat) => (
              <option key={cat} value={cat}>
                {t(`category.${cat}`)}
              </option>
            ))}
          </select>
        </FormField>
      </div>
      <FormField id={`${fieldIdPrefix}-note`} label={t('credentials.manualTransactions.fieldNote')}>
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
              <select
                id={`${fieldIdPrefix}-frequency`}
                value={frequency}
                onChange={(event) => setFrequency(event.target.value as RecurrenceFrequency)}
                className={SELECT_INPUT_CLASS}
                onKeyDown={openSelectOnEnter}
              >
                {RECURRENCE_FREQUENCIES.map((freq) => (
                  <option key={freq} value={freq}>
                    {t(`credentials.manualTransactions.frequency.${freq}`)}
                  </option>
                ))}
              </select>
            </FormField>
            {frequency === 'MONTHLY' ? (
              <FormField
                id={`${fieldIdPrefix}-day-of-month`}
                label={t('credentials.manualTransactions.fieldDayOfMonth')}
                labelHint={<InfoHint text={t('credentials.manualTransactions.dayOfMonthHint')} />}
              >
                <select
                  id={`${fieldIdPrefix}-day-of-month`}
                  value={dayOfMonth}
                  onChange={(event) => setDayOfMonth(Number(event.target.value))}
                  className={SELECT_INPUT_CLASS}
                  onKeyDown={openSelectOnEnter}
                >
                  {MONTH_DAYS.map((day) => (
                    <option key={day} value={day}>
                      {String(day).padStart(2, '0')}
                    </option>
                  ))}
                </select>
              </FormField>
            ) : (
              <FormField
                id={`${fieldIdPrefix}-day-of-week`}
                label={t('credentials.manualTransactions.fieldDayOfWeek')}
              >
                <select
                  id={`${fieldIdPrefix}-day-of-week`}
                  value={dayOfWeek}
                  onChange={(event) => setDayOfWeek(Number(event.target.value))}
                  className={SELECT_INPUT_CLASS}
                  onKeyDown={openSelectOnEnter}
                >
                  {WEEKDAYS.map((day) => (
                    <option key={day} value={day}>
                      {t(`credentials.manualTransactions.weekday.${day}`)}
                    </option>
                  ))}
                </select>
              </FormField>
            )}
          </div>
          {/* "Book today" is a one-off action only relevant when creating a rule. */}
          {mode === 'create' ? (
            <div className="flex items-center justify-between gap-2">
              <Label
                htmlFor={`${fieldIdPrefix}-book-today`}
                className="text-muted-foreground text-[0.65rem] font-medium uppercase tracking-wide"
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
          {t('credentials.manualTransactions.cancel')}
        </Button>
        {/* Enabled even when invalid so a save attempt can surface the
            validation state (e.g. an empty amount turns red). */}
        <Button type="submit" disabled={pending} className="flex-1">
          {pending
            ? t('credentials.manualTransactions.saving')
            : t('credentials.manualTransactions.save')}
        </Button>
      </div>
    </form>
  )
}

function InfoHint({ text }: { text: string }) {
  const [open, setOpen] = useState(false)
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label={text}
          onMouseEnter={() => setOpen(true)}
          onMouseLeave={() => setOpen(false)}
          className="text-muted-foreground hover:text-foreground transition-colors"
        >
          <Info className="size-3.5" aria-hidden="true" />
        </button>
      </PopoverTrigger>
      <PopoverContent
        className="text-muted-foreground max-w-60 text-xs"
        onOpenAutoFocus={(event) => event.preventDefault()}
      >
        {text}
      </PopoverContent>
    </Popover>
  )
}
