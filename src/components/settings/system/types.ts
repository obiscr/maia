export type RegistrationMode = "DISABLED" | "OPEN" | "INVITE_ONLY"

export type SystemSettings = {
  registrationMode: RegistrationMode

  smtpEnabled: boolean
  smtpHost: string
  smtpPort: number | null
  smtpSecure: boolean
  smtpUsername: string
  smtpFromEmail: string
  smtpFromName: string
  smtpPassword: string
  smtpPasswordConfigured: boolean

  globalRunConcurrency: number | null
  perRunStepConcurrency: number | null
  defaultStepTimeoutMs: number | null
  inputDownloadConcurrency: number | null
  inputDownloadTimeoutMs: number | null
  inputDownloadMaxBytes: number | null
}

export const DEFAULT_SYSTEM_SETTINGS: SystemSettings = {
  registrationMode: "DISABLED",

  smtpEnabled: false,
  smtpHost: "",
  smtpPort: null,
  smtpSecure: false,
  smtpUsername: "",
  smtpFromEmail: "",
  smtpFromName: "",
  smtpPassword: "",
  smtpPasswordConfigured: false,

  globalRunConcurrency: null,
  perRunStepConcurrency: null,
  defaultStepTimeoutMs: null,
  inputDownloadConcurrency: null,
  inputDownloadTimeoutMs: null,
  inputDownloadMaxBytes: null,
}

export function normalizeSystemSettings(input: Partial<SystemSettings> | null | undefined): SystemSettings {
  const s = input ?? {}
  const registrationMode =
    s.registrationMode === "OPEN" || s.registrationMode === "INVITE_ONLY" || s.registrationMode === "DISABLED"
      ? s.registrationMode
      : "DISABLED"

  return {
    registrationMode,

    smtpEnabled: Boolean(s.smtpEnabled),
    smtpHost: String(s.smtpHost ?? ""),
    smtpPort: typeof s.smtpPort === "number" ? s.smtpPort : null,
    smtpSecure: Boolean(s.smtpSecure),
    smtpUsername: String(s.smtpUsername ?? ""),
    smtpFromEmail: String(s.smtpFromEmail ?? ""),
    smtpFromName: String(s.smtpFromName ?? ""),
    smtpPassword: String(s.smtpPassword ?? ""),
    smtpPasswordConfigured: Boolean(s.smtpPasswordConfigured),

    globalRunConcurrency: typeof s.globalRunConcurrency === "number" ? s.globalRunConcurrency : null,
    perRunStepConcurrency: typeof s.perRunStepConcurrency === "number" ? s.perRunStepConcurrency : null,
    defaultStepTimeoutMs: typeof s.defaultStepTimeoutMs === "number" ? s.defaultStepTimeoutMs : null,
    inputDownloadConcurrency: typeof s.inputDownloadConcurrency === "number" ? s.inputDownloadConcurrency : null,
    inputDownloadTimeoutMs: typeof s.inputDownloadTimeoutMs === "number" ? s.inputDownloadTimeoutMs : null,
    inputDownloadMaxBytes: typeof s.inputDownloadMaxBytes === "number" ? s.inputDownloadMaxBytes : null,
  }
}
