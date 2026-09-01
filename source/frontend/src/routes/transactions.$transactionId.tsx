import { type ReactNode, useRef } from 'react'
import { Link, createFileRoute, useNavigate } from '@tanstack/react-router'
import { useTranslation } from 'react-i18next'
import { ArrowLeftRight, Download, Paperclip, Plus, Trash2 } from 'lucide-react'
import { toast } from 'sonner'
import { z } from 'zod'

import type { TransactionDetailRead, TransactionRead } from '@/lib/accountHistory'
import { findAccountInUser } from '@/lib/accountHistory'
import { formatDate, formatMoney } from '@/lib/format'
import {
  useLinkTransfer,
  useTransaction,
  useTransactionById,
  useUpdateTransaction,
  useUnlinkTransfer,
  type TransactionCategory,
} from '@/lib/transaction'
import { useAuthMe } from '@/lib/auth'
import { useContracts, useSetTransactionContract } from '@/lib/contract'
import {
  attachmentDownloadUrl,
  useAttachments,
  useDeleteAttachment,
  useUploadAttachments,
} from '@/lib/attachment'
import { useAppSettings } from '@/lib/settings'
import { ApiError } from '@/lib/api'
import { Button } from '@/components/ui/button'
import { SingleSelectPopover } from '@/components/ui/single-select-popover'
import {
  DetailRow,
  TransactionDetailView,
  transferPartnerLabel,
} from '@/pages/transactions.$transactionId'
import { BackLink } from '@/components/back-link'

const searchParamsSchema = z.object({
  link_account_id: z.coerce.number().optional(),
  link_transaction_id: z.coerce.number().optional(),
})

export const Route = createFileRoute('/transactions/$transactionId')({
  component: TransactionDetailPage,
  validateSearch: (search) => searchParamsSchema.parse(search),
})

function TransactionDetailPage() {
  const { transactionId: rawTransactionId } = Route.useParams()
  const transactionId = Number(rawTransactionId)
  const search = Route.useSearch()
  const query = useTransactionById(transactionId)
  const accountId = query.data?.account_id ?? 0
  const update = useUpdateTransaction(accountId, transactionId)
  const unlink = useUnlinkTransfer()
  const { data: user } = useAuthMe()

  if (query.isLoading) return null
  if (!query.data) return <TransactionNotFoundView />

  const found = findAccountInUser(user, accountId)
  const permission = found?.sharePermission ?? null
  const isOwner = permission === null
  const canWrite = isOwner || permission === 'write'
  const account = found?.account
  const accountName = account ? account.display_name?.trim() || account.name : null

  const toFlowMember = (
    transaction: TransactionRead,
    resolved: ReturnType<typeof findAccountInUser>,
    isCurrent: boolean,
  ): FlowMemberView => {
    const resolvedAccount = resolved?.account ?? null
    return {
      transaction,
      accountName: resolvedAccount
        ? resolvedAccount.display_name?.trim() || resolvedAccount.name
        : null,
      bankName: resolved?.bankName ?? null,
      bankIcon: resolved?.bankIcon ?? null,
      isMarketValued: resolvedAccount?.is_market_valued ?? false,
      isCurrent,
      isAccessible: resolvedAccount !== null,
    }
  }

  const flowMembers: FlowMemberView[] =
    query.data.flow_members.length > 0
      ? [
          toFlowMember(query.data, found, true),
          ...query.data.flow_members.map((member) =>
            toFlowMember(member, findAccountInUser(user, member.account_id), false),
          ),
        ].sort(compareFlowMembers)
      : []

  const linkSource =
    search.link_account_id !== undefined && search.link_transaction_id !== undefined
      ? { accountId: search.link_account_id, transactionId: search.link_transaction_id }
      : null
  const viewingLinkSourceItself =
    linkSource?.accountId === accountId && linkSource?.transactionId === transactionId
  const canStartLink = linkSource === null && !query.data.pending && isOwner
  const allAccountIds =
    user?.credentials
      .filter((credential) => !credential.shared_from)
      .flatMap((credential) => credential.accounts.map((a) => a.id)) ?? []

  return (
    <TransactionDetailView
      key={`${accountId}-${transactionId}`}
      accountId={accountId}
      transaction={query.data}
      accountName={accountName}
      bankName={found?.bankName ?? null}
      bankIcon={found?.bankIcon ?? null}
      flowMembers={flowMembers}
      linking={linkSource !== null}
      canWrite={canWrite}
      canUnlink={isOwner}
      onSaveNote={(note) => update.mutateAsync({ note })}
      onChangeCategory={(category) => update.mutateAsync({ category })}
      onUnlink={(transaction) =>
        unlink.mutateAsync({ accountId: transaction.account_id, transactionId: transaction.id })
      }
      contractSection={
        query.data.pending || !isOwner ? undefined : <ContractSection transaction={query.data} />
      }
      attachmentsSection={
        query.data.pending ? undefined : (
          <AttachmentSection
            accountId={accountId}
            transactionId={transactionId}
            canWrite={canWrite}
          />
        )
      }
      linkSection={
        canStartLink ? (
          <LinkStartSection
            accountId={accountId}
            transactionId={transactionId}
            amount={query.data.amount}
            allAccountIds={allAccountIds}
          />
        ) : undefined
      }
      linkConfirmSection={
        linkSource && !viewingLinkSourceItself && !query.data.pending && isOwner ? (
          <LinkConfirmSection source={linkSource} targetAccountId={accountId} target={query.data} />
        ) : undefined
      }
    />
  )
}

