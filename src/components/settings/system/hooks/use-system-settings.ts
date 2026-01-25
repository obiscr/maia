"use client"

import { useEffect, useMemo, useState } from "react"

import type { SystemSettings } from "@/components/settings/system/types"
import { normalizeSystemSettings, DEFAULT_SYSTEM_SETTINGS } from "@/components/settings/system/types"
import { apiFetchJson } from "@/lib/shared/http/api"
import { tApiError } from "@/lib/shared/i18n/error"
import { toast } from "@/lib/client/toast"
import { useI18n } from "@/components/i18n-provider"

export type SavingSection = null | "registration" | "smtp" | "performance"

type PerfSource = "override" | "env" | "default" | "invalid_env"
type PerfInfo = {
  effective: {
    globalRunConcurrency: number
    perRunStepConcurrency: number
    defaultStepTimeoutMs: number
    inputDownloadConcurrency: number
    inputDownloadTimeoutMs: number
    inputDownloadMaxBytes: number
  }
  source: {
    globalRunConcurrency: PerfSource
    perRunStepConcurrency: PerfSource
    defaultStepTimeoutMs: PerfSource
    inputDownloadConcurrency: PerfSource
    inputDownloadTimeoutMs: PerfSource
    inputDownloadMaxBytes: PerfSource
  }
}

