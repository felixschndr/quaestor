import { useState } from 'react'
import { createFileRoute, useRouter } from '@tanstack/react-router'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import {
  Section,
  SettingsSubPage,
  readApiErrorMessage,
} from '@/components/settings/settings-section'
import { useAuthMe, type UserRead } from '@/lib/auth'
import { useDeleteUser } from '@/lib/user'

export const Route = createFileRoute('/settings/user/delete')({
  component: SettingsDeleteAccountPage,
})

function SettingsDeleteAccountPage() {
  const router = useRouter()
  const { data: user } = useAuthMe()
  if (!user) return null // root guard already redirected on 401
  return (
    <SettingsDeleteAccountView user={user} onAccountDeleted={() => router.history.push('/login')} />
  )
}

export function SettingsDeleteAccountView({
  user,
  onAccountDeleted,
}: {
  user: UserRead
  onAccountDeleted: () => void
}) {
  const { t } = useTranslation()
  const remove = useDeleteUser(user.id)
  const [confirming, setConfirming] = useState(false)

  const onConfirm = async () => {
    try {
      await remove.mutateAsync()
      onAccountDeleted()
    } catch (err) {
      toast.error(readApiErrorMessage(err, t))
      setConfirming(false)
    }
  }

  return (
    <SettingsSubPage title={t('settings.deleteAccount')}>
      {confirming ? (
        <Section title={t('settings.dangerZone')} description={t('settings.deleteConfirm')}>
          <div className="flex flex-col gap-2">
            <Button
              type="button"
              variant="destructive"
              onClick={onConfirm}
              disabled={remove.isPending}
              className="w-full"
            >
              {t('settings.deleteAccountConfirm')}
            </Button>
            <Button
              type="button"
              variant="outline"
              onClick={() => setConfirming(false)}
              disabled={remove.isPending}
              className="w-full"
            >
              {t('common.cancel')}
            </Button>
          </div>
        </Section>
      ) : (
        <Section title={t('settings.dangerZone')} description={t('settings.deleteDescription')}>
          <Button
            type="button"
            variant="destructive"
            onClick={() => setConfirming(true)}
            className="w-full"
          >
            {t('settings.deleteAccount')}
          </Button>
        </Section>
      )}
    </SettingsSubPage>
  )
}