function LinkStartSection({
  accountId,
  transactionId,
  amount,
  allAccountIds,
}: {
  accountId: number
  transactionId: number
  amount: number
  allAccountIds: number[]
}) {
  const { t } = useTranslation()
  const counterpartAmount = -amount
  return (
    <Button asChild variant="outline" size="sm" className="self-start">
      <Link
        to="/search"
        search={{
          account_ids: allAccountIds,
          link_account_id: accountId,
          link_transaction_id: transactionId,
          amount_from: counterpartAmount,
          amount_to: counterpartAmount,
        }}
      >
        <ArrowLeftRight className="size-4" aria-hidden="true" />
        {t('transaction.linkStart')}
      </Link>
    </Button>
  )
}

function LinkConfirmSection({
  source,
  targetAccountId,
  target,
}: {
  source: { accountId: number; transactionId: number }
  targetAccountId: number
  target: TransactionDetailRead
}) {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const { data: user } = useAuthMe()
  const sourceQuery = useTransaction(source.accountId, source.transactionId)
  const link = useLinkTransfer(source.accountId, source.transactionId)

  const sourceTransaction = sourceQuery.data
  if (!sourceTransaction) return null
  if (sourceTransaction.pending) return null

  const sourceAccount = findAccountInUser(user, source.accountId)?.account
  const sourceAccountName = sourceAccount
    ? sourceAccount.display_name?.trim() || sourceAccount.name
    : null
  const sourcePartnerLabel =
    transferPartnerLabel(sourceTransaction.other_party, sourceAccountName) ??
    t('transaction.linkedAccountUnknown')

  const confirm = () => {
    toast.promise(
      link
        .mutateAsync({
          counterpartAccountId: targetAccountId,
          counterpartTransactionId: target.id,
        })
        .then(() =>
          navigate({
            to: '/transactions/$transactionId',
            params: { transactionId: String(source.transactionId) },
          }),
        ),
      {
        loading: t('common.saving'),
        success: t('transaction.linkSuccess'),
        error: t('transaction.linkFailed'),
      },
    )
  }

  return (
    <section className="border-border bg-muted/40 flex flex-wrap items-center justify-between gap-3 rounded-lg border p-4">
      <p className="text-sm">
        {t('transaction.linkConfirmPrompt', {
          partner: sourcePartnerLabel,
          amount: formatMoney(sourceTransaction.amount),
          date: formatDate(sourceTransaction.date),
        })}
      </p>
      <Button type="button" size="sm" disabled={link.isPending} onClick={confirm}>
        <ArrowLeftRight className="size-4" aria-hidden="true" />
        {t('transaction.linkStart')}
      </Button>
    </section>
  )
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  const kb = bytes / 1024
  if (kb < 1024) return `${Math.round(kb)} KB`
  return `${(kb / 1024).toFixed(1)} MB`
}

