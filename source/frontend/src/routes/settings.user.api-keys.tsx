import { useState } from 'react'
import { Link, createFileRoute } from '@tanstack/react-router'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { useTranslation } from 'react-i18next'
import { Check, ChevronLeft, Copy, Trash2 } from 'lucide-react'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { ApiError } from '@/lib/api'
import { copyText } from '@/lib/clipboard'
import { useAuthMe } from '@/lib/auth'
import { formatDateTime } from '@/lib/format'
import {
  useApiKeys,
  useCreateApiKey,
  useDeleteApiKey,
  type ApiKeyCreated,
  type ApiKeyRead,
} from '@/lib/apiKeys'

export const Route = createFileRoute('/settings/user/api-keys')({
  component: SettingsApiKeysPage,
})

function SettingsApiKeysPage() {
  const { data: user } = useAuthMe()
  if (!user) return null // root guard already redirected on 401
  return <SettingsApiKeysView />
}

export function SettingsApiKeysView() {
  const { t } = useTranslation()
  const keys = useApiKeys()
  const [createdKey, setCreatedKey] = useState<ApiKeyCreated | null>(null)

  const list = keys.data ?? []
  // Newest first so a freshly created key sits at the top of the list.
  const sortedList = [...list].sort((a, b) => b.created_at.localeCompare(a.created_at))

  return (
    <main className="mx-auto flex min-h-full max-w-2xl flex-col gap-6 p-4">
      <header className="flex items-center gap-2">
        <BackLink />
        <h1 className="text-foreground flex-1 text-2xl font-semibold">{t('apiKeys.title')}</h1>
      </header>

      <p className="text-muted-foreground text-sm">{t('apiKeys.description')}</p>

      {createdKey ? (
        <CreatedKeyReveal apiKey={createdKey} onDone={() => setCreatedKey(null)} />
      ) : (
        <CreateKeyForm onCreated={setCreatedKey} />
      )}

      {keys.isLoading ? (
        <p className="text-muted-foreground text-sm">{t('common.loading')}</p>
      ) : keys.isError ? (
        <p className="text-destructive text-sm">{t('apiKeys.loadError')}</p>
      ) : sortedList.length === 0 ? (
        <p className="text-muted-foreground text-sm">{t('apiKeys.empty')}</p>
      ) : (
        <ul className="border-border bg-card flex flex-col rounded-lg border">
          {sortedList.map((apiKey) => (
            <ApiKeyRow key={apiKey.id} apiKey={apiKey} />
          ))}
        </ul>
      )}
    </main>
  )
}

function CreateKeyForm({ onCreated }: { onCreated: (apiKey: ApiKeyCreated) => void }) {
  const { t } = useTranslation()
  const create = useCreateApiKey()
  const form = useForm<{ name: string }>({
    resolver: zodResolver(
      z.object({ name: z.string().min(1, { message: t('apiKeys.nameRequired') }) }),
    ),
    defaultValues: { name: '' },
  })

  const onSubmit = form.handleSubmit(async (values) => {
    try {
      const apiKey = await create.mutateAsync(values.name.trim())
      form.reset({ name: '' })
      onCreated(apiKey)
    } catch (err) {
      toast.error(readApiErrorMessage(err, t))
    }
  })

  return (
    <section className="border-border bg-card flex flex-col gap-4 rounded-lg border p-4">
      <h2 className="text-foreground text-lg font-semibold">{t('apiKeys.createTitle')}</h2>
      <form onSubmit={onSubmit} noValidate className="flex flex-col gap-3">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="api-key-name">{t('apiKeys.nameLabel')}</Label>
          <Input
            id="api-key-name"
            placeholder={t('apiKeys.namePlaceholder')}
            aria-invalid={form.formState.errors.name ? true : undefined}
            {...form.register('name')}
          />
          {form.formState.errors.name ? (
            <p role="alert" className="text-destructive text-xs">
              {form.formState.errors.name.message}
            </p>
          ) : null}
        </div>
        <Button type="submit" disabled={create.isPending} className="w-full">
          {t('apiKeys.create')}
        </Button>
      </form>
    </section>
  )
}

