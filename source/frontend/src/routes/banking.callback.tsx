import { useState } from 'react'
import { createFileRoute } from '@tanstack/react-router'
import { useTranslation } from 'react-i18next'
import { z } from 'zod'

import { Button } from '@/components/ui/button'

const callbackSearchSchema = z.object({
  code: z.string().optional(),
  error: z.string().optional(),
})

export const Route = createFileRoute('/banking/callback')({
  component: BankingCallbackPage,
  validateSearch: (search) => callbackSearchSchema.parse(search),
})

function BankingCallbackPage() {
  const { code, error } = Route.useSearch()
  const { t } = useTranslation()
  const [copied, setCopied] = useState(false)

  return (
    <main className="mx-auto flex min-h-dvh max-w-page flex-col items-center justify-center gap-4 p-4 text-center">
      {code ? (
        <>
          <h1 className="text-foreground text-2xl font-semibold">
            {t('credentials.enableBanking.callbackTitle')}
          </h1>
          <p className="text-muted-foreground text-sm">
            {t('credentials.enableBanking.callbackDescription')}
          </p>
          <code className="bg-muted rounded px-3 py-2 text-sm break-all select-all">{code}</code>
          <Button
            onClick={async () => {
              await navigator.clipboard.writeText(code)
              setCopied(true)
            }}
          >
            {copied
              ? t('credentials.enableBanking.callbackCopied')
              : t('credentials.enableBanking.callbackCopy')}
          </Button>
        </>
      ) : (
        <>
          <h1 className="text-foreground text-2xl font-semibold">
            {t('credentials.enableBanking.callbackErrorTitle')}
          </h1>
          <p className="text-muted-foreground text-sm">
            {t('credentials.enableBanking.callbackErrorDescription', {
              error: error ?? 'unknown',
            })}
          </p>
        </>
      )}
    </main>
  )
}
