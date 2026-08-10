'use client'

import { useState, type ReactNode } from 'react'
import { Info } from 'lucide-react'

import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'

export function InfoHint({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false)
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        type="button"
        aria-label="Info"
        onPointerEnter={(event) => event.pointerType === 'mouse' && setOpen(true)}
        onPointerLeave={(event) => event.pointerType === 'mouse' && setOpen(false)}
        className="text-muted-foreground hover:text-foreground inline-flex cursor-pointer align-middle transition-colors"
      >
        <Info className="size-3.5" aria-hidden="true" />
      </PopoverTrigger>
      <PopoverContent side="top" align="end" className="max-w-xs p-3 text-xs">
        {children}
      </PopoverContent>
    </Popover>
  )
}