function AttachmentSection({
  accountId,
  transactionId,
  canWrite,
}: {
  accountId: number
  transactionId: number
  canWrite: boolean
}) {
  const { t } = useTranslation()
  const inputRef = useRef<HTMLInputElement>(null)
  const { data: settings } = useAppSettings()
  const allowedExtensions = settings?.allowed_attachment_extensions ?? []
  const maxSizeMb = settings?.max_attachment_size_mb ?? 0
  const accept = allowedExtensions.map((extension) => `.${extension}`).join(',')
  const { data: attachments } = useAttachments(accountId, transactionId)
  const upload = useUploadAttachments(accountId, transactionId)
  const remove = useDeleteAttachment(accountId, transactionId)

  const fileExtension = (name: string) => name.split('.').pop()?.toLowerCase() ?? ''

  const onPick = (fileList: FileList | null) => {
    const files = fileList ? Array.from(fileList) : []
    if (files.length === 0) return
    if (inputRef.current) inputRef.current.value = ''

    const wrongType = files.find((file) => !allowedExtensions.includes(fileExtension(file.name)))
    if (allowedExtensions.length > 0 && wrongType) {
      toast.error(t('attachments.rejectedType'))
      return
    }
    const tooLarge = files.find((file) => maxSizeMb > 0 && file.size > maxSizeMb * 1024 * 1024)
    if (tooLarge) {
      toast.error(t('attachments.rejectedSize', { max: maxSizeMb }))
      return
    }

    upload.mutate(files, {
      onError: (error) => {
        if (error instanceof ApiError && error.status === 415) {
          toast.error(t('attachments.rejectedType'))
        } else if (error instanceof ApiError && error.status === 413) {
          toast.error(
            maxSizeMb > 0
              ? t('attachments.rejectedSize', { max: maxSizeMb })
              : t('attachments.rejectedSizeGeneric'),
          )
        } else {
          toast.error(t('attachments.uploadFailed'))
        }
      },
    })
  }

  const addButton = !canWrite ? null : (
    <Button
      type="button"
      variant="outline"
      size="sm"
      className="self-start"
      disabled={upload.isPending}
      onClick={() => inputRef.current?.click()}
    >
      <Plus className="size-4" aria-hidden="true" />
      {t('attachments.add')}
    </Button>
  )
  const hasAttachments = attachments && attachments.length > 0

  return (
    <DetailRow label={t('attachments.label')} align="start">
      <div className="flex w-full flex-col gap-2">
        {hasAttachments ? (
          <ul className="flex flex-col gap-1">
            {attachments.map((attachment) => (
              <li key={attachment.id} className="flex items-center gap-2">
                <Paperclip className="text-muted-foreground size-4 shrink-0" aria-hidden="true" />
                <div className="flex min-w-0 flex-1 flex-wrap items-baseline gap-x-2">
                  <a
                    href={attachmentDownloadUrl(accountId, transactionId, attachment.id)}
                    download={attachment.filename}
                    className="text-primary hover:text-primary/80 inline-flex min-w-0 items-center gap-1.5 transition-colors"
                  >
                    <span className="truncate">{attachment.filename}</span>
                    <Download className="size-3.5 shrink-0" aria-hidden="true" />
                  </a>
                  <span className="text-muted-foreground basis-full text-xs tabular-nums sm:basis-auto">
                    {formatDate(attachment.created_at)} · {formatBytes(attachment.size)}
                  </span>
                </div>
                {canWrite ? (
                  <button
                    type="button"
                    onClick={() => remove.mutate(attachment.id)}
                    disabled={remove.isPending}
                    aria-label={t('attachments.delete')}
                    className="text-muted-foreground hover:text-destructive ml-auto shrink-0 transition-colors"
                  >
                    <Trash2 className="size-4" aria-hidden="true" />
                  </button>
                ) : null}
              </li>
            ))}
          </ul>
        ) : (
          <div className="flex items-center justify-between gap-2">
            <span className="text-muted-foreground text-sm">{t('attachments.none')}</span>
            {addButton}
          </div>
        )}
        <input
          ref={inputRef}
          type="file"
          multiple
          accept={accept}
          className="hidden"
          onChange={(event) => onPick(event.target.files)}
        />
        {hasAttachments ? addButton : null}
      </div>
    </DetailRow>
  )
}

function TransactionNotFoundView() {
  const { t } = useTranslation()
  return (
    <main className="mx-auto max-w-page p-4">
      <BackLink to="/" />
      <p className="text-muted-foreground mt-6 text-sm">{t('transaction.notFound')}</p>
    </main>
  )
}

