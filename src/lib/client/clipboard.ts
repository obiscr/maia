export async function copyTextToClipboard(text: string): Promise<void> {
  // Prefer the modern async clipboard API (requires secure context / permissions).
  try {
    await navigator.clipboard.writeText(text)
    return
  } catch {
    // Fallback for older browsers / non-secure contexts.
  }

  try {
    const el = document.createElement("textarea")
    el.value = text
    el.setAttribute("readonly", "")
    el.style.position = "absolute"
    el.style.left = "-9999px"
    document.body.appendChild(el)
    el.select()
    document.execCommand("copy")
    document.body.removeChild(el)
  } catch {
    throw new Error("copy_failed")
  }
}
