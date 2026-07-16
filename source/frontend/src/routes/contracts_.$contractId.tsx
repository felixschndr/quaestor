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
import { type TransactionCategory } from '@/lib/transaction'
import { ContractDetailView } from '@/pages/contracts_.$contractId'
import { BackLink } from '@/components/back-link'

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
      onSaveNote={(note) =>
        update.mutateAsync({ name: query.data!.name, category: query.data!.category, note })
      }
      onDelete={() => {
        toast.promise(onDelete(), {
          loading: t('common.saving'),
          success: t('contracts.deleted'),
          error: t('errors.unexpected.title'),
        })
      }}
    />
  )
}

function ContractNotFoundView() {
  const { t } = useTranslation()
  return (
    <main className="mx-auto max-w-page p-4">
      <BackLink to="/contracts">{t('contracts.title')}</BackLink>
      <p className="text-muted-foreground mt-6 text-sm">{t('contracts.notFound')}</p>
    </main>
  )
}

export interface ContractDetailViewProps {
  contract: ContractDetailRead
  isDeleting?: boolean
  onRename: (name: string) => Promise<unknown>
  onChangeCategory: (category: TransactionCategory) => Promise<unknown>
  onChangeFrequency: (frequency: ContractFrequency | null) => Promise<unknown>
  onSaveNote: (note: string | null) => Promise<unknown>
  onDelete: () => void
}
