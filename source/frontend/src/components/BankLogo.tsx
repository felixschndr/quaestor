import { useState } from 'react'
import { initials, monogramColor } from '@/lib/bankIdentity'

export interface BankLogoProps {
  icon: string | null
  name: string
  /** Seed for the deterministic monogram colour (use the catalog key/BLZ). */
  seed: string
  className?: string
}

/** A bank's logo image, with an initials-monogram fallback when no logo exists
 *  or the image fails to load. */
export function BankLogo({ icon, name, seed, className = 'size-8' }: BankLogoProps) {
  const [failedIcon, setFailedIcon] = useState<string | null>(null)
  // Reset the failure flag when the icon changes (e.g. list re-render with a new bank).
  const failed = failedIcon === icon

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
