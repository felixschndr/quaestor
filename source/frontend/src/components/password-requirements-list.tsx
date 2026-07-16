import { Check, X } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import { evaluatePassword, type PasswordRequirements } from '@/lib/auth'
import { cn } from '@/lib/utils'

export function PasswordRequirementsList({
  password,
  requirements,
}: {
  password: string
  requirements: PasswordRequirements | undefined
}) {
  const { t } = useTranslation()
  if (!requirements) return null
  const { unmetRuleNames, tooShort } = evaluatePassword(password, requirements)
  const items: { key: string; ok: boolean; label: string }[] = [
    {
      key: 'min_length',
      ok: !tooShort,
      label: t('login.passwordRuleMinLength', { count: requirements.min_length }),
    },
    ...requirements.rules.map((rule) => ({
      key: rule.name,
      ok: !unmetRuleNames.includes(rule.name),
      label: t(`login.passwordRule.${rule.name}`, { defaultValue: rule.description }),
    })),
  ]
  const showStatus = password.length > 0
  return (
    <div className="flex flex-col gap-1.5 text-xs">
      <p className="text-muted-foreground">{t('login.passwordRules')}</p>
      <ul aria-label={t('login.passwordRules')} className="flex flex-col gap-1">
        {items.map((item) => (
          <li
            key={item.key}
            className={cn(
              'flex items-center gap-1.5',
              showStatus && item.ok ? 'text-success' : 'text-muted-foreground',
            )}
          >
            {showStatus ? (
              item.ok ? (
                <Check className="size-3.5" />
              ) : (
                <X className="size-3.5" />
              )
            ) : (
              <span aria-hidden="true" className="size-3.5 text-center leading-none">
                •
              </span>
            )}
            {item.label}
          </li>
        ))}
      </ul>
    </div>
  )
}
