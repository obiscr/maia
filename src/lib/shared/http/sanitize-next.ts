export function sanitizeNext(
  raw: string | null,
  params?: {
    allowAuthPages?: boolean
  },
): string {
  const v = String(raw ?? "").trim()
  if (!v) return "/"

  // Only allow same-origin relative paths.
  if (!v.startsWith("/")) return "/"
  if (v.startsWith("//")) return "/"

  if (params?.allowAuthPages) return v

  // Never bounce back into auth pages.
  const denied = [
    "/signin",
    "/signup",
    "/otp",
    "/setup",
    "/auth/redirect",
    "/forgot-password",
    "/reset-password",
    "/email-otp",
    "/magic-link",
    "/confirm-email",
    "/auth/magic",
  ]
  for (const p of denied) {
    if (v === p || v.startsWith(`${p}?`)) return "/"
  }

  return v
}
