import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { onlineManager } from '@tanstack/react-query'
import { afterEach, describe, expect, it, vi } from 'vitest'

import '@/i18n'
import { NoteEditor } from '@/components/note-editor'
import { LABEL_RENT } from '@/test/constants'

const NOTE = `${LABEL_RENT} for May`
const NOTE_URL = 'https://example.com/invoice'

function renderEditor(remoteNote = NOTE, onSave = vi.fn().mockResolvedValue(undefined)) {
  render(<NoteEditor remoteNote={remoteNote} onSave={onSave} />)
  return { onSave, display: screen.getByRole('button', { name: 'Edit note' }) }
}

function stubCaretApi(name: 'caretPositionFromPoint' | 'caretRangeFromPoint', hit: unknown) {
  Object.defineProperty(document, name, { value: () => hit, configurable: true })
}

afterEach(() => {
  delete (document as Partial<Document>).caretPositionFromPoint
  delete (document as Partial<Document>).caretRangeFromPoint
  onlineManager.setOnline(true)
})

describe('NoteEditor', () => {
  it.each([
    ['Enter', '{Enter}'],
    ['Space', ' '],
  ])('opens the editor from the keyboard with %s', async (_label, key) => {
    const user = userEvent.setup()
    const { display } = renderEditor()

    display.focus()
    await user.keyboard(key)

    expect(screen.getByRole('textbox')).toHaveFocus()
    expect(screen.getByRole('textbox')).toHaveValue(NOTE)
  })

  it('shows the note with its links again once the editor loses focus', async () => {
    const user = userEvent.setup()
    const { display } = renderEditor(`see ${NOTE_URL}`)

    await user.click(display)
    await user.tab()

    expect(screen.queryByRole('textbox')).toBeNull()
    expect(screen.getByRole('link', { name: NOTE_URL })).toBeInTheDocument()
  })

  it('opens a link in the note without entering edit mode', async () => {
    const user = userEvent.setup()
    renderEditor(NOTE_URL)

    await user.click(screen.getByRole('link', { name: NOTE_URL }))

    expect(screen.queryByRole('textbox')).toBeNull()
  })

  it('keeps punctuation after a link out of the link', () => {
    renderEditor(`(${NOTE_URL}), thanks`)
    expect(screen.getByRole('link', { name: NOTE_URL })).toHaveAttribute('href', NOTE_URL)
    expect(screen.getByRole('button', { name: 'Edit note' })).toHaveTextContent(
      `(${NOTE_URL}), thanks`,
    )
  })

  it('puts the caret where the note was clicked', async () => {
    const user = userEvent.setup()
    const { display } = renderEditor()
    stubCaretApi('caretPositionFromPoint', { offsetNode: display.firstChild, offset: 4 })

    await user.click(display)

    expect(screen.getByRole('textbox')).toHaveProperty('selectionStart', 4)
  })

  it('falls back to caretRangeFromPoint where caretPositionFromPoint is missing', async () => {
    const user = userEvent.setup()
    const { display } = renderEditor()
    stubCaretApi('caretRangeFromPoint', { startContainer: display.firstChild, startOffset: 2 })

    await user.click(display)

    expect(screen.getByRole('textbox')).toHaveProperty('selectionStart', 2)
  })

  it.each([
    ['the browser cannot tell the position', null],
    ['the click hit something outside the note', { offsetNode: document.body, offset: 0 }],
  ])('puts the caret at the end when %s', async (_label, hit) => {
    const user = userEvent.setup()
    const { display } = renderEditor()
    stubCaretApi('caretPositionFromPoint', hit)

    await user.click(display)

    expect(screen.getByRole('textbox')).toHaveProperty('selectionStart', NOTE.length)
  })

  it('puts the caret at the end when the browser has no caret hit test', async () => {
    const user = userEvent.setup()
    const { display } = renderEditor()

    await user.click(display)

    expect(screen.getByRole('textbox')).toHaveProperty('selectionStart', NOTE.length)
  })

  it('stays read-only while offline', async () => {
    const user = userEvent.setup()
    onlineManager.setOnline(false)
    const { display } = renderEditor()

    expect(display).toHaveAttribute('aria-disabled', 'true')
    expect(display).toHaveAttribute('tabindex', '-1')
    await user.click(display)
    display.focus()
    await user.keyboard('{Enter}')

    expect(screen.queryByRole('textbox')).toBeNull()
  })

  it('shows that a change is being saved until the save completes', async () => {
    const user = userEvent.setup()
    let finishSave!: () => void
    const onSave = vi.fn(() => new Promise<void>((resolve) => (finishSave = resolve)))
    const { display } = renderEditor('', onSave)

    await user.click(display)
    await user.type(screen.getByRole('textbox'), 'x')
    expect(screen.getByText('Saving …')).toBeInTheDocument()

    await vi.waitFor(() => expect(onSave).toHaveBeenCalledWith('x'))
    finishSave()
    expect(await screen.findByText('Saved')).toBeInTheDocument()
  })
})
