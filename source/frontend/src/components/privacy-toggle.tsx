import { useTranslation } from 'react-i18next'
import { Eye } from 'lucide-react'

import { usePrivacyMode } from '@/lib/privacyMode'
import { cn } from '@/lib/utils'

export function PrivacyToggle({ className }: { className?: string }) {
  const { t } = useTranslation()
  const { hidden, toggle } = usePrivacyMode()
  const label = t(hidden ? 'overview.privacy.show' : 'overview.privacy.hide')

  return (
    <button
      type="button"
      onClick={toggle}
      aria-pressed={hidden}
      aria-label={label}
      title={label}
      className={cn(
        'text-primary hover:text-primary/80 focus-visible:ring-ring group cursor-pointer rounded-md p-1.5 transition-colors focus-visible:ring-2 focus-visible:outline-none',
        className,
      )}
    >
      <span className="relative block size-5">
        <Eye className="size-5" />
        <svg
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth={2}
          strokeLinecap="round"
          aria-hidden="true"
          className="absolute inset-0 size-5"
        >
          <line x1="3" y1="3" x2="21" y2="21" pathLength={1} className="privacy-slash" />
        </svg>
      </span>
    </button>
  )
}
