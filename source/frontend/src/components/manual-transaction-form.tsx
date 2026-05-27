import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { formatDecimal } from '@/lib/format'
import {
  TRANSACTION_CATEGORIES,
  TRANSACTION_TYPES,
  useCreateTransaction,
  useUpdateTransaction,
  type TransactionCategory,
  type TransactionPatch,
  type TransactionType,
} from '@/lib/transaction'
import type { TransactionRead } from '@/lib/accountHistory'

function todayIso(): string {
  const now = new Date()
  const y = now.getFullYear()
  const m = String(now.getMonth() + 1).padStart(2, '0')
  const d = String(now.getDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
}

interface ManualTransactionFormProps {
  accountId: number
  mode: 'create' | 'edit'
  /** Required in 'edit' mode — the txn to seed defaults from and PATCH. */
  transaction?: TransactionRead
  onDone: () => void
}

/**
 * Form for creating or editing a manual transaction. Used in two places: the
 * account detail page's "add transaction" affordance and per-row edit toggles.
 * Mode is the only thing that differs — the field layout, validation, and
 * change-tracking logic are shared.
 */
export function ManualTransactionForm({
  accountId,
  mode,
  transaction,
  onDone,
}: ManualTransactionFormProps) {
  const { t } = useTranslation()
  const [date, setDate] = useState(transaction?.date ?? todayIso())
  const [amount, setAmount] = useState(
    transaction?.amount !== undefined ? String(transaction.amount) : '',
  )
  const [purpose, setPurpose] = useState(transaction?.purpose ?? '')
  const [otherParty, setOtherParty] = useState(transaction?.other_party ?? '')
  const [txnType, setTxnType] = useState<TransactionType | ''>(
    (transaction?.transaction_type as TransactionType | undefined) ?? '',
  )
  const [category, setCategory] = useState<TransactionCategory | ''>(
    (transaction?.category as TransactionCategory | undefined) ?? '',
  )
  const [note, setNote] = useState(transaction?.note ?? '')

  const create = useCreateTransaction(accountId)
  const update = useUpdateTransaction(accountId, transaction?.id ?? 0)
  const pending = mode === 'create' ? create.isPending : update.isPending

  const parsedAmount = Number(amount.replace(',', '.'))
  const validAmount = amount.trim() !== '' && Number.isFinite(parsedAmount)
  const today = todayIso()
  // The backend (account_service.create_manual_transaction) hard-rejects
  // date > today, so mirror that client-side: the date picker's `max` keeps
  // the UI honest and canSubmit guards the case where the user types it.
  const validDate = /^\d{4}-\d{2}-\d{2}$/.test(date) && date <= today
  const canSubmit = validAmount && validDate && !pending

  const submit = async () => {
    if (!canSubmit) return
    const trimmedPurpose = purpose.trim() === '' ? null : purpose.trim()
    const trimmedOther = otherParty.trim() === '' ? null : otherParty.trim()
    const trimmedNote = note.trim() === '' ? null : note.trim()
    const txnTypeValue = txnType === '' ? null : txnType
    const categoryValue = category === '' ? null : category

    try {
      if (mode === 'create') {
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
        mode === 'create'
          ? t('credentials.manualTransactions.createFailed')
          : t('credentials.manualTransactions.updateFailed'),
      )
    }
  }

  const fieldIdPrefix = `txn-form-${mode}-${transaction?.id ?? 'new'}`

  return (
    <form
      onSubmit={(event) => {
        event.preventDefault()
        void submit()
      }}
      className="border-border bg-card flex flex-col gap-3 rounded-lg border p-4"
    >
      <div className="grid grid-cols-2 gap-3">
        <FormField
          id={`${fieldIdPrefix}-date`}
          label={t('credentials.manualTransactions.fieldDate')}
        >
          <Input
            id={`${fieldIdPrefix}-date`}
            type="date"
            value={date}
            max={today}
            onChange={(event) => setDate(event.target.value)}
            aria-invalid={!validDate || undefined}
          />
        </FormField>
        <FormField
          id={`${fieldIdPrefix}-amount`}
          label={t('credentials.manualTransactions.fieldAmount')}
        >
          <Input
            id={`${fieldIdPrefix}-amount`}
            type="number"
            inputMode="decimal"
            step="0.01"
            value={amount}
            onChange={(event) => setAmount(event.target.value)}
            placeholder={formatDecimal(0)}
            aria-invalid={!validAmount || undefined}
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
            className="border-input bg-background h-9 rounded-md border px-2 text-sm"
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
            className="border-input bg-background h-9 rounded-md border px-2 text-sm"
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
      <div className="flex gap-2">
        <Button type="submit" disabled={!canSubmit}>
          {pending
            ? t('credentials.manualTransactions.saving')
            : t('credentials.manualTransactions.save')}
        </Button>
        <Button type="button" variant="outline" onClick={onDone} disabled={pending}>
          {t('credentials.manualTransactions.cancel')}
        </Button>
      </div>
    </form>
  )
}

function FormField({
  id,
  label,
  children,
}: {
  id: string
  label: string
  children: React.ReactNode
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <Label
        htmlFor={id}
        className="text-muted-foreground text-[0.65rem] font-medium uppercase tracking-wide"
      >
        {label}
      </Label>
      {children}
    </div>
  )
}
