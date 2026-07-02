import { useEffect, useState } from 'react'
import { Check, RefreshCw } from 'lucide-react'

import { cn } from '@/lib/utils'

// Success-check animation timings. Kept short on the in/out so the user
// perceives a snappy pop; the hold dominates because the value to show is the
// confirmation, not the motion.
const CHECK_ZOOM_MS = 200
const CHECK_HOLD_MS = 1200

export interface SyncButtonProps {
  onClick: () => void
  /** True while the sync run hasn't started yet — disables the click and
   *  spins the icon. */
  spinning: boolean
  /** External "please don't accept clicks right now" flag, independent of
   *  spinning (e.g. a separate disabled reason from the caller). */
  disabled?: boolean
  /** Monotonic timestamp (Date.now()) refreshed each time a sync run
   *  completes successfully. Changes trigger the green-check animation;
   *  null suppresses it. */
  succeededAt: number | null
  ariaLabel: string
  className?: string
}

/**
 * The sync trigger used on both the overview and the account-detail header.
 * Renders a {@link RefreshCw} that spins while busy; when {@link succeededAt}
 * changes, the icon morphs into a green {@link Check} that zooms in from the
 * center, holds, and zooms back out before the {@link RefreshCw} returns.
 *
 * The button stays disabled for the duration of the success animation so a
 * second click can't interrupt the visual confirmation.
 */
export function SyncButton({
  onClick,
  spinning,
  disabled = false,
  succeededAt,
  ariaLabel,
  className,
}: SyncButtonProps) {
  // mounted = is the Check in the DOM at all? (false = RefreshCw is shown)
  // open    = should the Check sit at scale-100? (false = scale-0)
  const [checkMounted, setCheckMounted] = useState(false)
  const [checkOpen, setCheckOpen] = useState(false)

  useEffect(() => {
    if (succeededAt === null) return
    // The whole purpose of this effect is to kick off the animation chain in
    // response to the changing succeededAt prop — the rule's loop concern
    // doesn't apply because the early-return above gates re-entry.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setCheckMounted(true)
    // requestAnimationFrame gives the browser one paint at scale-0 before we
    // flip to scale-1; without it the transition is skipped because both
    // styles are applied in the same frame.
    const raf = requestAnimationFrame(() => setCheckOpen(true))
    const closeTimer = setTimeout(() => setCheckOpen(false), CHECK_ZOOM_MS + CHECK_HOLD_MS)
    const unmountTimer = setTimeout(
      () => setCheckMounted(false),
      CHECK_ZOOM_MS + CHECK_HOLD_MS + CHECK_ZOOM_MS,
    )
    return () => {
      cancelAnimationFrame(raf)
      clearTimeout(closeTimer)
      clearTimeout(unmountTimer)
    }
  }, [succeededAt])

  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled || checkMounted}
      aria-label={ariaLabel}
      className={cn(
        'group cursor-pointer rounded-md p-1.5 transition-colors disabled:cursor-default disabled:opacity-50',
        checkMounted ? 'text-success disabled:opacity-100' : 'text-primary hover:text-primary/80',
        className,
      )}
    >
      {checkMounted ? (
        // Inline duration keeps the CSS-transition timing in lockstep with the
        // setTimeout chain above. The transform origin sits at the icon's
        // center by default, so the zoom radiates outward from the middle.
        <Check
          className={cn(
            'size-5 transition-transform ease-out',
            checkOpen ? 'scale-100' : 'scale-0',
          )}
          style={{ transitionDuration: `${CHECK_ZOOM_MS}ms` }}
          aria-hidden="true"
        />
      ) : (
        <RefreshCw
          className={cn(
            'size-5 transition-transform duration-500 ease-in-out',
            spinning ? 'animate-spin' : 'group-hover:rotate-[180deg]',
          )}
          aria-hidden="true"
        />
      )}
    </button>
  )
}
