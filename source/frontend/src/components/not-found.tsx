import { Link } from '@tanstack/react-router'
import type { ComponentProps } from 'react'

import yodaUrl from '@/assets/yoda.svg'
import { Button } from '@/components/ui/button'

type NotFoundProps = {
  message: string
  backTo: ComponentProps<typeof Link>['to']
  backLabel: string
}

export function NotFound({ message, backTo, backLabel }: NotFoundProps) {
  return (
    <main className="mx-auto flex min-h-[calc(100dvh-var(--bottom-bar-height))] max-w-page flex-col items-center justify-center gap-5 p-4 sm:min-h-dvh">
      <p
        role="status"
        className="border-border bg-card text-foreground relative rounded-2xl border px-4 py-3 text-sm whitespace-nowrap shadow-sm sm:text-base"
      >
        {message}
        <span
          aria-hidden="true"
          className="border-border bg-card absolute -bottom-[7px] left-1/2 size-3 -translate-x-1/2 rotate-45 border-r border-b"
        />
      </p>
      <img src={yodaUrl} alt="" className="w-52 max-w-full" />
      <Button asChild variant="outline" className="mt-3">
        <Link to={backTo} replace>
          {backLabel}
        </Link>
      </Button>
    </main>
  )
}