export interface FlowMemberView {
  transaction: TransactionRead
  accountName: string | null
  bankName: string | null
  bankIcon: string | null
  isMarketValued: boolean
  isCurrent: boolean
  isAccessible: boolean
}

// Order a flow the way the money travels: by date, then non-depot accounts before the market-valued depot
// (the terminal asset side), then a sign rule, then id. So a broker buy reads deposit-in -> cash-out ->
// depot-in. The sign rule only applies across accounts: the two legs of a single transfer live on different
// accounts, so the source outflow precedes the destination inflow (out first). Within one account the legs
// arrive in provider order, so id (ascending = booking order) decides — e.g. a debit before its later
// reversal, even though the reversal is an inflow.
export function compareFlowMembers(a: FlowMemberView, b: FlowMemberView): number {
  const outLast = (m: FlowMemberView) => (m.transaction.amount < 0 ? 1 : 0)
  const sameAccount = a.transaction.account_id === b.transaction.account_id
  const signRank = sameAccount ? 0 : outLast(b) - outLast(a)
  return (
    a.transaction.date.localeCompare(b.transaction.date) ||
    Number(a.isMarketValued) - Number(b.isMarketValued) ||
    signRank ||
    a.transaction.id - b.transaction.id
  )
}

export interface TransactionDetailViewProps {
  accountId: number
  transaction: TransactionDetailRead
  accountName?: string | null
  bankName?: string | null
  bankIcon?: string | null
  flowMembers: FlowMemberView[]
  linking?: boolean
  canWrite?: boolean
  canUnlink?: boolean
  onSaveNote: (note: string | null) => Promise<unknown>
  onChangeCategory: (category: TransactionCategory) => Promise<unknown>
  onUnlink: (transaction: TransactionRead) => Promise<unknown>
  contractSection?: ReactNode
  attachmentsSection?: ReactNode
  linkSection?: ReactNode
  linkConfirmSection?: ReactNode
}

function ContractSection({ transaction }: { transaction: TransactionRead }) {
  const { t } = useTranslation()
  const { data: contracts } = useContracts()
  const setContract = useSetTransactionContract()

  const currentId = transaction.contract_id ?? null
  const candidates = (contracts ?? []).filter(
    (contract) => contract.account_id === transaction.account_id,
  )
  const assigned = candidates.find((contract) => contract.id === currentId) ?? null

  if (!contracts) {
    return (
      <DetailRow label={t('contracts.contract')}>
        <span className="text-muted-foreground text-sm">…</span>
      </DetailRow>
    )
  }

  if (candidates.length === 0 && currentId === null) {
    return (
      <DetailRow label={t('contracts.contract')}>
        <Link
          to="/contracts"
          className="text-primary hover:text-primary/80 text-sm transition-colors"
        >
          {t('contracts.createToAssign')}
        </Link>
      </DetailRow>
    )
  }

  const onChange = (value: string) => {
    const toContractId = value === '' ? null : Number(value)
    if (toContractId === currentId) return
    toast.promise(
      setContract.mutateAsync({
        transactionId: transaction.id,
        fromContractId: currentId,
        toContractId,
      }),
      {
        loading: t('common.saving'),
        success: toContractId === null ? t('contracts.removed') : t('contracts.assigned'),
        error: t('errors.unexpected.title'),
      },
    )
  }

  return (
    <DetailRow label={t('contracts.contract')} align="start">
      <div className="flex w-full flex-col gap-1.5">
        <SingleSelectPopover
          id="assign-contract"
          ariaLabel={t('contracts.contract')}
          value={currentId === null ? '' : String(currentId)}
          disabled={setContract.isPending}
          onChange={onChange}
          options={[
            { value: '', label: t('contracts.noContract') },
            ...candidates.map((contract) => ({
              value: String(contract.id),
              label: contract.name,
            })),
          ]}
        />
        {assigned ? (
          <Link
            to="/contracts/$contractId"
            params={{ contractId: String(assigned.id) }}
            className="text-primary hover:text-primary/80 -mx-1 self-start rounded-md px-1 py-0.5 text-sm transition-colors"
          >
            {assigned.frequency
              ? t(`contracts.frequency.${assigned.frequency}`)
              : t('contracts.frequencyUnknown')}
            {assigned.median_amount !== null ? ` · ${formatMoney(assigned.median_amount)}` : ''}
          </Link>
        ) : null}
      </div>
    </DetailRow>
  )
}
