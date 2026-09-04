'use client'

import { Search } from 'lucide-react'

import { cn } from '@/lib/utils'
import { Input } from '@/components/ui/input'

export function PopoverSearchInput({
  value,
  placeholder,
  onChange,
  bordered,
}: {
  value: string
  placeholder: string
  onChange: (next: string) => void
  bordered: boolean
}) {
  return (
    <div className={cn('border-border/40 relative p-2', bordered && 'border-b')}>
      <Search
        className="text-muted-foreground pointer-events-none absolute top-1/2 left-4 size-4 -translate-y-1/2"
        aria-hidden="true"
      />
      <Input
        type="search"
        inputMode="search"
        value={value}
        placeholder={placeholder}
        onChange={(event) => onChange(event.target.value)}
        className="pl-8"
      />
    </div>
  )
}

export function matchesQuery(label: string, query: string): boolean {
  return label.toLowerCase().includes(query.toLowerCase())
}
