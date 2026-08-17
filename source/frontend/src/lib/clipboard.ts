import { useEffect, useRef, useState } from 'react'

export async function copyText(text: string): Promise<void> {
  await navigator.clipboard.writeText(text)
}

export const COPY_FEEDBACK_MS = 2000

export function useCopyFeedback() {
  const [copied, setCopied] = useState(false)
  const resetTimeout = useRef<ReturnType<typeof setTimeout>>(undefined)

  useEffect(() => () => clearTimeout(resetTimeout.current), [])

  const copy = async (text: string): Promise<boolean> => {
    try {
      await copyText(text)
    } catch {
      return false
    }
    setCopied(true)
    clearTimeout(resetTimeout.current)
    resetTimeout.current = setTimeout(() => setCopied(false), COPY_FEEDBACK_MS)
    return true
  }

  return { copied, copy }
}
