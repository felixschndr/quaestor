import { Link } from '@tanstack/react-router'
import { ChevronLeft } from 'lucide-react'
import type { ComponentProps } from 'react'
import { useTranslation } from 'react-i18next'

type BackLinkProps = {
  to: string
  params?: Record<string, string>
  onClick?: React.MouseEventHandler<HTMLAnchorElement>
  label?: string
  children?: React.ReactNode
}

export function BackLink({ label, children, ...rest }: BackLinkProps) {
  const { t } = useTranslation()
  const linkProps = rest as ComponentProps<typeof Link>
  if (children) {
    return (
      <Link
        className="text-primary hover:text-primary/80 -ml-1.5 inline-flex items-center gap-1 rounded-md p-1.5 text-sm transition-colors"
        {...linkProps}
      >
        <ChevronLeft className="size-4" />
        {children}
      </Link>
    )
  }
  return (
    <Link
      aria-label={label ?? t('common.back')}
      className="text-primary hover:text-primary/80 -ml-1.5 rounded-md p-1.5 transition-colors"
      {...linkProps}
    >
      <ChevronLeft className="size-5" />
    </Link>
  )
}
