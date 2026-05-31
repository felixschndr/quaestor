/**
 * Copy `text` to the clipboard, with a fallback for non-secure contexts.
 *
 * `navigator.clipboard` only exists in secure contexts (HTTPS or `localhost`).
 * When the dev server is reached over plain HTTP via a LAN IP, the async API is
 * unavailable, so we fall back to a hidden `<textarea>` + `execCommand('copy')`.
 *
 * Rejects if neither path succeeds, so callers can surface an error.
 */
export async function copyText(text: string): Promise<void> {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(text)
    return
  }

  const textarea = document.createElement('textarea')
  textarea.value = text
  // Keep it out of view and from scrolling/zooming the page on mobile.
  textarea.setAttribute('readonly', '')
  textarea.style.position = 'fixed'
  textarea.style.top = '0'
  textarea.style.left = '0'
  textarea.style.opacity = '0'
  document.body.appendChild(textarea)
  textarea.focus()
  textarea.select()

  try {
    if (!document.execCommand('copy')) {
      throw new Error('Copy command was rejected')
    }
  } finally {
    document.body.removeChild(textarea)
  }
}
