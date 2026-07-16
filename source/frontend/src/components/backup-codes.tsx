import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Check, Copy, Download } from 'lucide-react'

import { copyText } from '@/lib/clipboard'
import { Button } from '@/components/ui/button'

export interface BackupCodesProps {
  codes: string[]
  onDone: () => void
}

export function BackupCodes({ codes, onDone }: BackupCodesProps) {
  const { t } = useTranslation()
  const [copied, setCopied] = useState(false)

  const asText = codes.join('\n')

  const copy = async () => {
    try {
      await copyText(asText)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      // Clipboard can be unavailable (insecure context / denied permission); the download
      // button and the on-screen codes remain as fallbacks.
    }
  }

  const download = () => {
    const blob = new Blob([asText + '\n'], { type: 'text/plain' })
    const url = URL.createObjectURL(blob)
    const anchor = document.createElement('a')
    anchor.href = url
    anchor.download = 'quaestor-backup-codes.txt'
    anchor.click()
    URL.revokeObjectURL(url)
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-1">
        <h3 className="text-foreground text-base font-semibold">{t('twoFactor.backupTitle')}</h3>
        <p className="text-muted-foreground text-sm">{t('twoFactor.backupHint')}</p>
      </div>

      <ul
        aria-label={t('twoFactor.backupTitle')}
        className="border-border bg-muted/40 flex flex-col gap-1.5 rounded-md border p-3 text-center font-mono text-sm"
      >
        {codes.map((code) => (
          <li key={code} className="tracking-wider tabular-nums">
            {code}
          </li>
        ))}
      </ul>

      <div className="flex gap-2">
        <Button type="button" variant="outline" size="sm" onClick={copy} className="flex-1">
          {copied ? <Check className="size-3.5 text-success" /> : <Copy className="size-3.5" />}
          {copied ? t('common.copied') : t('common.copy')}
        </Button>
        <Button type="button" variant="outline" size="sm" onClick={download} className="flex-1">
          <Download className="size-3.5" />
          {t('twoFactor.download')}
        </Button>
      </div>

      <Button type="button" onClick={onDone} className="w-full">
        {t('twoFactor.backupSaved')}
      </Button>
    </div>
  )
}
