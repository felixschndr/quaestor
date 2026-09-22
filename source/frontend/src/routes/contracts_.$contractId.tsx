import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'

import {
  useContract,
  useDeleteContract,
  useUpdateContract,
  type ContractDetailRead,
  type ContractFrequency,
} from '@/lib/contract'
import { type CategoryKey } from '@/lib/transaction'
import { ContractDetailView } from '@/pages/contracts_.$contractId'
import { NotFound } from '@/components/not-found'

export const Route = createFileRoute('/contracts_/$contractId')({
  component: ContractDetailPage,
})

function ContractDetailPage() {
  const { contractId: rawContractId } = Route.useParams()
  const contractId = Number(rawContractId)
  const query = useContract(contractId)
  const update = useUpdateContract(contractId)
  const remove = useDeleteContract()
  const navigate = useNavigate()
  const { t } = useTranslation()

  if (query.isLoading) return null
  if (!query.data) return <ContractNotFoundView />

  const onDelete = async () => {
    await remove.mutateAsync(contractId)
    await navigate({ to: '/contracts' })
  }

  return (
    <ContractDetailView
      contract={query.data}
      isDeleting={remove.isPending}
      onRename={(name) => update.mutateAsync({ name, category: query.data!.category })}
      onChangeCategory={(category) => update.mutateAsync({ name: query.data!.name, category })}
      onChangeFrequency={(frequency) =>
        update.mutateAsync({ name: query.data!.name, category: query.data!.category, frequency })
      }
      onChangeEndDate={(end_date) => update.mutateAsync({ name: query.data!.name, end_date })}
      onSaveNote={(note) =>
        update.mutateAsync({ name: query.data!.name, category: query.data!.category, note })
      }
      onSetArchived={(archived) => {
        toast.promise(update.mutateAsync({ name: query.data!.name, archived }), {
          loading: t('common.saving'),
          success: archived ? t('common.archived') : t('contracts.unarchived'),
          error: t('errors.unexpected.title'),
        })
      }}
      onDelete={() => {
        const promise = onDelete()
        toast.promise(promise, {
          loading: t('common.saving'),
          success: t('contracts.deleted'),
          error: t('errors.unexpected.title'),
        })
        return promise.catch(() => {})
      }}
    />
  )
}

function ContractNotFoundView() {
  const { t } = useTranslation()
  return (
    <NotFound
      message={t('contracts.notFound')}
      backTo="/contracts"
      backLabel={t('contracts.backToList')}
    />
  )
}

export interface ContractDetailViewProps {
  contract: ContractDetailRead
  isDeleting?: boolean
  onRename: (name: string) => Promise<unknown>
  onChangeCategory: (category: CategoryKey) => Promise<unknown>
  onChangeFrequency: (frequency: ContractFrequency | null) => Promise<unknown>
  onChangeEndDate: (endDate: string | null) => Promise<unknown>
  onSaveNote: (note: string | null) => Promise<unknown>
  onSetArchived: (archived: boolean) => void
  onDelete: () => Promise<unknown>
}
