import { useState, type FormEvent } from 'react'
import { Link, createFileRoute, useRouter } from '@tanstack/react-router'
import { useTranslation } from 'react-i18next'
import { ChevronLeft } from 'lucide-react'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { useAuthMe, type AccountRead, type CredentialRead } from '@/lib/auth'
import { bankIconUrl, useUpdateAccount } from '@/lib/accounts'
import { useDeleteCredential } from '@/lib/credentials'
import { formatDateTime, formatEuro, formatIban } from '@/lib/format'

export const Route = createFileRoute('/settings/credentials/$credentialId')({
  component: CredentialDetailPage,
})

function CredentialDetailPage() {
  const { credentialId } = Route.useParams()
  const { data: user } = useAuthMe()
  const router = useRouter()
  if (!user) return null // root guard already redirected on 401

  const credential = user.credentials.find((c) => c.id === Number(credentialId))
  return (
    <CredentialDetailView
      credential={credential}
      onDeleted={() => router.history.push('/settings/credentials')}
    />
  )
}

export interface CredentialDetailViewProps {
  credential: CredentialRead | undefined
  onDeleted: () => void
}

export function CredentialDetailView({ credential, onDeleted }: CredentialDetailViewProps) {
  const { t } = useTranslation()
  const bankTitle = credential
    ? t(`banks.${credential.bank}.title`, { defaultValue: credential.bank })
    : ''

  return (
    <main className="mx-auto flex min-h-full max-w-2xl flex-col gap-6 p-4">
      <header className="flex items-center gap-2">
        <BackLink />
      </header>

      {!credential ? (
        <NotFoundFallback />
      ) : (
        <>
          <BankHeader credential={credential} bankTitle={bankTitle} />
          <AccountsSection accounts={credential.accounts} />
          <DangerZone credential={credential} bankTitle={bankTitle} onDeleted={onDeleted} />
        </>
      )}
    </main>
  )
}

function BackLink() {
  const { t } = useTranslation()
  return (
    <Link
      to="/settings/credentials"
      aria-label={t('credentials.detail.backToList')}
      className="text-primary hover:text-primary/80 -ml-1.5 rounded-md p-1.5 transition-colors"
    >
      <ChevronLeft className="size-5" />
    </Link>
  )
}

function NotFoundFallback() {
  const { t } = useTranslation()
  return (
    <div className="flex flex-col gap-3">
      <p className="text-muted-foreground text-sm">{t('credentials.detail.notFound')}</p>
      <Button asChild variant="outline" className="self-start">
        <Link to="/settings/credentials">{t('credentials.detail.backToList')}</Link>
      </Button>
    </div>
  )
}

function BankHeader({ credential, bankTitle }: { credential: CredentialRead; bankTitle: string }) {
  const { t } = useTranslation()
  const lastSyncedLabel = credential.last_fetching_timestamp
    ? `${t('credentials.lastSynced')}: ${formatDateTime(credential.last_fetching_timestamp)}`
    : t('credentials.neverSynced')
  return (
    <section className="flex flex-col items-center gap-2 text-center">
      <img
        src={bankIconUrl(credential.bank)}
        alt=""
        aria-hidden="true"
        className="size-16 rounded-xl object-cover"
        onError={(event) => {
          event.currentTarget.style.visibility = 'hidden'
        }}
      />
      <h1 className="text-foreground text-2xl font-semibold">{bankTitle}</h1>
      <p className="text-muted-foreground text-sm">{lastSyncedLabel}</p>
    </section>
  )
}

function AccountsSection({ accounts }: { accounts: AccountRead[] }) {
  const { t } = useTranslation()
  return (
    <section className="flex flex-col gap-3">
      <h2 className="text-muted-foreground text-xs font-semibold uppercase tracking-wide">
        {t('credentials.detail.accountsHeading')}
      </h2>
      {accounts.length === 0 ? (
        <p className="text-muted-foreground text-sm">{t('credentials.detail.accountsEmpty')}</p>
      ) : (
        <ul className="flex flex-col gap-3">
          {accounts.map((account) => (
            <AccountRow key={account.id} account={account} />
          ))}
        </ul>
      )}
    </section>
  )
}

