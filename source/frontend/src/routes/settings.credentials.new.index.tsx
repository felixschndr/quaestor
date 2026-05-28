import { Link, createFileRoute } from '@tanstack/react-router'
import { useTranslation } from 'react-i18next'
import { ChevronLeft, ChevronRight } from 'lucide-react'

import { useAuthMe } from '@/lib/auth'
import { useSupportedBanks, type SupportedBank } from '@/lib/credentials'

export const Route = createFileRoute('/settings/credentials/new/')({
  component: BankPickerPage,
})

function BankPickerPage() {
  const banks = useSupportedBanks()
  const { data: user } = useAuthMe()
  const existingAccountCounts: Record<string, number> = {}
  for (const credential of user?.credentials ?? []) {
    existingAccountCounts[credential.bank] =
      (existingAccountCounts[credential.bank] ?? 0) + credential.accounts.length
  }
  return (
    <BankPickerView
      isLoading={banks.isLoading}
      isError={banks.isError}
      banks={banks.data ?? []}
      existingAccountCounts={existingAccountCounts}
    />
  )
}

export interface BankPickerViewProps {
  isLoading: boolean
  isError: boolean
  banks: SupportedBank[]
  existingAccountCounts: Record<string, number>
}

export function BankPickerView({
  isLoading,
  isError,
  banks,
  existingAccountCounts,
}: BankPickerViewProps) {
  const { t } = useTranslation()
  // Sort by the localised title so the list reads alphabetically in the user's
  // language. Falls back to the raw bank name when no translation exists.
  const sortedBanks = [...banks].sort((a, b) =>
    t(`banks.${a.name}.title`, { defaultValue: a.name }).localeCompare(
      t(`banks.${b.name}.title`, { defaultValue: b.name }),
    ),
  )
  return (
    <main className="mx-auto flex min-h-full max-w-2xl flex-col gap-6 p-4">
      <header className="flex items-center gap-2">
        <BackLink />
        <h1 className="text-foreground text-2xl font-semibold">{t('credentials.pickerTitle')}</h1>
      </header>

      {isLoading ? (
        <p className="text-muted-foreground text-sm">{t('common.loading')}</p>
      ) : isError ? (
        <p className="text-destructive text-sm">{t('login.genericError')}</p>
      ) : sortedBanks.length === 0 ? (
        <p className="text-muted-foreground text-sm">{t('credentials.pickerEmpty')}</p>
      ) : (
        <ul className="border-border bg-card flex flex-col rounded-lg border">
          {sortedBanks.map((bank) => (
            <BankPickerRow
              key={bank.name}
              bank={bank}
              accountsCount={existingAccountCounts[bank.name] ?? 0}
            />
          ))}
        </ul>
      )}
    </main>
  )
}

function BankPickerRow({ bank, accountsCount }: { bank: SupportedBank; accountsCount: number }) {
  const { t } = useTranslation()
  return (
    <li className="border-border/40 border-t first:border-t-0">
      <Link
        to="/settings/credentials/new/$bank"
        params={{ bank: bank.name }}
        className="hover:bg-muted/60 flex items-center gap-3 rounded-md px-3 py-3 transition-colors"
      >
        <img
          src={bank.icon}
          alt=""
          aria-hidden="true"
          className="size-8 rounded-md object-cover"
          onError={(event) => {
            event.currentTarget.style.visibility = 'hidden'
          }}
        />
        <span className="flex flex-1 flex-col">
          <span className="truncate text-sm font-medium">
            {t(`banks.${bank.name}.title`, { defaultValue: bank.name })}
          </span>
          <span className="text-muted-foreground text-xs">
            {t('credentials.pickerAccountsAdded', { count: accountsCount })}
          </span>
        </span>
        <ChevronRight className="text-muted-foreground size-4" aria-hidden="true" />
      </Link>
    </li>
  )
}

function BackLink() {
  const { t } = useTranslation()
  return (
    <Link
      to="/settings/credentials"
      aria-label={t('credentials.back')}
      className="text-primary hover:text-primary/80 -ml-1.5 rounded-md p-1.5 transition-colors"
    >
      <ChevronLeft className="size-5" />
    </Link>
  )
}
