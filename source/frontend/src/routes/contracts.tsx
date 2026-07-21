import { useMemo, useState } from 'react'
import { Link, createFileRoute, useNavigate } from '@tanstack/react-router'
import { useTranslation } from 'react-i18next'
import { ChevronLeft, Plus } from 'lucide-react'
import { toast } from 'sonner'
import { z } from 'zod'

import { useAuthMe, type CredentialRead } from '@/lib/auth'
import {
  CONTRACT_FREQUENCY_FILTERS,
  filterContracts,
  useContracts,
  useCreateContract,
  type ContractFilters,
  type ContractFrequency,
  type ContractRead,
} from '@/lib/contract'
import { TRANSACTION_CATEGORIES, type TransactionCategory } from '@/lib/transaction'
import { useCategoryOptions } from '@/lib/categoryIcons'
import { useFrequencyOptions } from '@/lib/contractFrequencyIcons'
import { ContractCostOverview } from '@/components/contract-cost-overview'
import { Button } from '@/components/ui/button'
import { ContractFilterBar } from '@/components/ui/contract-filter-bar'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { SingleSelectPopover } from '@/components/ui/single-select-popover'
import { AccountSingleSelect } from '@/components/ui/account-single-select'
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog'
import { oneOrMany } from '@/lib/searchParams'

const numberList = oneOrMany(z.coerce.number())

const contractFiltersSchema = z.object({
  account_ids: numberList.optional(),
  amount_from: z.coerce.number().optional(),
  amount_to: z.coerce.number().optional(),
  categories: oneOrMany(z.enum(TRANSACTION_CATEGORIES)).optional(),
  frequencies: oneOrMany(z.enum(CONTRACT_FREQUENCY_FILTERS)).optional(),
  overdue: z.boolean().or(z.stringbool()).optional(),
  text: z.string().optional(),
})

export const Route = createFileRoute('/contracts')({
  component: ContractsPage,
  validateSearch: (search) => contractFiltersSchema.parse(search),
})

const SORT_OPTIONS = [
  'name',
  'amount_asc',
  'amount_desc',
  'per_day_out',
  'per_day_in',
  'next',
] as const
type SortOption = (typeof SORT_OPTIONS)[number]

function sortContracts(contracts: ContractRead[], sort: SortOption): ContractRead[] {
  const amount = (contract: ContractRead) => contract.median_amount
  const perDay = (contract: ContractRead) => contract.amount_per_day
  const sorted = [...contracts]
  switch (sort) {
    case 'name':
      return sorted.sort((a, b) => a.name.localeCompare(b.name))
    case 'amount_asc':
      return sorted.sort((a, b) => byNumber(amount(a), amount(b), 'asc'))
    case 'amount_desc':
      return sorted.sort((a, b) => byNumber(amount(a), amount(b), 'desc'))
    // amount_per_day is signed, so income sorts to the top descending and expenses ascending.
    case 'per_day_in':
      return sorted.sort((a, b) => byNumber(perDay(a), perDay(b), 'desc'))
    case 'per_day_out':
      return sorted.sort((a, b) => byNumber(perDay(a), perDay(b), 'asc'))
    case 'next':
      return sorted.sort((a, b) => byString(a.expected_next_date, b.expected_next_date))
  }
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
    <main className="mx-auto flex min-h-full max-w-page flex-col gap-6 p-4">
      <header className="flex items-center gap-2">
        <Link
          to="/"
          aria-label={t('account.back')}
          className="text-primary hover:text-primary/80 -ml-1.5 rounded-md p-1.5 transition-colors"
        >
          <ChevronLeft className="size-5" />
        </Link>
        <h1 className="text-foreground text-lg font-semibold">{t('contracts.title')}</h1>
        <div className="ml-auto">
          <CreateContractDialog credentials={credentials} />
        </div>
      </header>

      {all.length > 0 ? (
        <ContractFilterBar credentials={credentials} filters={filters} onChange={setFilters} />
      ) : null}

      {visible.length > 0 ? (
        <section className="flex flex-col gap-2">
          <div className="flex items-center justify-between gap-2">
            <h2 className="text-primary text-sm font-semibold">
              {t('contracts.count', { count: visible.length })}
            </h2>
            <div className="w-48">
              <SingleSelectPopover
                id="contract-sort"
                ariaLabel={t('contracts.sortLabel')}
                value={sort}
                onChange={setSort}
                options={SORT_OPTIONS.map((option) => ({
                  value: option,
                  label: t(`contracts.sort.${option}`),
                }))}
              />
            </div>
          </div>
          <ContractCostOverview contracts={visible} />
        </section>
      ) : (
        <p className="text-muted-foreground text-sm">
          {all.length > 0 ? t('contracts.noMatches') : t('contracts.empty')}
        </p>
      )}
    </main>
  )
}

function CreateContractDialog({ credentials }: { credentials: CredentialRead[] }) {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const create = useCreateContract()
  const [open, setOpen] = useState(false)
  const [name, setName] = useState('')
  const [accountId, setAccountId] = useState<number | null>(null)
  // 'NONE' is the "irregular" choice
  const [frequency, setFrequency] = useState<ContractFrequency | 'NONE'>('NONE')
  const [category, setCategory] = useState<TransactionCategory>('UNKNOWN')
  const categoryOptions = useCategoryOptions()
  const frequencyOptions = useFrequencyOptions()

  const hasAccounts = credentials.some((credential) => credential.accounts.length > 0)
  const canSubmit = name.trim().length > 0 && accountId !== null && !create.isPending

  const onSubmit = async () => {
    if (accountId === null) return
    const created = await create.mutateAsync({
      name: name.trim(),
      account_id: accountId,
      frequency: frequency === 'NONE' ? undefined : frequency,
      category: category === 'UNKNOWN' ? undefined : category,
    })
    setOpen(false)
    setName('')
    setAccountId(null)
    setFrequency('NONE')
    setCategory('UNKNOWN')
    await navigate({ to: '/contracts/$contractId', params: { contractId: String(created.id) } })
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button
          type="button"
          size="sm"
          variant="primary"
          aria-label={t('contracts.create')}
          disabled={!hasAccounts}
        >
          <Plus className="size-4" aria-hidden="true" />
          <span>{t('contracts.create')}</span>
        </Button>
      </DialogTrigger>
      <DialogContent className="w-[calc(100vw-2rem)] max-w-[calc(var(--container-page)-2rem)]">
        <DialogHeader>
          <DialogTitle>{t('contracts.create')}</DialogTitle>
        </DialogHeader>
        <div className="flex flex-col gap-4">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="contract-name">{t('common.name')}</Label>
            <Input
              id="contract-name"
              value={name}
              onChange={(event) => setName(event.target.value)}
              autoFocus
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="contract-account">{t('common.account')}</Label>
            <AccountSingleSelect
              id="contract-account"
              credentials={credentials}
              value={accountId}
              onChange={setAccountId}
              placeholder={t('contracts.selectAccount')}
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="contract-frequency">{t('contracts.turnus')}</Label>
            <SingleSelectPopover
              id="contract-frequency"
              ariaLabel={t('contracts.turnus')}
              value={frequency}
              onChange={setFrequency}
              options={frequencyOptions}
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="contract-category">{t('common.category')}</Label>
            <SingleSelectPopover
              id="contract-category"
              ariaLabel={t('common.category')}
              value={category}
              onChange={setCategory}
              options={categoryOptions}
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