function CreatedKeyReveal({ apiKey, onDone }: { apiKey: ApiKeyCreated; onDone: () => void }) {
  const { t } = useTranslation()
  const [copied, setCopied] = useState(false)

  const copy = async () => {
    try {
      await copyText(apiKey.token)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      // Clipboard can be unavailable (insecure context / denied permission); the token stays
      // selectable on screen as a fallback.
    }
  }

  return (
    <section className="border-border bg-card flex flex-col gap-4 rounded-lg border p-4">
      <div className="flex flex-col gap-1">
        <h2 className="text-foreground text-lg font-semibold">{t('apiKeys.createdTitle')}</h2>
        <p className="text-muted-foreground text-sm">{t('apiKeys.createdHint')}</p>
      </div>
      <code className="border-border bg-muted/40 break-all rounded-md border p-3 font-mono text-sm">
        {apiKey.token}
      </code>
      <div className="flex flex-col gap-2 sm:flex-row">
        <Button type="button" variant="outline" onClick={copy} className="flex-1">
          {copied ? <Check className="size-3.5 text-success" /> : <Copy className="size-3.5" />}
          {copied ? t('apiKeys.copied') : t('apiKeys.copy')}
        </Button>
        <Button type="button" onClick={onDone} className="flex-1">
          {t('apiKeys.createdDone')}
        </Button>
      </div>
    </section>
  )
}

function ApiKeyRow({ apiKey }: { apiKey: ApiKeyRead }) {
  const { t } = useTranslation()
  const remove = useDeleteApiKey()
  const [confirming, setConfirming] = useState(false)

  const onDelete = async () => {
    try {
      await remove.mutateAsync(apiKey.id)
      toast.success(t('apiKeys.deleted'))
    } catch (err) {
      setConfirming(false)
      toast.error(readApiErrorMessage(err, t))
    }
  }

  return (
    <li className="border-border/40 flex flex-col gap-2 border-t p-3 first:border-t-0 sm:flex-row sm:items-center sm:gap-4">
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <span className="truncate text-sm font-medium" title={apiKey.name}>
          {apiKey.name}
        </span>
        <dl className="text-muted-foreground grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 text-xs">
          <dt>{t('apiKeys.prefix')}</dt>
          <dd className="font-mono">{apiKey.prefix}…</dd>
          <dt>{t('apiKeys.created')}</dt>
          <dd>{formatDateTime(apiKey.created_at)}</dd>
          <dt>{t('apiKeys.lastUsed')}</dt>
          <dd>
            {apiKey.last_used_at ? formatDateTime(apiKey.last_used_at) : t('apiKeys.neverUsed')}
          </dd>
        </dl>
      </div>
      <div className="sm:w-40 sm:self-center">
        {confirming ? (
          <div className="flex gap-2">
            <Button
              type="button"
              variant="destructive"
              size="sm"
              disabled={remove.isPending}
              onClick={onDelete}
              className="flex-1"
            >
              {t('apiKeys.confirmDelete')}
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={remove.isPending}
              onClick={() => setConfirming(false)}
              className="flex-1"
            >
              {t('common.cancel')}
            </Button>
          </div>
        ) : (
          <Button
            type="button"
            variant="destructive"
            size="sm"
            onClick={() => setConfirming(true)}
            className="w-full"
          >
            <Trash2 className="size-3.5" aria-hidden="true" />
            {t('apiKeys.delete')}
          </Button>
        )}
      </div>
    </li>
  )
}

function BackLink() {
  const { t } = useTranslation()
  return (
    <Link
      to="/settings/user"
      aria-label={t('settings.back')}
      className="text-primary hover:text-primary/80 -ml-1.5 rounded-md p-1.5 transition-colors"
    >
      <ChevronLeft className="size-5" />
    </Link>
  )
}

function readApiErrorMessage(err: unknown, t: (key: string) => string): string {
  if (err instanceof ApiError) {
    if (err.status === 429) return t('login.rateLimited')
    if (err.status === 422 && err.body && typeof err.body === 'object') {
      const detail = (err.body as { detail?: unknown }).detail
      if (typeof detail === 'string') return detail
    }
  }
  return t('login.genericError')
}
