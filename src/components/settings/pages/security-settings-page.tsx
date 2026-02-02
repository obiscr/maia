"use client"

import * as React from "react"

import { useI18n } from "@/components/i18n-provider"
import { SettingsSection } from "@/components/settings/settings-section"
import { SettingsSectionContent } from "@/components/settings/settings-section-content"
import { SettingsSectionHeader } from "@/components/settings/settings-section-header"
import { SettingsSectionFooter } from "@/components/settings/settings-section-footer"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Spinner } from "@/components/ui/spinner"
import { Field, FieldDescription, FieldGroup, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { InputOTP, InputOTPGroup, InputOTPSlot } from "@/components/ui/input-otp"
import { toast } from "@/lib/client/toast"
import { apiFetchJson, ApiError } from "@/lib/shared/http/api"
import { tApiError } from "@/lib/shared/i18n/error"
import { SettingsFormSkeleton } from "@/components/settings/settings-skeletons"

type SecuritySettings = {
  totpEnabled: boolean
  totpVerifiedAt: string | null
  recoveryCodesRemaining: number
}

type SetupResponse = { ok: true; secretBase32: string; otpauthUrl: string }
type EnableResponse = { ok: true; recoveryCodes: string[] }

const DEFAULTS: SecuritySettings = { totpEnabled: false, totpVerifiedAt: null, recoveryCodesRemaining: 0 }

function downloadRecoveryCodes(params: { codes: string[]; filename: string }) {
  const content = [
    "Maia — Two-factor authentication recovery codes",
    "",
    "Keep these recovery codes in a safe place.",
    "Each code can be used once.",
    "",
    ...params.codes,
    "",
  ].join("\n")

  const blob = new Blob([content], { type: "text/plain;charset=utf-8" })
  const url = URL.createObjectURL(blob)
  const a = document.createElement("a")
  a.href = url
  a.download = params.filename
  a.click()
  URL.revokeObjectURL(url)
}

export default function SecuritySettingsPage() {
  const { t } = useI18n()

  const [loading, setLoading] = React.useState(true)
  const [saving, setSaving] = React.useState(false)
  const [settings, setSettings] = React.useState<SecuritySettings>(DEFAULTS)

  // Setup (when enabling)
  const [setupLoading, setSetupLoading] = React.useState(false)
  const [secretBase32, setSecretBase32] = React.useState<string>("")
  const [otpauthUrl, setOtpauthUrl] = React.useState<string>("")
  const [qrDataUrl, setQrDataUrl] = React.useState<string>("")
  const [enableCode, setEnableCode] = React.useState<string>("")
  const [generatedCodes, setGeneratedCodes] = React.useState<string[] | null>(null)

  // Regenerate
  const [regenCode, setRegenCode] = React.useState("")
  const [regenCodes, setRegenCodes] = React.useState<string[] | null>(null)

  // Disable
  const [disablePassword, setDisablePassword] = React.useState("")

  React.useEffect(() => {
    let cancelled = false
    async function load() {
      setLoading(true)
      try {
        const json = await apiFetchJson<{ settings?: Partial<SecuritySettings> }>("/api/settings/security", {
          method: "GET",
        })
        const s: SecuritySettings = {
          totpEnabled: Boolean(json.settings?.totpEnabled),
          totpVerifiedAt: typeof json.settings?.totpVerifiedAt === "string" ? json.settings.totpVerifiedAt : null,
          recoveryCodesRemaining: Number(json.settings?.recoveryCodesRemaining ?? 0) || 0,
        }
        if (cancelled) return
        setSettings(s)
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

  React.useEffect(() => {
    let cancelled = false
    async function gen() {
      if (!otpauthUrl) {
        setQrDataUrl("")
        return
      }
      try {
        const mod = await import("qrcode")
        const url = await mod.toDataURL(otpauthUrl, { margin: 1, width: 256 })
        if (!cancelled) setQrDataUrl(url)
      } catch {
        if (!cancelled) setQrDataUrl("")
      }
    }
    void gen()
    return () => {
      cancelled = true
    }
  }, [otpauthUrl])

  async function startSetup() {
    if (setupLoading || loading || settings.totpEnabled) return
    setSetupLoading(true)
    try {
      const json = await apiFetchJson<SetupResponse>("/api/settings/security/totp/setup", { method: "POST" })
      setSecretBase32(json.secretBase32)
      setOtpauthUrl(json.otpauthUrl)
      setEnableCode("")
      setGeneratedCodes(null)
      toast.success(t("settings.security.totp.setupReady"))
    } catch (e) {
      toast.error(tApiError({ t, err: e, fallbackKey: "errors.SAVE_FAILED" }))
    } finally {
      setSetupLoading(false)
    }
  }

  async function confirmEnable() {
    if (saving || loading || settings.totpEnabled) return
    setSaving(true)
    try {
      const json = await apiFetchJson<EnableResponse>("/api/settings/security/totp/enable", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code: enableCode }),
      })
      setGeneratedCodes(json.recoveryCodes)
      // Update status
      setSettings((s) => ({
        ...s,
        totpEnabled: true,
        totpVerifiedAt: new Date().toISOString(),
        recoveryCodesRemaining: json.recoveryCodes.length,
      }))
      toast.success(t("settings.security.totp.enabledToast"))
    } catch (e) {
      if (e instanceof ApiError && e.code === "TOTP_INVALID") toast.error(t("auth.otp.errors.invalidCode"))
      else toast.error(tApiError({ t, err: e, fallbackKey: "errors.SAVE_FAILED" }))
    } finally {
      setSaving(false)
    }
  }

  async function regenerate() {
    if (saving || loading || !settings.totpEnabled) return
    setSaving(true)
    try {
      const json = await apiFetchJson<EnableResponse>("/api/settings/security/totp/recovery-codes/regenerate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code: regenCode }),
      })
      setRegenCodes(json.recoveryCodes)
      setSettings((s) => ({ ...s, recoveryCodesRemaining: json.recoveryCodes.length }))
      toast.success(t("settings.security.totp.recoveryCodesRegeneratedToast"))
    } catch (e) {
      if (e instanceof ApiError && e.code === "TOTP_INVALID") toast.error(t("auth.otp.errors.invalidCode"))
      else toast.error(tApiError({ t, err: e, fallbackKey: "errors.SAVE_FAILED" }))
    } finally {
      setSaving(false)
    }
  }

  async function disable() {
    if (saving || loading || !settings.totpEnabled) return
    setSaving(true)
    try {
      await apiFetchJson("/api/settings/security/totp/disable", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password: disablePassword }),
      })
      setSettings({ ...DEFAULTS })
      setSecretBase32("")
      setOtpauthUrl("")
      setQrDataUrl("")
      setEnableCode("")
      setGeneratedCodes(null)
      setRegenCode("")
      setRegenCodes(null)
      setDisablePassword("")
      toast.success(t("settings.security.totp.disabledToast"))
    } catch (e) {
      if (e instanceof ApiError && e.code === "INVALID_CREDENTIALS")
        toast.error(t("auth.signin.errors.invalidCredentials"))
      else toast.error(tApiError({ t, err: e, fallbackKey: "errors.SAVE_FAILED" }))
    } finally {
      setSaving(false)
    }
  }

  return (
    <SettingsSection>
      <SettingsSectionHeader title={t("settings.security.title")} description={t("settings.security.description")} />
      <SettingsSectionContent>
        {loading ? (
          <SettingsFormSkeleton rows={3} />
        ) : (
          <div className="space-y-4 pb-6">
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
              <div className="min-w-0">
                <div className="font-medium">{t("settings.security.totp.title")}</div>
                <div className="mt-0.5 text-sm text-muted-foreground">{t("settings.security.totp.hint")}</div>
              </div>
              <div className="shrink-0">
                {settings.totpEnabled ? (
                  <Badge variant="secondary">{t("settings.security.totp.enabledBadge")}</Badge>
                ) : (
                  <Badge variant="outline">{t("settings.security.totp.disabledBadge")}</Badge>
                )}
              </div>
            </div>

            <div className="mt-4 space-y-4">
              {settings.totpEnabled ? (
                <>
                  <div className="text-sm text-muted-foreground">
                    {t("settings.security.totp.recoveryCodesRemaining", { count: settings.recoveryCodesRemaining })}
                  </div>

                  {generatedCodes ? (
                    <div className="space-y-2">
                      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                        <div className="text-base font-medium">{t("settings.security.totp.recoveryCodesNewTitle")}</div>
                        <div className="flex gap-2">
                          <Button
                            type="button"
                            size="sm"
                            variant="secondary"
                            disabled={loading || saving}
                            onClick={() =>
                              downloadRecoveryCodes({
                                codes: generatedCodes,
                                filename: `maia-recovery-codes-${new Date().toISOString().slice(0, 10)}.txt`,
                              })
                            }
                          >
                            {loading || saving ? (
                              <Spinner className="mr-2 h-4 w-4" aria-label={t("common.loading")} />
                            ) : null}
                            {t("settings.security.totp.downloadRecoveryCodesAction")}
                          </Button>
                          <Button type="button" size="sm" variant="ghost" onClick={() => setGeneratedCodes(null)}>
                            {t("common.hideAction")}
                          </Button>
                        </div>
                      </div>
                      <pre className="overflow-auto rounded-md border bg-background p-3 font-mono text-xs">
                        {generatedCodes.join("\n")}
                      </pre>
                      <div className="text-sm text-muted-foreground">
                        {t("settings.security.totp.recoveryCodesOneTimeHint")}
                      </div>
                    </div>
                  ) : null}

                  <div className="pt-2 text-base font-medium">{t("settings.security.totp.recoveryCodesTitle")}</div>

                  <FieldGroup>
                    <Field data-disabled={loading || saving}>
                      <FieldLabel>{t("settings.security.totp.regenCodeLabel")}</FieldLabel>
                      <InputOTP
                        maxLength={6}
                        value={regenCode}
                        onChange={setRegenCode}
                        disabled={loading || saving}
                        aria-label={t("settings.security.totp.regenCodeLabel")}
                      >
                        <InputOTPGroup className="w-fit justify-center gap-2.5 *:data-[slot=input-otp-slot]:rounded-md *:data-[slot=input-otp-slot]:border">
                          <InputOTPSlot index={0} />
                          <InputOTPSlot index={1} />
                          <InputOTPSlot index={2} />
                          <InputOTPSlot index={3} />
                          <InputOTPSlot index={4} />
                          <InputOTPSlot index={5} />
                        </InputOTPGroup>
                      </InputOTP>
                      <FieldDescription>{t("settings.security.totp.regenCodeHint")}</FieldDescription>
                    </Field>

                    <Field data-disabled={loading || saving}>
                      <FieldLabel htmlFor="disable-password">
                        {t("settings.security.totp.disablePasswordLabel")}
                      </FieldLabel>
                      <Input
                        id="disable-password"
                        type="password"
                        autoComplete="current-password"
                        value={disablePassword}
                        onChange={(e) => setDisablePassword(e.target.value)}
                        disabled={loading || saving}
                        className="max-w-sm"
                      />
                      <FieldDescription>{t("settings.security.totp.disablePasswordHint")}</FieldDescription>
                    </Field>
                    <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
                      <Button
                        type="button"
                        variant="secondary"
                        onClick={() => void regenerate()}
                        disabled={loading || saving || regenCode.trim().length !== 6}
                      >
                        {t("settings.security.totp.regenerateAction")}
                      </Button>
                      <Button
                        type="button"
                        variant="destructive"
                        onClick={() => void disable()}
                        disabled={loading || saving || !disablePassword.trim()}
                      >
                        {t("settings.security.totp.disableAction")}
                      </Button>
                    </div>
                  </FieldGroup>

                  {regenCodes ? (
                    <div className="space-y-2">
                      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                        <div className="text-base font-medium">{t("settings.security.totp.recoveryCodesNewTitle")}</div>
                        <div className="flex gap-2">
                          <Button
                            type="button"
                            size="sm"
                            variant="secondary"
                            onClick={() =>
                              downloadRecoveryCodes({
                                codes: regenCodes,
                                filename: `maia-recovery-codes-${new Date().toISOString().slice(0, 10)}.txt`,
                              })
                            }
                          >
                            {t("settings.security.totp.downloadRecoveryCodesAction")}
                          </Button>
                        </div>
                      </div>
                      <pre className="overflow-auto rounded-md border bg-background p-3 font-mono text-xs">
                        {regenCodes.join("\n")}
                      </pre>
                      <div className="text-sm text-muted-foreground">
                        {t("settings.security.totp.recoveryCodesOneTimeHint")}
                      </div>
                    </div>
                  ) : null}
                </>
              ) : (
                <>
                  <Button
                    type="button"
                    size="sm"
                    variant="secondary"
                    onClick={() => void startSetup()}
                    disabled={loading || setupLoading}
                  >
                    {setupLoading ? t("common.loading") : t("settings.security.totp.enableAction")}
                  </Button>

                  {otpauthUrl ? (
                    <>
                      <div className="pt-2 text-base font-medium">{t("settings.security.totp.setupTitle")}</div>
                      <div className="grid gap-4 md:grid-cols-[260px_minmax(0,1fr)]">
                        <div className="rounded-md border bg-background p-3">
                          {qrDataUrl ? (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img src={qrDataUrl} alt={t("settings.security.totp.qrAlt")} className="mx-auto size-56" />
                          ) : (
                            <div className="flex size-56 items-center justify-center text-sm text-muted-foreground">
                              {t("settings.security.totp.qrUnavailable")}
                            </div>
                          )}
                        </div>

                        <div className="space-y-4">
                          <FieldGroup>
                            <Field>
                              <FieldLabel>{t("settings.security.totp.manualKeyLabel")}</FieldLabel>
                              <div className="rounded-md border bg-background p-2 font-mono text-xs break-all">
                                {secretBase32}
                              </div>
                              <FieldDescription>{t("settings.security.totp.manualKeyHint")}</FieldDescription>
                            </Field>

                            <Field>
                              <FieldLabel>{t("settings.security.totp.confirmCodeLabel")}</FieldLabel>
                              <InputOTP
                                maxLength={6}
                                value={enableCode}
                                onChange={setEnableCode}
                                disabled={saving}
                                aria-label={t("settings.security.totp.confirmCodeLabel")}
                              >
                                <InputOTPGroup className="w-fit justify-center gap-2.5 *:data-[slot=input-otp-slot]:rounded-md *:data-[slot=input-otp-slot]:border">
                                  <InputOTPSlot index={0} />
                                  <InputOTPSlot index={1} />
                                  <InputOTPSlot index={2} />
                                  <InputOTPSlot index={3} />
                                  <InputOTPSlot index={4} />
                                  <InputOTPSlot index={5} />
                                </InputOTPGroup>
                              </InputOTP>
                              <FieldDescription>{t("settings.security.totp.confirmCodeHint")}</FieldDescription>
                            </Field>
                          </FieldGroup>
                        </div>
                      </div>

                      <SettingsSectionFooter
                        onReset={() => {
                          setSecretBase32("")
                          setOtpauthUrl("")
                          setQrDataUrl("")
                          setEnableCode("")
                          setGeneratedCodes(null)
                        }}
                        resetDisabled={saving}
                        resetLabel={t("common.resetAction")}
                        saveType="button"
                        saveDisabled={saving || enableCode.trim().length !== 6}
                        saveLabel={t("settings.security.totp.confirmEnableAction")}
                        saving={saving}
                        savingLabel={t("common.saving")}
                        onSave={() => void confirmEnable()}
                      />
                    </>
                  ) : null}
                </>
              )}
            </div>

            <div className="text-sm text-muted-foreground">{t("settings.security.notice")}</div>
          </div>
        )}
      </SettingsSectionContent>
    </SettingsSection>
  )
}
