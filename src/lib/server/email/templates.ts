import "server-only"

export type TextEmail = {
  subject: string
  text: string
}

export type PasswordResetEmailParams = {
  appName: string
  email: string
  resetUrl: string
  expiresIn: string
  supportEmail?: string
  requestedAt?: string
  requestIp?: string | null
  requestUserAgent?: string | null
}

export function renderPasswordResetEmail(p: PasswordResetEmailParams): TextEmail {
  const supportLine = p.supportEmail?.trim() ? `\nNeed help? Contact us at ${p.supportEmail.trim()}.\n` : ""

  const hasCtx = Boolean(p.requestedAt || p.requestIp || p.requestUserAgent)
  const ctx = hasCtx
    ? [
        "",
        "Request details:",
        p.requestedAt ? `- Time: ${p.requestedAt}` : null,
        p.requestIp ? `- IP: ${p.requestIp}` : null,
        p.requestUserAgent ? `- Device: ${p.requestUserAgent}` : null,
      ]
        .filter(Boolean)
        .join("\n")
    : ""

  return {
    subject: `Reset your ${p.appName} password`,
    text: [
      "Hi,",
      "",
      `We received a request to reset the password for your ${p.appName} account (${p.email}).`,
      "",
      `Reset your password (link expires in ${p.expiresIn}):`,
      p.resetUrl,
      "",
      "If you didn’t request this, you can safely ignore this email—your password won’t change.",
      "",
      "For your security:",
      "- This link can be used only once.",
      "- Don’t share this link with anyone.",
      ctx,
      "",
      `Thanks,`,
      `${p.appName} Team`,
      supportLine.trimEnd(),
    ]
      .filter((s) => s !== "")
      .join("\n"),
  }
}

export type SmtpTestEmailParams = {
  appName: string
  instanceOrigin?: string | null
}

export function renderSmtpTestEmail(p: SmtpTestEmailParams): TextEmail {
  const originLine = p.instanceOrigin?.trim() ? `\nSent by: ${p.instanceOrigin.trim()}\n` : ""
  return {
    subject: `SMTP test email — ${p.appName}`,
    text: `This is a test email from your ${p.appName} instance.\n\nIf you received this message, your SMTP settings are working.${originLine}`,
  }
}
