import { useEffect } from 'react'
import { createFileRoute } from '@tanstack/react-router'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import {
  FieldRow,
  Section,
  SettingsSubPage,
  readApiErrorMessage,
} from '@/components/settings/settings-section'
import { ApiError } from '@/lib/api'
import { useAuthMe, type UserRead } from '@/lib/auth'
import { useUpdateUser } from '@/lib/user'

export const Route = createFileRoute('/settings/user/profile')({
  component: SettingsProfilePage,
})

function SettingsProfilePage() {
  const { data: user } = useAuthMe()
  if (!user) return null // root guard already redirected on 401
  return <SettingsProfileView user={user} />
}

export function SettingsProfileView({ user }: { user: UserRead }) {
  const { t } = useTranslation()
  return (
    <SettingsSubPage title={t('settings.profile')}>
      <UserNameSection user={user} />
      <DisplayNameSection user={user} />
    </SettingsSubPage>
  )
}

interface UserNameValues {
  user_name: string
}

function UserNameSection({ user }: { user: UserRead }) {
  const { t } = useTranslation()
  const update = useUpdateUser(user.id)
  const form = useForm<UserNameValues>({
    resolver: zodResolver(
      z.object({
        user_name: z.string().min(1, { message: t('login.required') }),
      }),
    ),
    defaultValues: { user_name: user.user_name },
  })

  useEffect(() => {
    form.reset({ user_name: user.user_name })
  }, [user.user_name, form])

  const onSubmit = form.handleSubmit(async (values) => {
    const normalized = values.user_name.trim().toLowerCase()
    if (normalized === user.user_name) return
    try {
      await update.mutateAsync({ user_name: normalized })
      toast.success(t('settings.userSaved'))
    } catch (err) {
      if (err instanceof ApiError && err.status === 409) {
        form.setError('user_name', { type: 'server', message: t('login.userNameTaken') })
        return
      }
      toast.error(readApiErrorMessage(err, t))
    }
  })

  const dirty = form.watch('user_name').trim().toLowerCase() !== user.user_name

  return (
    <Section title={t('settings.userName')}>
      <form onSubmit={onSubmit} noValidate className="flex flex-col gap-3">
        <FieldRow
          id="user-name"
          label={t('settings.userName')}
          hideLabel
          autoComplete="username"
          error={form.formState.errors.user_name?.message}
          {...form.register('user_name')}
        />
        <Button type="submit" disabled={!dirty || update.isPending} className="w-full">
          {t('common.save')}
        </Button>
      </form>
    </Section>
  )
}

interface DisplayNameValues {
  display_name: string
}

function DisplayNameSection({ user }: { user: UserRead }) {
  const { t } = useTranslation()
  const update = useUpdateUser(user.id)
  const form = useForm<DisplayNameValues>({
    resolver: zodResolver(
      z.object({
        display_name: z.string().min(1, { message: t('login.required') }),
      }),
    ),
    defaultValues: { display_name: user.display_name },
  })

  // Re-sync the field if the user changes elsewhere (e.g. after a refetch).
  useEffect(() => {
    form.reset({ display_name: user.display_name })
  }, [user.display_name, form])

  const onSubmit = form.handleSubmit(async (values) => {
    if (values.display_name === user.display_name) return
    try {
      await update.mutateAsync({ display_name: values.display_name })
      toast.success(t('settings.userSaved'))
    } catch (err) {
      toast.error(readApiErrorMessage(err, t))
    }
  })

  const dirty = form.watch('display_name') !== user.display_name

  return (
    <Section title={t('settings.displayName')}>
      <form onSubmit={onSubmit} noValidate className="flex flex-col gap-3">
        <FieldRow
          id="display-name"
          label={t('settings.displayName')}
          hideLabel
          autoComplete="name"
          error={form.formState.errors.display_name?.message}
          {...form.register('display_name')}
        />
        <Button type="submit" disabled={!dirty || update.isPending} className="w-full">
          {t('common.save')}
        </Button>
      </form>
    </Section>
  )
}