function AccountRow({ account }: { account: AccountRead }) {
  const { t } = useTranslation()
  // Initial value follows the server prop; once the user starts editing, local
  // state diverges until they save (or navigate away and the component remounts).
  const [factor, setFactor] = useState<string>(String(account.balance_factor))
  const update = useUpdateAccount()

  const parsed = Number(factor)
  const isValidInteger =
    factor.length > 0 && Number.isInteger(parsed) && parsed >= 0 && parsed <= 100
  const dirty = isValidInteger && parsed !== account.balance_factor

  const onSubmit = async (event: FormEvent) => {
    event.preventDefault()
    if (!dirty) return
    try {
      await update.mutateAsync({ accountId: account.id, balance_factor: parsed })
      toast.success(t('credentials.detail.balanceFactorSaved'))
    } catch {
      toast.error(t('credentials.detail.deleteFailed'))
    }
  }

  const trimmedDisplayName = account.display_name?.trim()
  const formattedIban = formatIban(account.name)
  const title = trimmedDisplayName || formattedIban
  const subtitle = trimmedDisplayName ? formattedIban : null
  const effectiveFactor = isValidInteger ? parsed : account.balance_factor
  const effectiveBalance = (account.balance * effectiveFactor) / 100
  const inputId = `account-${account.id}-balance-factor`

  return (
    <li className="border-border bg-card flex flex-col rounded-lg border shadow-sm">
      <div className="flex items-start justify-between gap-3 p-4">
        <div className="flex min-w-0 flex-col">
          <span className="text-foreground truncate text-base font-medium">{title}</span>
          {subtitle ? (
            <span className="text-muted-foreground truncate text-xs">{subtitle}</span>
          ) : null}
        </div>
        <span className="text-foreground shrink-0 text-base font-semibold tabular-nums">
          {formatEuro(account.balance)}
        </span>
      </div>
      <div className="border-border/60 border-t" />
      <form onSubmit={onSubmit} className="flex flex-col gap-3 p-4">
        {/* Two-row grid so the two labels share a baseline and the input + computed
            value + save button share another. */}
        <div className="grid grid-cols-[auto_1fr_auto] items-center gap-x-4 gap-y-1.5">
          <Label
            htmlFor={inputId}
            className="text-muted-foreground row-start-1 text-[0.65rem] font-medium uppercase tracking-wide"
          >
            {t('credentials.detail.balanceFactor')}
          </Label>
          <span className="text-muted-foreground row-start-1 text-[0.65rem] font-medium uppercase tracking-wide">
            {t('credentials.detail.countsAsLabel')}
          </span>

          <div className="border-input bg-background focus-within:border-ring focus-within:ring-ring/50 row-start-2 flex h-8 w-24 items-center rounded-lg border pr-2.5 transition-colors focus-within:ring-3">
            <Input
              id={inputId}
              type="number"
              inputMode="numeric"
              min={0}
              max={100}
              step={1}
              value={factor}
              onChange={(event) => setFactor(event.target.value)}
              aria-invalid={!isValidInteger || undefined}
              className="h-7 border-0 bg-transparent pr-1 text-right tabular-nums shadow-none focus-visible:border-0 focus-visible:ring-0"
            />
            <span className="text-muted-foreground text-sm">%</span>
          </div>
          <span className="text-foreground row-start-2 text-sm font-medium tabular-nums">
            {formatEuro(effectiveBalance)}
          </span>

          <Button
            type="submit"
            size="sm"
            disabled={!dirty || update.isPending}
            className="col-start-3 row-start-2 ml-auto"
          >
            {update.isPending ? t('credentials.detail.saving') : t('credentials.detail.save')}
          </Button>
        </div>
        {!isValidInteger ? (
          <p role="alert" className="text-destructive text-xs">
            {t('credentials.detail.balanceFactorRange')}
          </p>
        ) : (
          <p className="text-muted-foreground text-xs">
            {t('credentials.detail.balanceFactorHint')}
          </p>
        )}
      </form>
    </li>
  )
}

function DangerZone({
  credential,
  bankTitle,
  onDeleted,
}: {
  credential: CredentialRead
  bankTitle: string
  onDeleted: () => void
}) {
  const { t } = useTranslation()
  const [confirming, setConfirming] = useState(false)
  const remove = useDeleteCredential()

  const onConfirm = async () => {
    try {
      await remove.mutateAsync(credential.id)
      toast.success(`${t('credentials.detail.deleted')}: ${bankTitle}`)
      onDeleted()
    } catch {
      toast.error(t('credentials.detail.deleteFailed'))
      setConfirming(false)
    }
  }

  return (
    <section className="border-destructive/40 flex flex-col gap-3 rounded-lg border p-4">
      <h2 className="text-destructive text-sm font-semibold uppercase tracking-wide">
        {t('credentials.detail.deleteSection')}
      </h2>
      <p className="text-muted-foreground text-sm">{t('credentials.detail.deleteDescription')}</p>
      {confirming ? (
        <div className="flex gap-2">
          <Button
            type="button"
            variant="destructive"
            onClick={onConfirm}
            disabled={remove.isPending}
          >
            {t('credentials.detail.deleteConfirm')}
          </Button>
          <Button
            type="button"
            variant="outline"
            onClick={() => setConfirming(false)}
            disabled={remove.isPending}
          >
            {t('credentials.detail.deleteCancel')}
          </Button>
        </div>
      ) : (
        <Button
          type="button"
          variant="destructive"
          onClick={() => setConfirming(true)}
          className="self-start"
        >
          {t('credentials.detail.delete')}
        </Button>
      )}
    </section>
  )
}
