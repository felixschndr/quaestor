'use client'

import { useTranslation } from 'react-i18next'
import { Search } from 'lucide-react'

/** Names what a filter box does, so the controls aren't unlabelled. */
function FilterHeading() {
  const { t } = useTranslation()
  return (
    <h2 className="text-primary flex items-center gap-2 text-sm font-semibold">
      <Search className="size-3.5" aria-hidden="true" />
      {t('common.searchAndFilters')}
    </h2>
  )
}

export { FilterHeading }
