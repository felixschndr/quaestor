import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'

function legacyCopy(text: string): void {
  const area = document.createElement('textarea')
  area.value = text
  area.readOnly = true
  area.style.position = 'fixed'
  area.style.opacity = '0'
  document.body.append(area)
  area.select()
  try {
    if (!document.execCommand('copy')) throw new Error('copy command rejected')
  } finally {
    area.remove()
  }
}

export async function copyText(text: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(text)
    return
  } catch {
    // navigator.clipboard only exists in secure contexts (HTTPS or localhost)
  }
  legacyCopy(text)
}

export const COPY_FEEDBACK_MS = 2000

export function useCopyFeedback() {
  const { t } = useTranslation()
  const [copied, setCopied] = useState(false)
  const resetTimeout = useRef<ReturnType<typeof setTimeout>>(undefined)

  useEffect(() => () => clearTimeout(resetTimeout.current), [])

  const copy = async (text: string): Promise<boolean> => {
    try {
      await copyText(text)
    } catch {
      toast.error(t('common.copyFailed'))
      return false
    }
    setCopied(true)
    clearTimeout(resetTimeout.current)
    resetTimeout.current = setTimeout(() => setCopied(false), COPY_FEEDBACK_MS)
    return true
  }

  return { copied, copy }
}
