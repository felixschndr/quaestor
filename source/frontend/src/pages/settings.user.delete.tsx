import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import { Section, SettingsSubPage } from '@/components/settings/settings-section'
import { readApiErrorMessage } from '@/lib/apiError'
import { type UserRead } from '@/lib/auth'
import { useDeleteUser } from '@/lib/user'

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
    <SettingsSubPage title={t('common.deleteAccount')}>
      {confirming ? (
        <Section title={t('common.dangerZone')} description={t('settings.deleteConfirm')}>
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
        <Section title={t('common.dangerZone')} description={t('settings.deleteDescription')}>
          <Button
            type="button"
            variant="destructive"
            onClick={() => setConfirming(true)}
            className="w-full"
          >
            {t('common.deleteAccount')}
          </Button>
        </Section>
      )}
    </SettingsSubPage>
  )
}
