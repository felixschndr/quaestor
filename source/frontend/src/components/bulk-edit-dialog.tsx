import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Label } from '@/components/ui/label'
import { SingleSelectPopover } from '@/components/ui/single-select-popover'
import type { TransactionRead } from '@/lib/accountHistory'
import type { AccountWithBank } from '@/lib/accountDisplayGroups'
import { useCategoryCatalog } from '@/lib/categoryCatalog'
import { useCategoryOptions } from '@/lib/categoryIcons'
import { useContracts } from '@/lib/contract'
import { isManualBank } from '@/lib/credentials'
import { formatDate, formatMoney, transactionPartyName } from '@/lib/format'
import { TRANSACTION_TYPES, type CategoryKey, type TransactionType } from '@/lib/transaction'
import { useBulkUpdateTransactions, type TransactionBulkPatch } from '@/lib/transactionBulkEdit'

const UNCHANGED = ''
const AUTOMATIC = 'automatic'
const NO_CONTRACT = 'none'
const NEW_NOTE = 'new'
const REMOVE_NOTES = 'remove'
const EMPTY = '—'

interface Change {
  label: string
  from: string
  to: string
}

export function BulkEditDialog({
  transactions,
  accountById,
  onClose,
  onApplied,
}: {
  transactions: TransactionRead[]
  accountById: Map<number, AccountWithBank>
  onClose: () => void
  onApplied: () => void
}) {
  const { t } = useTranslation()
  const catalog = useCategoryCatalog()
  const categoryOptions = useCategoryOptions()
  const { data: contracts } = useContracts()
  const bulkUpdate = useBulkUpdateTransactions()

  const [category, setCategory] = useState<string>(UNCHANGED)
  const [noteMode, setNoteMode] = useState<string>(UNCHANGED)
  const [note, setNote] = useState('')
  const [type, setType] = useState<string>(UNCHANGED)
  const [contract, setContract] = useState<string>(UNCHANGED)
  const [confirming, setConfirming] = useState(false)

  const accountIds = [...new Set(transactions.map((transaction) => transaction.account_id))]
  const accounts = accountIds.map((id) => accountById.get(id))
  const allOwned = accounts.every((account) => account !== undefined && !account.shared)
  const canChangeType = allOwned && accounts.every((account) => isManualBank(account?.bank))
  const contractAccountId = allOwned && accountIds.length === 1 ? accountIds[0] : null
  const contractCandidates = (contracts ?? []).filter(
    (candidate) => candidate.account_id === contractAccountId,
  )

  const typeOptions = useMemo(
    () =>
      TRANSACTION_TYPES.map((value) => ({
        value,
        label: t(`common.transactionLabel.${value}`),
      })).sort((a, b) => a.label.localeCompare(b.label)),
    [t],
  )

  const patch: TransactionBulkPatch = {}
  if (category === AUTOMATIC) patch.category = null
  else if (category !== UNCHANGED) patch.category = category as CategoryKey
  if (noteMode === REMOVE_NOTES) patch.note = null
  else if (noteMode === NEW_NOTE && note.trim() !== '') patch.note = note
  if (type !== UNCHANGED) patch.transaction_type = type as TransactionType
  if (contract === NO_CONTRACT) patch.contract_id = null
  else if (contract !== UNCHANGED) patch.contract_id = Number(contract)
  const hasChanges = Object.keys(patch).length > 0

  const quoted = (text: string | null | undefined) =>
    text ? t('bulkEdit.quoted', { text }) : EMPTY
  const typeLabel = (value: string | null | undefined) =>
    value ? t(`common.transactionLabel.${value}`) : EMPTY
  const contractName = (contractId: number | null | undefined) =>
    (contracts ?? []).find((candidate) => candidate.id === contractId)?.name ?? EMPTY
  // Every chosen field of this transaction, including the ones that are already set that way
  const changesOf = (transaction: TransactionRead): Change[] =>
    [
      'category' in patch && {
        label: t('common.category'),
        from: catalog.label(transaction.category),
        to: patch.category ? catalog.label(patch.category) : t('bulkEdit.categoryAutomatic'),
      },
      'note' in patch && {
        label: t('common.note'),
        from: quoted(transaction.note),
        to: quoted(patch.note),
      },
      'transaction_type' in patch && {
        label: t('common.type'),
        from: typeLabel(transaction.transaction_type),
        to: typeLabel(patch.transaction_type),
      },
      'contract_id' in patch && {
        label: t('contracts.contract'),
        from: contractName(transaction.contract_id),
        to: contractName(patch.contract_id),
      },
    ].filter((change): change is Change => change !== false)
  const changingTransactions = transactions.filter((transaction) =>
    changesOf(transaction).some((change) => change.from !== change.to),
  )

  const apply = async () => {
    try {
      await bulkUpdate.mutateAsync({
        transactionIds: changingTransactions.map((transaction) => transaction.id),
        patch,
      })
    } catch {
      toast.error(t('bulkEdit.failed'))
      return
    }
    toast.success(t('bulkEdit.success', { count: changingTransactions.length }))
    onApplied()
  }

  return (
    <Dialog open onOpenChange={(open) => (open ? null : onClose())}>
      <DialogContent className="max-w-[calc(var(--container-page)-2rem)]">
        <DialogHeader>
          <DialogTitle>
            {confirming
              ? t('bulkEdit.confirmTitle')
              : t('bulkEdit.title', { count: transactions.length })}
          </DialogTitle>
        </DialogHeader>

        {confirming ? (
          <ul className="flex max-h-80 flex-col gap-3 overflow-y-auto text-sm">
            {transactions.map((transaction) => {
              const changes = changesOf(transaction)
              const purpose = transaction.purpose?.trim()
              return (
                <li key={transaction.id} className="flex flex-col gap-0.5">
                  <span className="flex justify-between gap-2 font-medium">
                    <span className="truncate">
                      {transactionPartyName(transaction) || t('common.unknown')}
                    </span>
                    <span className="tabular-nums">{formatMoney(transaction.amount)}</span>
                  </span>
                  <span className="text-muted-foreground truncate text-xs">
                    {purpose
                      ? `${formatDate(transaction.date)} · ${purpose}`
                      : formatDate(transaction.date)}
                  </span>
                  {changes.map((change) =>
                    change.from !== change.to ? (
                      <span key={change.label} className="text-xs">
                        <span className="text-muted-foreground">{change.label}: </span>
                        <span>
                          <span className="text-destructive">{change.from}</span>
                          {' → '}
                          <span className="text-success">{change.to}</span>
                        </span>
                      </span>
                    ) : (
                      <span key={change.label} className="text-muted-foreground text-xs">
                        {change.label}: {change.from} → {change.to} {t('bulkEdit.noChange')}
                      </span>
                    ),
                  )}
                </li>
              )
            })}
          </ul>
        ) : (
          <div className="flex flex-col gap-4">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="bulk-edit-category">{t('common.category')}</Label>
              <SingleSelectPopover
                id="bulk-edit-category"
                ariaLabel={t('common.category')}
                value={category}
                onChange={setCategory}
                options={[
                  { value: UNCHANGED, label: t('bulkEdit.unchanged') },
                  { value: AUTOMATIC, label: t('bulkEdit.categoryAutomatic') },
                  ...categoryOptions,
                ]}
                searchPlaceholder={t('search.filterPlaceholder')}
              />
            </div>

            <hr className="border-border" />

            <div className="flex flex-col gap-1.5">
              <Label htmlFor={canChangeType ? 'bulk-edit-type' : undefined}>
                {t('common.type')}
              </Label>
              {canChangeType ? (
                <SingleSelectPopover
                  id="bulk-edit-type"
                  ariaLabel={t('common.type')}
                  value={type}
                  onChange={setType}
                  options={[{ value: UNCHANGED, label: t('bulkEdit.unchanged') }, ...typeOptions]}
                />
              ) : (
                <p className="text-muted-foreground text-sm">{t('bulkEdit.typeOnlyManual')}</p>
              )}
            </div>

            <hr className="border-border" />

            <div className="flex flex-col gap-1.5">
              <Label htmlFor={contractAccountId !== null ? 'bulk-edit-contract' : undefined}>
                {t('contracts.contract')}
              </Label>
              {contractAccountId !== null ? (
                <SingleSelectPopover
                  id="bulk-edit-contract"
                  ariaLabel={t('contracts.contract')}
                  value={contract}
                  onChange={setContract}
                  options={[
                    { value: UNCHANGED, label: t('bulkEdit.unchanged') },
                    { value: NO_CONTRACT, label: t('contracts.noContract') },
                    ...contractCandidates.map((candidate) => ({
                      value: String(candidate.id),
                      label: candidate.name,
                    })),
                  ]}
                />
              ) : (
                <p className="text-muted-foreground text-sm">
                  {t('bulkEdit.contractOnlyOneAccount')}
                </p>
              )}
            </div>

            <hr className="border-border" />

            <div className="flex flex-col gap-1.5">
              <Label htmlFor="bulk-edit-note">{t('common.note')}</Label>
              <SingleSelectPopover
                id="bulk-edit-note"
                ariaLabel={t('common.note')}
                value={noteMode}
                onChange={setNoteMode}
                options={[
                  { value: UNCHANGED, label: t('bulkEdit.unchanged') },
                  { value: NEW_NOTE, label: t('bulkEdit.newNote') },
                  { value: REMOVE_NOTES, label: t('bulkEdit.removeNotes') },
                ]}
              />
              {noteMode === NEW_NOTE ? (
                <textarea
                  aria-label={t('bulkEdit.newNote')}
                  value={note}
                  onChange={(event) => setNote(event.target.value)}
                  placeholder={t('note.placeholder')}
                  className="border-input focus-visible:border-ring focus-visible:ring-ring/50 min-h-16 w-full rounded-lg border bg-transparent px-2.5 py-1.5 text-base lg:text-sm outline-none transition-colors focus-visible:ring-3 dark:bg-input/30"
                />
              ) : null}
            </div>
          </div>
        )}

        <div className="flex justify-end gap-2">
          {confirming ? (
            <>
              <Button
                variant="ghost"
                disabled={bulkUpdate.isPending}
                onClick={() => setConfirming(false)}
              >
                {t('common.back')}
              </Button>
              <Button
                pending={bulkUpdate.isPending}
                disabled={changingTransactions.length === 0}
                onClick={() => void apply()}
              >
                {t('bulkEdit.apply', { count: changingTransactions.length })}
              </Button>
            </>
          ) : (
            <>
              <Button variant="ghost" onClick={onClose}>
                {t('common.cancel')}
              </Button>
              <Button disabled={!hasChanges} onClick={() => setConfirming(true)}>
                {t('common.continue')}
              </Button>
            </>
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}
