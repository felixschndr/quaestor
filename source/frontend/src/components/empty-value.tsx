import { useTranslation } from 'react-i18next'

export function EmptyValue() {
  const { t } = useTranslation()
  return <span className="text-muted-foreground">{t('transaction.fieldEmpty')}</span>
}
