import { useMemo, useState } from 'react'
import { Link, createFileRoute, useNavigate } from '@tanstack/react-router'
import { useTranslation } from 'react-i18next'
import { ChevronLeft, Plus } from 'lucide-react'
import { toast } from 'sonner'
import { z } from 'zod'

import { useAuthMe, type CredentialRead } from '@/lib/auth'
import {
  CONTRACT_FREQUENCIES,
  filterContracts,
  useContracts,
  useCreateContract,
  useDeleteContract,
  useUpdateContract,
  type ContractFilters,
  type ContractRead,
} from '@/lib/contract'
import { TRANSACTION_CATEGORIES } from '@/lib/transaction'
import { formatDate, formatDateWithoutYear, formatEuro } from '@/lib/format'
import { DeleteContractButton, RenameContractButton } from '@/components/contract-actions'
import { Button } from '@/components/ui/button'
import { ContractFilterBar } from '@/components/ui/contract-filter-bar'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { NativeSelect } from '@/components/ui/native-select'
import { AccountSingleSelect } from '@/components/ui/account-single-select'
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog'
import { cn } from '@/lib/utils'

const numberList = z
  .union([z.array(z.coerce.number()), z.coerce.number()])
  .transform((value) => (Array.isArray(value) ? value : [value]))

const contractFiltersSchema = z.object({
  account_ids: numberList.optional(),
  amount_from: z.coerce.number().optional(),
  amount_to: z.coerce.number().optional(),
  categories: z
    .union([z.enum(TRANSACTION_CATEGORIES), z.array(z.enum(TRANSACTION_CATEGORIES))])
    .transform((value) => (Array.isArray(value) ? value : [value]))
    .optional(),
  frequencies: z
    .union([z.enum(CONTRACT_FREQUENCIES), z.array(z.enum(CONTRACT_FREQUENCIES))])
    .transform((value) => (Array.isArray(value) ? value : [value]))
    .optional(),
})

export const Route = createFileRoute('/contracts')({
  component: ContractsPage,
  validateSearch: (search) => contractFiltersSchema.parse(search),
})

const SORT_OPTIONS = [
  'name',
  'amount_asc',
  'amount_desc',
  'magnitude_asc',
  'magnitude_desc',
  'next',
] as const
type SortOption = (typeof SORT_OPTIONS)[number]

function sortContracts(contracts: ContractRead[], sort: SortOption): ContractRead[] {
  const amount = (contract: ContractRead) => contract.median_amount
  const sorted = [...contracts]
  switch (sort) {
    case 'name':
      return sorted.sort((a, b) => a.name.localeCompare(b.name))
    case 'amount_asc':
      return sorted.sort((a, b) => byNumber(amount(a), amount(b), 'asc'))
    case 'amount_desc':
      return sorted.sort((a, b) => byNumber(amount(a), amount(b), 'desc'))
    case 'magnitude_asc':
      return sorted.sort((a, b) => byNumber(absOrNull(amount(a)), absOrNull(amount(b)), 'asc'))
    case 'magnitude_desc':
      return sorted.sort((a, b) => byNumber(absOrNull(amount(a)), absOrNull(amount(b)), 'desc'))
    case 'next':
      return sorted.sort((a, b) => byString(a.expected_next_date, b.expected_next_date))
  }
}

function absOrNull(value: number | null): number | null {
  return value === null ? null : Math.abs(value)
}

function byNumber(a: number | null, b: number | null, direction: 'asc' | 'desc'): number {
  if (a === null) return b === null ? 0 : 1
  if (b === null) return -1
  return direction === 'asc' ? a - b : b - a
}

function byString(a: string | null, b: string | null): number {
  if (a === null) return b === null ? 0 : 1
  if (b === null) return -1
  return a.localeCompare(b)
}

function ContractsPage() {
  const { t } = useTranslation()
  const { data: contracts } = useContracts()
  const { data: user } = useAuthMe()
  const filters = Route.useSearch()
  const navigate = useNavigate({ from: Route.fullPath })
  const [sort, setSort] = useState<SortOption>('amount_asc')

  const credentials: CredentialRead[] = user?.credentials ?? []
  const all = contracts ?? []

  const visible = useMemo(
    () => sortContracts(filterContracts(contracts ?? [], filters), sort),
    [contracts, filters, sort],
  )

  const setFilters = (next: ContractFilters) => navigate({ search: next, replace: true })

  return (
    <main className="mx-auto flex min-h-full max-w-3xl flex-col gap-6 p-4">
      <header className="flex items-center gap-2">
        <Link
          to="/"
          aria-label={t('account.back')}
          className="text-primary hover:text-primary/80 -ml-1.5 rounded-md p-1.5 transition-colors"
        >
          <ChevronLeft className="size-5" />
        </Link>
        <h1 className="text-foreground text-lg font-semibold">{t('contracts.title')}</h1>
        <div className="ml-auto flex items-center gap-2">
          {all.length > 0 ? (
            <div className="w-48">
              <NativeSelect
                id="contract-sort"
                value={sort}
                onChange={(event) => setSort(event.target.value as SortOption)}
              >
                {SORT_OPTIONS.map((option) => (
                  <option key={option} value={option}>
                    {t(`contracts.sort.${option}`)}
                  </option>
                ))}
              </NativeSelect>
            </div>
          ) : null}
          <CreateContractDialog credentials={credentials} />
        </div>
      </header>

      {all.length > 0 ? (
        <ContractFilterBar credentials={credentials} filters={filters} onChange={setFilters} />
      ) : null}

      {visible.length > 0 ? (
        <ul className="border-border divide-border bg-card flex flex-col divide-y overflow-hidden rounded-lg border">
          {visible.map((contract) => (
            <ContractRow key={contract.id} contract={contract} />
          ))}
        </ul>
      ) : (
        <p className="text-muted-foreground text-sm">
          {all.length > 0 ? t('contracts.noMatches') : t('contracts.empty')}
        </p>
      )}
    </main>
  )
}

