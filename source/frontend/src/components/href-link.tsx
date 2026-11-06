import type { AnchorHTMLAttributes, MouseEvent } from 'react'
import { useNavigate } from '@tanstack/react-router'

export function HrefLink({
  href,
  onClick,
  ...props
}: AnchorHTMLAttributes<HTMLAnchorElement> & { href: string }) {
  const navigate = useNavigate()
  const handleClick = (event: MouseEvent<HTMLAnchorElement>) => {
    onClick?.(event)
    if (
      event.defaultPrevented ||
      event.button !== 0 ||
      event.metaKey ||
      event.ctrlKey ||
      event.shiftKey ||
      event.altKey
    ) {
      return
    }
    event.preventDefault()
    void navigate({ href })
  }
  return <a {...props} href={href} onClick={handleClick} />
}
