import { useEffect, useRef, useState, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'

import { useDebouncedAutoSave, type AutoSaveStatus } from '@/hooks/useDebouncedAutoSave'

const NOTE_URL_PATTERN =
  /(https?:\/\/[^\s]+|(?<![@\w/.])(?:[a-z0-9][a-z0-9-]*\.)+[a-z]{2,}(?:\/[^\s]*)?)/gi

function linkifyNote(text: string): ReactNode[] {
  const nodes: ReactNode[] = []
  let lastIndex = 0
  let key = 0
  NOTE_URL_PATTERN.lastIndex = 0
  let match: RegExpExecArray | null
  while ((match = NOTE_URL_PATTERN.exec(text)) !== null) {
    let url = match[0]
    const trailing = url.match(/[.,;:!?)\]}'"]+$/)?.[0] ?? ''
    if (trailing) url = url.slice(0, -trailing.length)
    if (url.length === 0) continue

    if (match.index > lastIndex) nodes.push(text.slice(lastIndex, match.index))
    const href = /^https?:\/\//i.test(url) ? url : `https://${url}`
    nodes.push(
      <a
        key={key++}
        href={href}
        target="_blank"
        rel="noopener noreferrer"
        onClick={(event) => event.stopPropagation()}
        className="text-primary break-all underline underline-offset-2 hover:no-underline"
      >
        {url}
      </a>,
    )
    if (trailing) nodes.push(trailing)
    lastIndex = match.index + match[0].length
  }
  if (lastIndex < text.length) nodes.push(text.slice(lastIndex))
  return nodes
}

export function NoteEditor({
  remoteNote,
  onSave,
}: {
  remoteNote: string
  onSave: (note: string | null) => Promise<unknown>
}) {
  const { t } = useTranslation()
  const [draft, setDraft] = useState(remoteNote)
  const [editing, setEditing] = useState(false)
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  const status = useDebouncedAutoSave({
    value: draft,
    remoteValue: remoteNote,
    onSave: (value) => onSave(value.length === 0 ? null : value),
  })

  useEffect(() => {
    if (!editing) return
    const textarea = textareaRef.current
    if (!textarea) return
    textarea.focus()
    const end = textarea.value.length
    textarea.setSelectionRange(end, end)
  }, [editing])

  if (!editing) {
    return (
      <div className="flex flex-col gap-1.5">
        <div
          role="button"
          tabIndex={0}
          aria-label={t('note.edit')}
          onClick={() => setEditing(true)}
          onKeyDown={(event) => {
            if (event.key === 'Enter' || event.key === ' ') {
              event.preventDefault()
              setEditing(true)
            }
          }}
          className="border-input hover:border-ring min-h-16 w-full cursor-text rounded-lg border bg-transparent px-2.5 py-1.5 text-base lg:text-sm whitespace-pre-wrap transition-colors dark:bg-input/30"
        >
          {draft.length === 0 ? (
            <span className="text-muted-foreground">{t('note.placeholder')}</span>
          ) : (
            linkifyNote(draft)
          )}
        </div>
        <NoteStatus status={status} />
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-1.5">
      <textarea
        ref={textareaRef}
        value={draft}
        onChange={(event) => setDraft(event.target.value)}
        onBlur={() => setEditing(false)}
        placeholder={t('note.placeholder')}
        className="border-input focus-visible:border-ring focus-visible:ring-ring/50 min-h-16 w-full rounded-lg border bg-transparent px-2.5 py-1.5 text-base lg:text-sm outline-none transition-colors focus-visible:ring-3 dark:bg-input/30"
      />
      <NoteStatus status={status} />
    </div>
  )
}

function NoteStatus({ status }: { status: AutoSaveStatus }) {
  const { t } = useTranslation()
  if (status === 'saving' || status === 'pending') {
    return <span className="text-muted-foreground text-xs">{t('note.saving')}</span>
  }
  if (status === 'saved') {
    return <span className="text-success text-xs">{t('note.saved')}</span>
  }
  return null
}
