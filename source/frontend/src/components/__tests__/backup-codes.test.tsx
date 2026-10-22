import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'

import '@/i18n'

import { BackupCodes } from '@/components/backup-codes'
import { BACKUP_CODES } from '@/test/constants'

const BLOB_URL = 'blob:backup-codes'
const { createObjectURL, revokeObjectURL } = URL

afterEach(() => {
  Object.assign(URL, { createObjectURL, revokeObjectURL })
  vi.restoreAllMocks()
})

describe('BackupCodes', () => {
  it('lists every code', () => {
    render(<BackupCodes codes={BACKUP_CODES} onDone={vi.fn()} />)
    const list = screen.getByRole('list', { name: 'Save your backup codes' })
    expect(
      within(list)
        .getAllByRole('listitem')
        .map((item) => item.textContent),
    ).toEqual(BACKUP_CODES)
  })

  it('copies all codes, one per line', async () => {
    const user = userEvent.setup()
    render(<BackupCodes codes={BACKUP_CODES} onDone={vi.fn()} />)

    await user.click(screen.getByRole('button', { name: 'Copy' }))

    expect(await navigator.clipboard.readText()).toBe(BACKUP_CODES.join('\n'))
    expect(screen.getByRole('button', { name: 'Copied' })).toBeInTheDocument()
  })

  it('downloads the codes as a text file and frees the blob URL', async () => {
    const createBlobUrl = vi.fn<(blob: Blob) => string>(() => BLOB_URL)
    const revokeBlobUrl = vi.fn()
    Object.assign(URL, { createObjectURL: createBlobUrl, revokeObjectURL: revokeBlobUrl })
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {})
    render(<BackupCodes codes={BACKUP_CODES} onDone={vi.fn()} />)

    await userEvent.click(screen.getByRole('button', { name: 'Download' }))

    const [anchor] = click.mock.contexts as HTMLAnchorElement[]
    expect(anchor.download).toBe('quaestor-backup-codes.txt')
    expect(anchor.getAttribute('href')).toBe(BLOB_URL)
    const [blob] = createBlobUrl.mock.calls[0]
    expect(blob.type).toBe('text/plain')
    expect(await blob.text()).toBe(`${BACKUP_CODES.join('\n')}\n`)
    expect(revokeBlobUrl).toHaveBeenCalledWith(BLOB_URL)
  })

  it('finishes once the user confirms the codes are saved', async () => {
    const onDone = vi.fn()
    render(<BackupCodes codes={BACKUP_CODES} onDone={onDone} />)

    await userEvent.click(screen.getByRole('button', { name: "I've saved my backup codes" }))

    expect(onDone).toHaveBeenCalledOnce()
  })
})