export function useSystemSettings() {
  const { t } = useI18n()
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [savingSection, setSavingSection] = useState<SavingSection>(null)

  const [performanceLocked, setPerformanceLocked] = useState(false)
  const [performanceInfo, setPerformanceInfo] = useState<PerfInfo | null>(null)

  const [initial, setInitial] = useState<SystemSettings>(DEFAULT_SYSTEM_SETTINGS)

  const [registrationMode, setRegistrationMode] = useState<SystemSettings["registrationMode"]>(
    DEFAULT_SYSTEM_SETTINGS.registrationMode,
  )

  const [smtpEnabled, setSmtpEnabled] = useState(DEFAULT_SYSTEM_SETTINGS.smtpEnabled)
  const [smtpHost, setSmtpHost] = useState(DEFAULT_SYSTEM_SETTINGS.smtpHost)
  const [smtpPort, setSmtpPort] = useState<string>("")
  const [smtpSecure, setSmtpSecure] = useState(DEFAULT_SYSTEM_SETTINGS.smtpSecure)
  const [smtpUsername, setSmtpUsername] = useState(DEFAULT_SYSTEM_SETTINGS.smtpUsername)
  const [smtpFromEmail, setSmtpFromEmail] = useState(DEFAULT_SYSTEM_SETTINGS.smtpFromEmail)
  const [smtpFromName, setSmtpFromName] = useState(DEFAULT_SYSTEM_SETTINGS.smtpFromName)

  const [smtpPasswordDraft, setSmtpPasswordDraft] = useState("")
  const [lastSavedSmtpPasswordDraft, setLastSavedSmtpPasswordDraft] = useState("")
  const [smtpPasswordConfigured, setSmtpPasswordConfigured] = useState(false)
  const [showSmtpPassword, setShowSmtpPassword] = useState(false)
  const [smtpTestTo, setSmtpTestTo] = useState("")
  const [sendingTest, setSendingTest] = useState(false)

  // Advanced runtime tuning (persisted overrides; env stays as fallback)
  const [globalRunConcurrency, setGlobalRunConcurrency] = useState<string>("")
  const [perRunStepConcurrency, setPerRunStepConcurrency] = useState<string>("")
  const [defaultStepTimeoutMs, setDefaultStepTimeoutMs] = useState<string>("")
  const [inputDownloadConcurrency, setInputDownloadConcurrency] = useState<string>("")
  const [inputDownloadTimeoutMs, setInputDownloadTimeoutMs] = useState<string>("")
  const [inputDownloadMaxBytes, setInputDownloadMaxBytes] = useState<string>("")

  const [recommendedGlobalRunConcurrency, setRecommendedGlobalRunConcurrency] = useState<number | null>(null)
  const [hardwareSummary, setHardwareSummary] = useState<string>("")

  useEffect(() => {
    let cancelled = false
    async function load() {
      setLoading(true)
      try {
        const json = await apiFetchJson<{
          settings?: Partial<SystemSettings>
          locks?: { performance?: boolean }
          performance?: PerfInfo
        }>("/api/settings/system", { method: "GET" })
        const s = normalizeSystemSettings(json.settings)
        if (cancelled) return
        setInitial(s)
        setPerformanceLocked(Boolean(json.locks?.performance))
        setPerformanceInfo(json.performance ?? null)

        setRegistrationMode(s.registrationMode)

        setSmtpEnabled(s.smtpEnabled)
        setSmtpHost(s.smtpHost)
        setSmtpPort(s.smtpPort ? String(s.smtpPort) : "")
        setSmtpSecure(s.smtpSecure)
        setSmtpUsername(s.smtpUsername)
        setSmtpFromEmail(s.smtpFromEmail)
        setSmtpFromName(s.smtpFromName)
        const loadedPass = String(s.smtpPassword ?? "").trim()
        setSmtpPasswordDraft(loadedPass)
        setLastSavedSmtpPasswordDraft(loadedPass)
        setSmtpPasswordConfigured(s.smtpPasswordConfigured)
        setSmtpTestTo("")

        setGlobalRunConcurrency(s.globalRunConcurrency ? String(s.globalRunConcurrency) : "")
        setPerRunStepConcurrency(s.perRunStepConcurrency ? String(s.perRunStepConcurrency) : "")
        setDefaultStepTimeoutMs(s.defaultStepTimeoutMs ? String(s.defaultStepTimeoutMs) : "")
        setInputDownloadConcurrency(s.inputDownloadConcurrency ? String(s.inputDownloadConcurrency) : "")
        setInputDownloadTimeoutMs(s.inputDownloadTimeoutMs ? String(s.inputDownloadTimeoutMs) : "")
        setInputDownloadMaxBytes(s.inputDownloadMaxBytes ? String(s.inputDownloadMaxBytes) : "")
      } catch {
        if (!cancelled) toast.error(t("common.loadFailed"))
      } finally {
        if (!cancelled) setLoading(false)
      }
    }

    void load()
    return () => {
      cancelled = true
    }
  }, [t])

  useEffect(() => {
    let cancelled = false
    async function loadRec() {
      try {
        const json = await apiFetchJson<{
          hardware?: { cpu?: number; memGiB?: number }
          recommended?: { globalRunConcurrency?: number }
        }>("/api/settings/system/recommendations", { method: "GET" })
        if (cancelled) return
        const cpu = typeof json.hardware?.cpu === "number" ? json.hardware.cpu : null
        const memGiB = typeof json.hardware?.memGiB === "number" ? json.hardware.memGiB : null
        const rec =
          typeof json.recommended?.globalRunConcurrency === "number" ? json.recommended.globalRunConcurrency : null
        setRecommendedGlobalRunConcurrency(rec)
        setHardwareSummary(cpu && memGiB ? `cpu=${cpu}, mem=${memGiB}GiB` : "")
      } catch {
        // non-fatal
      }
    }

    void loadRec()
    return () => {
      cancelled = true
    }
  }, [])

  const dirtyRegistration = registrationMode !== initial.registrationMode

  const dirtySmtp = useMemo(() => {
    if (smtpEnabled !== initial.smtpEnabled) return true
    if (smtpHost !== initial.smtpHost) return true
    if ((smtpPort.trim() ? Number(smtpPort) : null) !== initial.smtpPort) return true
    if (smtpSecure !== initial.smtpSecure) return true
    if (smtpUsername !== initial.smtpUsername) return true
    if (smtpFromEmail !== initial.smtpFromEmail) return true
    if (smtpFromName !== initial.smtpFromName) return true
    if (smtpPasswordDraft.trim() !== lastSavedSmtpPasswordDraft) return true
    return false
  }, [
    initial,
    lastSavedSmtpPasswordDraft,
    smtpEnabled,
    smtpFromEmail,
    smtpFromName,
    smtpHost,
    smtpPasswordDraft,
    smtpPort,
    smtpSecure,
    smtpUsername,
  ])

  const dirtyPerformance = useMemo(() => {
    if ((globalRunConcurrency.trim() ? Number(globalRunConcurrency) : null) !== initial.globalRunConcurrency)
      return true
    if ((perRunStepConcurrency.trim() ? Number(perRunStepConcurrency) : null) !== initial.perRunStepConcurrency)
      return true
    if ((defaultStepTimeoutMs.trim() ? Number(defaultStepTimeoutMs) : null) !== initial.defaultStepTimeoutMs)
      return true
    if (
      (inputDownloadConcurrency.trim() ? Number(inputDownloadConcurrency) : null) !== initial.inputDownloadConcurrency
    )
      return true
    if ((inputDownloadTimeoutMs.trim() ? Number(inputDownloadTimeoutMs) : null) !== initial.inputDownloadTimeoutMs)
      return true
    if ((inputDownloadMaxBytes.trim() ? Number(inputDownloadMaxBytes) : null) !== initial.inputDownloadMaxBytes)
      return true
    return false
  }, [
    defaultStepTimeoutMs,
    globalRunConcurrency,
    initial,
    inputDownloadConcurrency,
    inputDownloadMaxBytes,
    inputDownloadTimeoutMs,
    perRunStepConcurrency,
  ])

  async function saveRegistration() {
    if (saving || savingSection) return
    setSaving(true)
    setSavingSection("registration")
    try {
      const json = await apiFetchJson<{ settings?: Partial<SystemSettings> }>("/api/settings/system", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ registrationMode }),
      })
      const next: SystemSettings = {
        ...initial,
        registrationMode: json.settings?.registrationMode ?? registrationMode,
      }
      setInitial(next)
      toast.success(t("common.saved"))
    } catch (e) {
      toast.error(tApiError({ t, err: e, fallbackKey: "settings.system.saveFailed" }))
    } finally {
      setSaving(false)
      setSavingSection(null)
    }
  }

  async function saveSmtp() {
    if (saving || savingSection) return
    setSaving(true)
    setSavingSection("smtp")
    try {
      const body: Record<string, unknown> = {
        smtpEnabled,
        smtpHost,
        smtpSecure,
        smtpUsername,
        smtpFromEmail,
        smtpFromName,
      }
      body.smtpPort = smtpPort.trim() ? Number(smtpPort) : null
      const nextSmtpPasswordDraft = smtpPasswordDraft.trim()
      if (nextSmtpPasswordDraft) {
        body.smtpPassword = nextSmtpPasswordDraft
      } else if (lastSavedSmtpPasswordDraft) {
        // User cleared a previously-saved password.
        body.smtpPassword = null
      }

      const json = await apiFetchJson<{ settings?: Partial<SystemSettings> }>("/api/settings/system", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      })

      const next = normalizeSystemSettings({
        ...initial,
        ...json.settings,
        smtpPort:
          typeof json.settings?.smtpPort === "number"
            ? json.settings.smtpPort
            : smtpPort.trim()
              ? Number(smtpPort)
              : null,
        smtpPasswordConfigured: Boolean(json.settings?.smtpPasswordConfigured ?? smtpPasswordConfigured),
      })

      setInitial(next)
      const loadedPass = String(next.smtpPassword ?? "").trim()
      setSmtpPasswordDraft(loadedPass)
      setLastSavedSmtpPasswordDraft(loadedPass)
      setSmtpPasswordConfigured(Boolean(next.smtpPasswordConfigured))
      toast.success(t("common.saved"))
    } catch (e) {
      toast.error(tApiError({ t, err: e, fallbackKey: "settings.system.saveFailed" }))
    } finally {
      setSaving(false)
      setSavingSection(null)
    }
  }

  async function savePerformance() {
    if (performanceLocked) {
      toast.error(t("settings.system.advanced.lockedHint"))
      return
    }
    if (saving || savingSection) return
    setSaving(true)
    setSavingSection("performance")
    try {
      const body: Record<string, unknown> = {}
      body.globalRunConcurrency = globalRunConcurrency.trim() ? Number(globalRunConcurrency) : null
      body.perRunStepConcurrency = perRunStepConcurrency.trim() ? Number(perRunStepConcurrency) : null
      body.defaultStepTimeoutMs = defaultStepTimeoutMs.trim() ? Number(defaultStepTimeoutMs) : null
      body.inputDownloadConcurrency = inputDownloadConcurrency.trim() ? Number(inputDownloadConcurrency) : null
      body.inputDownloadTimeoutMs = inputDownloadTimeoutMs.trim() ? Number(inputDownloadTimeoutMs) : null
      body.inputDownloadMaxBytes = inputDownloadMaxBytes.trim() ? Number(inputDownloadMaxBytes) : null

      const json = await apiFetchJson<{
        settings?: Partial<SystemSettings>
        locks?: { performance?: boolean }
        performance?: PerfInfo
      }>("/api/settings/system", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      })

      const next = normalizeSystemSettings({
        ...initial,
        ...json.settings,
      })

      setInitial(next)
      setPerformanceLocked(Boolean(json.locks?.performance))
      setPerformanceInfo(json.performance ?? null)
      setGlobalRunConcurrency(next.globalRunConcurrency ? String(next.globalRunConcurrency) : "")
      setPerRunStepConcurrency(next.perRunStepConcurrency ? String(next.perRunStepConcurrency) : "")
      setDefaultStepTimeoutMs(next.defaultStepTimeoutMs ? String(next.defaultStepTimeoutMs) : "")
      setInputDownloadConcurrency(next.inputDownloadConcurrency ? String(next.inputDownloadConcurrency) : "")
      setInputDownloadTimeoutMs(next.inputDownloadTimeoutMs ? String(next.inputDownloadTimeoutMs) : "")
      setInputDownloadMaxBytes(next.inputDownloadMaxBytes ? String(next.inputDownloadMaxBytes) : "")
      toast.success(t("common.saved"))
    } catch (e) {
      toast.error(tApiError({ t, err: e, fallbackKey: "settings.system.saveFailed" }))
    } finally {
      setSaving(false)
      setSavingSection(null)
    }
  }

  async function sendSmtpTest() {
    if (sendingTest || saving || loading) return
    const toEmail = smtpTestTo.trim()
    if (!toEmail) {
      toast.error(t("settings.system.email.testMissingTo"))
      return
    }
    setSendingTest(true)
    try {
      await apiFetchJson("/api/settings/system/smtp/test", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ toEmail }),
      })
      toast.success(t("settings.system.email.testSent"))
    } catch (e) {
      toast.error(tApiError({ t, err: e, fallbackKey: "settings.system.email.testFailed" }))
    } finally {
      setSendingTest(false)
    }
  }

  function resetRegistration() {
    setRegistrationMode(initial.registrationMode)
  }

  function resetSmtp() {
    setSmtpEnabled(initial.smtpEnabled)
    setSmtpHost(initial.smtpHost)
    setSmtpPort(initial.smtpPort ? String(initial.smtpPort) : "")
    setSmtpSecure(initial.smtpSecure)
    setSmtpUsername(initial.smtpUsername)
    setSmtpFromEmail(initial.smtpFromEmail)
    setSmtpFromName(initial.smtpFromName)
    const loadedPass = String(initial.smtpPassword ?? "").trim()
    setSmtpPasswordDraft(loadedPass)
    setLastSavedSmtpPasswordDraft(loadedPass)
    setSmtpPasswordConfigured(initial.smtpPasswordConfigured)
    setSmtpTestTo("")
  }

  function resetPerformance() {
    setGlobalRunConcurrency(initial.globalRunConcurrency ? String(initial.globalRunConcurrency) : "")
    setPerRunStepConcurrency(initial.perRunStepConcurrency ? String(initial.perRunStepConcurrency) : "")
    setDefaultStepTimeoutMs(initial.defaultStepTimeoutMs ? String(initial.defaultStepTimeoutMs) : "")
    setInputDownloadConcurrency(initial.inputDownloadConcurrency ? String(initial.inputDownloadConcurrency) : "")
    setInputDownloadTimeoutMs(initial.inputDownloadTimeoutMs ? String(initial.inputDownloadTimeoutMs) : "")
    setInputDownloadMaxBytes(initial.inputDownloadMaxBytes ? String(initial.inputDownloadMaxBytes) : "")
  }

  return {
    loading,
    saving,
    savingSection,

    performanceLocked,
    performanceInfo,

    initial,

    registrationMode,
    setRegistrationMode,

    smtpEnabled,
    setSmtpEnabled,
    smtpHost,
    setSmtpHost,
    smtpPort,
    setSmtpPort,
    smtpSecure,
    setSmtpSecure,
    smtpUsername,
    setSmtpUsername,
    smtpFromEmail,
    setSmtpFromEmail,
    smtpFromName,
    setSmtpFromName,
    smtpPasswordDraft,
    setSmtpPasswordDraft,
    smtpPasswordConfigured,
    showSmtpPassword,
    setShowSmtpPassword,
    smtpTestTo,
    setSmtpTestTo,
    sendingTest,

    globalRunConcurrency,
    setGlobalRunConcurrency,
    perRunStepConcurrency,
    setPerRunStepConcurrency,
    defaultStepTimeoutMs,
    setDefaultStepTimeoutMs,
    inputDownloadConcurrency,
    setInputDownloadConcurrency,
    inputDownloadTimeoutMs,
    setInputDownloadTimeoutMs,
    inputDownloadMaxBytes,
    setInputDownloadMaxBytes,

    recommendedGlobalRunConcurrency,
    hardwareSummary,

    dirtyRegistration,
    dirtySmtp,
    dirtyPerformance,

    saveRegistration,
    saveSmtp,
    savePerformance,
    sendSmtpTest,

    resetRegistration,
    resetSmtp,
    resetPerformance,
  }
}
