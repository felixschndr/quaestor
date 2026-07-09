import * as React from 'react'
import { Label as LabelPrimitive } from 'radix-ui'

import { cn } from '@/lib/utils'

function Label({ className, onClick, ...props }: React.ComponentProps<typeof LabelPrimitive.Root>) {
  return (
    <LabelPrimitive.Root
      data-slot="label"
      onClick={(event) => {
        onClick?.(event)
        if (event.defaultPrevented) return
        if (event.currentTarget.control?.dataset.slot === 'popover-trigger') {
          event.preventDefault()
        }
      }}
      className={cn(
        'flex cursor-default items-center gap-2 text-sm leading-none font-medium select-none group-data-[disabled=true]:pointer-events-none group-data-[disabled=true]:opacity-50 peer-disabled:cursor-not-allowed peer-disabled:opacity-50',
        className,
      )}
      {...props}
    />
  )
}

export { Label }
