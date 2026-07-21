function copyTextWithDocument(value: string) {
  if (typeof document === "undefined" || !document.body) {
    return false
  }

  const textarea = document.createElement("textarea")
  const selection = document.getSelection()
  const selectedRanges = selection
    ? Array.from({ length: selection.rangeCount }, (_, index) =>
        selection.getRangeAt(index).cloneRange()
      )
    : []
  const activeElement =
    document.activeElement instanceof HTMLElement
      ? document.activeElement
      : null

  textarea.value = value
  textarea.setAttribute("readonly", "")
  textarea.style.position = "fixed"
  textarea.style.top = "0"
  textarea.style.left = "0"
  textarea.style.width = "1px"
  textarea.style.height = "1px"
  textarea.style.opacity = "0"
  document.body.appendChild(textarea)
  textarea.focus({ preventScroll: true })
  textarea.select()
  textarea.setSelectionRange(0, value.length)

  try {
    return document.execCommand("copy")
  } catch {
    return false
  } finally {
    textarea.remove()
    selection?.removeAllRanges()
    selectedRanges.forEach((range) => selection?.addRange(range))
    activeElement?.focus({ preventScroll: true })
  }
}

export async function writeTextToClipboard(value: string) {
  if (typeof navigator !== "undefined" && navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(value)
      return true
    } catch {
      // Electron and non-secure preview contexts may expose the Clipboard API
      // while still rejecting writes. Use the document fallback below.
    }
  }

  return copyTextWithDocument(value)
}