function ContractRow({ contract }: { contract: ContractRead }) {
  const { t } = useTranslation()
  const update = useUpdateContract(contract.id)
  const remove = useDeleteContract()
  const negative = (contract.median_amount ?? 0) < 0

  const onDelete = () => {
    toast.promise(remove.mutateAsync(contract.id), {
      loading: t('common.saving'),
      success: t('contracts.deleted'),
      error: t('errors.unexpected.title'),
    })
  }

  return (
    <li className="hover:bg-muted/60 flex items-center gap-3 px-3 py-3 transition-colors">
      <Link
        to="/contracts/$contractId"
        params={{ contractId: String(contract.id) }}
        className="grid flex-1 grid-cols-[1fr_auto] items-center gap-3"
      >
        <span className="flex min-w-0 flex-col">
          <span className="truncate text-sm font-medium">{contract.name}</span>
          <span className="text-muted-foreground flex flex-col text-xs">
            <span className="truncate">
              {t('contracts.turnus')}:{' '}
              {contract.frequency
                ? t(`contracts.frequency.${contract.frequency}`)
                : t('contracts.frequencyUnknown')}
            </span>
            {contract.expected_next_date ? (
              <span className="truncate">
                {t('contracts.nextExpected')}:{' '}
                <span className="hidden sm:inline">{formatDate(contract.expected_next_date)}</span>
                <span className="sm:hidden">
                  {formatDateWithoutYear(contract.expected_next_date)}
                </span>
              </span>
            ) : null}
          </span>
        </span>
        {contract.median_amount === null ? null : (
          <span
            className={cn(
              'text-sm font-semibold tabular-nums',
              negative ? 'text-destructive' : 'text-success',
            )}
          >
            {formatEuro(contract.median_amount)}
          </span>
        )}
      </Link>
      <div className="flex items-center gap-0 sm:gap-1">
        <RenameContractButton
          name={contract.name}
          onRename={(name) => update.mutateAsync({ name, category: contract.category })}
        />
        <DeleteContractButton onConfirm={onDelete} isDeleting={remove.isPending} />
      </div>
    </li>
  )
}

function CreateContractDialog({ credentials }: { credentials: CredentialRead[] }) {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const create = useCreateContract()
  const [open, setOpen] = useState(false)
  const [name, setName] = useState('')
  const [accountId, setAccountId] = useState<number | null>(null)

  const hasAccounts = credentials.some((credential) => credential.accounts.length > 0)
  const canSubmit = name.trim().length > 0 && accountId !== null && !create.isPending

  const onSubmit = async () => {
    if (accountId === null) return
    const created = await create.mutateAsync({ name: name.trim(), account_id: accountId })
    setOpen(false)
    setName('')
    setAccountId(null)
    await navigate({ to: '/contracts/$contractId', params: { contractId: String(created.id) } })
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button
          type="button"
          size="sm"
          variant="outline"
          aria-label={t('contracts.create')}
          disabled={!hasAccounts}
        >
          <Plus className="size-4" aria-hidden="true" />
          <span className="hidden sm:inline">{t('contracts.create')}</span>
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-[46rem]">
        <DialogHeader>
          <DialogTitle>{t('contracts.create')}</DialogTitle>
        </DialogHeader>
        <div className="flex flex-col gap-4">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="contract-name">{t('contracts.name')}</Label>
            <Input
              id="contract-name"
              value={name}
              onChange={(event) => setName(event.target.value)}
              autoFocus
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="contract-account">{t('contracts.account')}</Label>
            <AccountSingleSelect
              id="contract-account"
              credentials={credentials}
              value={accountId}
              onChange={setAccountId}
              placeholder={t('contracts.selectAccount')}
            />
          </div>
          <div className="flex justify-end gap-2">
            <DialogClose asChild>
              <Button variant="ghost">{t('common.cancel')}</Button>
            </DialogClose>
            <Button
              disabled={!canSubmit}
              onClick={() => {
                toast.promise(onSubmit(), {
                  loading: t('common.saving'),
                  success: t('contracts.created'),
                  error: t('errors.unexpected.title'),
                })
              }}
            >
              {t('contracts.create')}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
