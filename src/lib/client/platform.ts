export function isApplePlatform(): boolean {
  if (typeof navigator === "undefined") return false

  // Prefer modern UA Client Hints when available (Chromium-based browsers).
  const uaData = (navigator as unknown as { userAgentData?: { platform?: string } }).userAgentData
  const platform = uaData?.platform ?? navigator.platform ?? ""
  if (/mac|iphone|ipad|ipod/i.test(platform)) return true

  // Fallback: userAgent (less reliable, but works in Safari/Firefox and older browsers).
  return /Mac|iPhone|iPad|iPod/i.test(navigator.userAgent ?? "")
}

export function getCmdOrCtrlLabel(): "⌘" | "Ctrl" {
  return isApplePlatform() ? "⌘" : "Ctrl"
}
