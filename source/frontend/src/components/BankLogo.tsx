import { useEffect, useState } from 'react'
import { initials, monogramColor } from '@/lib/bankIdentity'

const pinned = new Map<string, HTMLImageElement>()
function preloadIcon(url: string): void {
  if (pinned.has(url)) return
  const img = new Image()
  pinned.set(url, img)
  img.onerror = () => pinned.delete(url) // let failed loads retry later
  img.src = url
}

export interface BankLogoProps {
  icon: string | null
  name: string
  seed: string
  className?: string
}

export function BankLogo({ icon, name, seed, className = 'size-8' }: BankLogoProps) {
  const [failedIcon, setFailedIcon] = useState<string | null>(null)
  const failed = failedIcon === icon
  useEffect(() => {
    if (icon) preloadIcon(icon)
  }, [icon])

  if (icon && !failed) {
    return (
      <img
        src={icon}
        alt=""
        loading="lazy"
        decoding="async"
        aria-hidden="true"
        className={`${className} rounded-md object-cover`}
        onError={() => setFailedIcon(icon)}
      />
    )
  }
  return (
    <span
      aria-hidden="true"
      className={`${className} flex items-center justify-center rounded-md text-xs font-semibold text-white`}
      style={{ backgroundColor: monogramColor(seed) }}
    >
      {initials(name)}
    </span>
  )
}
