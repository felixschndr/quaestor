import { useEffect, useRef, useState } from 'react'

export type AutoSaveStatus = 'idle' | 'pending' | 'saving' | 'saved' | 'error'

type SavePhase = 'idle' | 'saving' | 'saved' | 'error'

interface Args<T> {
  /** The current local value the user is editing. */
  value: T
  /** The value that's currently persisted on the server — passed in so the
   *  hook can detect "no change since last save" and skip a redundant write. */
  remoteValue: T
  /** Called with the value once the debounce has elapsed. */
  onSave: (value: T) => Promise<unknown>
  /** Debounce window in milliseconds. */
  delayMs?: number
}

/**
 * Fires `onSave(value)` once the user has stopped editing for `delayMs`,
 * and never if the value matches the last-saved remote value. Returns a
 * status string the UI can use for a "Saving…" / "Saved" indicator.
 *
 * `pending` is derived during render (dirty value, no save in flight); only
 * `saving`/`saved`/`error` come from the async lifecycle. This keeps the
 * effect from calling setState synchronously.
 */
export function useDebouncedAutoSave<T>({
  value,
  remoteValue,
  onSave,
  delayMs = 500,
}: Args<T>): AutoSaveStatus {
  const [phase, setPhase] = useState<SavePhase>('idle')
  // Tracks the most recent value we successfully sent to onSave, so the hook
  // can recognise "I already saved exactly this value" even before the parent
  // re-renders with the new remoteValue. Without this the status flicks back
  // to 'pending' immediately after 'saved' on the round trip.
  const [lastSaved, setLastSaved] = useState<T | undefined>(undefined)
  const onSaveRef = useRef(onSave)
  useEffect(() => {
    onSaveRef.current = onSave
  }, [onSave])

  const isDirty = value !== remoteValue && value !== lastSaved

  useEffect(() => {
    if (!isDirty) return
    const timer = setTimeout(async () => {
      setPhase('saving')
      try {
        await onSaveRef.current(value)
        setLastSaved(() => value)
        setPhase('saved')
      } catch {
        setPhase('error')
      }
    }, delayMs)
    return () => clearTimeout(timer)
  }, [value, isDirty, delayMs])

  // Precedence: an in-flight save or a failed attempt wins over "user is
  // typing" — the user wants to know the save is happening or failed before
  // they see a fresh "pending".
  if (phase === 'saving' || phase === 'error') return phase
  if (isDirty) return 'pending'
  return phase
}
