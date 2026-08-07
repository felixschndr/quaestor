import { Link, useCanGoBack, useRouter } from '@tanstack/react-router'
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
  const router = useRouter()
  const canGoBack = useCanGoBack()
  const linkProps = rest as ComponentProps<typeof Link>

  const handleClick: React.MouseEventHandler<HTMLAnchorElement> = (event) => {
    rest.onClick?.(event)
    if (event.defaultPrevented) return
    if (!canGoBack) return
    if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || event.button !== 0) {
      return
    }
    event.preventDefault()
    router.history.back()
  }

  if (children) {
    return (
      <Link
        className="text-primary hover:text-primary/80 -ml-1.5 inline-flex items-center gap-1 rounded-md p-1.5 text-sm transition-colors"
        {...linkProps}
        onClick={handleClick}
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
      onClick={handleClick}
    >
      <ChevronLeft className="size-5" />
    </Link>
  )
}
