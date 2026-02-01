"use client"

import { useEffect, useMemo, useState } from "react"
import { Eye, EyeOff, Mail } from "lucide-react"
import { z } from "zod"

import { useI18n } from "@/components/i18n-provider"
import { SettingsSectionFooter } from "@/components/settings/settings-section-footer"
import { Button } from "@/components/ui/button"
import { Field, FieldDescription, FieldGroup, FieldLabel, FieldTitle } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { SecretInput } from "@/components/ui/secret-input"
import { Spinner } from "@/components/ui/spinner"
import { Switch } from "@/components/ui/switch"
import { toast } from "@/lib/client/toast"
import type { SavingSection } from "@/components/settings/system/hooks/use-system-settings"

type SmtpFormErrors = Partial<
  Record<"smtpHost" | "smtpPort" | "smtpUsername" | "smtpFromEmail" | "smtpPassword" | "smtpTestTo", string>
>

const emailSchema = z.string().trim().email()

function isValidSmtpHost(raw: string): boolean {
  const host = String(raw ?? "").trim()
  if (!host) return false
  if (/\s/.test(host)) return false
  if (host.toLowerCase() === "localhost") return true
  const ipv4 = /^(25[0-5]|2[0-4]\d|1?\d?\d)(\.(25[0-5]|2[0-4]\d|1?\d?\d)){3}$/
  if (ipv4.test(host)) return true
  const hostname = /^(?=.{1,253}$)([a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)(\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)*$/i
  return hostname.test(host)
}

export function EmailSection(props: {
  loading: boolean
  saving: boolean
  savingSection: SavingSection
  dirty: boolean
  initialSmtpEnabled: boolean

  smtpEnabled: boolean
  setSmtpEnabled: (v: boolean) => void
  smtpHost: string
  setSmtpHost: (v: string) => void
  smtpPort: string
  setSmtpPort: (v: string) => void
  smtpSecure: boolean
  setSmtpSecure: (v: boolean) => void
  smtpUsername: string
  setSmtpUsername: (v: string) => void
  smtpFromEmail: string
  setSmtpFromEmail: (v: string) => void
  smtpFromName: string
  setSmtpFromName: (v: string) => void

  smtpPasswordDraft: string
  setSmtpPasswordDraft: (v: string) => void
  smtpPasswordClearRequested: boolean
  setSmtpPasswordClearRequested: (v: boolean) => void
  smtpPasswordConfigured: boolean
  smtpVerifiedAt: string | null
  smtpVerified: boolean
  showSmtpPassword: boolean
  setShowSmtpPassword: (v: boolean) => void

  smtpTestTo: string
  setSmtpTestTo: (v: string) => void
  sendingTest: boolean

  onSendTest: () => Promise<boolean>
  onReset: () => void
  onSave: () => void
}) {
  const { t } = useI18n()

  const [validatedOnce, setValidatedOnce] = useState(false)
  const [errors, setErrors] = useState<SmtpFormErrors>({})

  const smtpPortNumber = props.smtpPort.trim() ? Number(props.smtpPort) : NaN
  const smtpHasPort =
    props.smtpPort.trim() !== "" &&
    Number.isFinite(smtpPortNumber) &&
    Number.isInteger(smtpPortNumber) &&
    smtpPortNumber >= 1 &&
    smtpPortNumber <= 65535

  const smtpHasPassword = props.smtpPasswordConfigured || props.smtpPasswordDraft.trim().length > 0
  const smtpMinConfigOk =
    Boolean(props.smtpHost.trim()) &&
    isValidSmtpHost(props.smtpHost.trim()) &&
    smtpHasPort &&
    Boolean(props.smtpUsername.trim()) &&
    Boolean(props.smtpFromEmail.trim()) &&
    emailSchema.safeParse(props.smtpFromEmail.trim()).success &&
    smtpHasPassword

  // Allow disabling even when unverified, but block turning ON until verified.
  const smtpEnableSwitchDisabled = props.loading || props.saving || (!props.smtpEnabled && !props.smtpVerified)

  const validate = useMemo(() => {
    return (mode: "save" | "test"): SmtpFormErrors => {
      const next: SmtpFormErrors = {}

      const hostTrim = props.smtpHost.trim()
      const portTrim = props.smtpPort.trim()
      const usernameTrim = props.smtpUsername.trim()
      const fromEmailTrim = props.smtpFromEmail.trim()
      const testToTrim = props.smtpTestTo.trim()

      const portNumber = portTrim ? Number(portTrim) : NaN
      const portIsValid = portTrim
        ? Number.isFinite(portNumber) && Number.isInteger(portNumber) && portNumber >= 1 && portNumber <= 65535
        : true

      // Always validate format if provided (even when disabled).
      if (portTrim && !portIsValid) next.smtpPort = t("settings.system.email.portInvalid")
      if (hostTrim && !isValidSmtpHost(hostTrim)) next.smtpHost = t("settings.system.email.hostInvalid")
      if (fromEmailTrim && !emailSchema.safeParse(fromEmailTrim).success)
        next.smtpFromEmail = t("settings.system.email.fromEmailInvalid")
      if (testToTrim && !emailSchema.safeParse(testToTrim).success)
        next.smtpTestTo = t("settings.system.email.testToInvalid")

      // When testing (or saving with enabled=true), require full config.
      const requireFullConfig = mode === "test" || props.smtpEnabled
      if (requireFullConfig) {
        if (!hostTrim) next.smtpHost = t("settings.system.email.hostRequired")
        else if (!isValidSmtpHost(hostTrim)) next.smtpHost = t("settings.system.email.hostInvalid")

        if (!portTrim) next.smtpPort = t("settings.system.email.portRequired")
        else if (!portIsValid) next.smtpPort = t("settings.system.email.portInvalid")

        if (!usernameTrim) next.smtpUsername = t("settings.system.email.usernameRequired")

        if (!fromEmailTrim) next.smtpFromEmail = t("settings.system.email.fromEmailRequired")
        else if (!emailSchema.safeParse(fromEmailTrim).success)
          next.smtpFromEmail = t("settings.system.email.fromEmailInvalid")

        if (!smtpHasPassword) next.smtpPassword = t("settings.system.email.passwordRequired")
      }

      if (mode === "test") {
        if (!testToTrim) next.smtpTestTo = t("settings.system.email.testMissingTo")
        else if (!emailSchema.safeParse(testToTrim).success) next.smtpTestTo = t("settings.system.email.testToInvalid")
      }

      return next
    }
  }, [
    props.smtpEnabled,
    props.smtpFromEmail,
    props.smtpHost,
    props.smtpPort,
    props.smtpTestTo,
    props.smtpUsername,
    smtpHasPassword,
    t,
  ])

  useEffect(() => {
    if (!validatedOnce) return
    // Default revalidation mode: save-path (keeps errors responsive).
    setErrors(validate("save"))
  }, [validatedOnce, validate])

  const isValid = !validatedOnce || Object.keys(errors).length === 0

  return (
    <form
      className="space-y-4"
      onSubmit={(e) => {
        e.preventDefault()
        if (props.loading || props.saving) return
        setValidatedOnce(true)
        const nextErrors = validate("save")
        setErrors(nextErrors)
        if (Object.keys(nextErrors).length > 0) return
        props.onSave()
      }}
    >
      <FieldGroup className="gap-6">
        <Field
          orientation="horizontal"
          className="items-center justify-between gap-4"
          data-disabled={props.loading || props.saving}
        >
          <div className="space-y-0.5">
            <FieldTitle>{t("settings.system.email.enableAction")}</FieldTitle>
            <FieldDescription className="text-xs">
              {t("settings.system.email.enableActionToggleHint")}
              {!props.smtpVerified ? (
                <>
                  <br />
                  <span className="font-medium text-destructive">
                    {props.smtpEnabled
                      ? t("settings.system.email.reverifyAfterChangeHint")
                      : t("settings.system.email.enableBlockedUntilVerified")}
                  </span>
                </>
              ) : null}
            </FieldDescription>
          </div>
          <Switch
            id="smtp-enable"
            checked={props.smtpEnabled}
            onCheckedChange={props.setSmtpEnabled}
            disabled={smtpEnableSwitchDisabled}
          />
        </Field>

        <div className="grid gap-4 sm:grid-cols-2">
          <Field data-disabled={props.loading || props.saving} data-invalid={errors.smtpHost ? true : undefined}>
            <FieldLabel htmlFor="smtp-host">{t("settings.system.email.host")}</FieldLabel>
            <Input
              id="smtp-host"
              value={props.smtpHost}
              onChange={(e) => props.setSmtpHost(e.target.value)}
              placeholder="smtp.example.com"
              disabled={props.loading || props.saving}
              aria-invalid={errors.smtpHost ? true : undefined}
            />
            {errors.smtpHost ? <FieldDescription>{errors.smtpHost}</FieldDescription> : null}
          </Field>
          <Field data-disabled={props.loading || props.saving} data-invalid={errors.smtpPort ? true : undefined}>
            <FieldLabel htmlFor="smtp-port">{t("settings.system.email.port")}</FieldLabel>
            <Input
              id="smtp-port"
              value={props.smtpPort}
              onChange={(e) => props.setSmtpPort(e.target.value)}
              placeholder="587"
              inputMode="numeric"
              disabled={props.loading || props.saving}
              aria-invalid={errors.smtpPort ? true : undefined}
            />
            {errors.smtpPort ? <FieldDescription>{errors.smtpPort}</FieldDescription> : null}
          </Field>
        </div>

        <Field
          orientation="horizontal"
          className="items-center justify-between gap-4"
          data-disabled={props.loading || props.saving}
        >
          <div className="space-y-0.5">
            <FieldTitle>{t("settings.system.email.secure")}</FieldTitle>
            <FieldDescription className="text-xs">{t("settings.system.email.secureHint")}</FieldDescription>
          </div>
          <Switch
            checked={props.smtpSecure}
            onCheckedChange={props.setSmtpSecure}
            disabled={props.loading || props.saving}
          />
        </Field>

        <div className="grid gap-4 sm:grid-cols-2">
          <Field data-disabled={props.loading || props.saving} data-invalid={errors.smtpUsername ? true : undefined}>
            <FieldLabel htmlFor="smtp-username">{t("settings.system.email.username")}</FieldLabel>
            <Input
              id="smtp-username"
              value={props.smtpUsername}
              onChange={(e) => props.setSmtpUsername(e.target.value)}
              placeholder="user@example.com"
              disabled={props.loading || props.saving}
              aria-invalid={errors.smtpUsername ? true : undefined}
            />
            {errors.smtpUsername ? <FieldDescription>{errors.smtpUsername}</FieldDescription> : null}
          </Field>

          <Field data-disabled={props.loading || props.saving} data-invalid={errors.smtpPassword ? true : undefined}>
            <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-2">
              <FieldLabel htmlFor="smtp-password" className="min-w-0 truncate">
                {t("settings.system.email.password")}
              </FieldLabel>
              {props.smtpPasswordConfigured ? (
                <div className="inline-flex h-4 items-center gap-2 whitespace-nowrap text-sm leading-none text-muted-foreground">
                  <span className="select-none">{t("common.configured")}</span>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="h-5 px-2 text-sm leading-none"
                    onClick={() => {
                      props.setSmtpPasswordDraft("")
                      props.setSmtpPasswordClearRequested(true)
                    }}
                    disabled={props.loading || props.saving}
                  >
                    {t("common.clearSecretAction")}
                  </Button>
                </div>
              ) : null}
            </div>
            <div className="relative">
              <SecretInput
                id="smtp-password"
                value={props.smtpPasswordDraft}
                onChange={(e) => props.setSmtpPasswordDraft(e.target.value)}
                masked={!props.showSmtpPassword}
                placeholder={t("settings.system.email.passwordPlaceholder")}
                className="w-full pr-10 font-mono text-xs"
                disabled={props.loading || props.saving}
                aria-invalid={errors.smtpPassword ? true : undefined}
              />
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                onClick={() => props.setShowSmtpPassword(!props.showSmtpPassword)}
                disabled={props.loading || props.saving}
                aria-label={props.showSmtpPassword ? t("settings.agent.hideAction") : t("settings.agent.showAction")}
                className="absolute right-1 top-1/2 -translate-y-1/2 bg-transparent hover:bg-transparent focus-visible:ring-0 focus-visible:border-transparent"
              >
                {props.showSmtpPassword ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
              </Button>
            </div>
            {errors.smtpPassword ? <FieldDescription>{errors.smtpPassword}</FieldDescription> : null}
          </Field>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <Field data-disabled={props.loading || props.saving} data-invalid={errors.smtpFromEmail ? true : undefined}>
            <FieldLabel htmlFor="smtp-from-email">{t("settings.system.email.fromEmail")}</FieldLabel>
            <Input
              id="smtp-from-email"
              value={props.smtpFromEmail}
              onChange={(e) => props.setSmtpFromEmail(e.target.value)}
              placeholder="no-reply@example.com"
              disabled={props.loading || props.saving}
              aria-invalid={errors.smtpFromEmail ? true : undefined}
            />
            {errors.smtpFromEmail ? <FieldDescription>{errors.smtpFromEmail}</FieldDescription> : null}
          </Field>
          <Field data-disabled={props.loading || props.saving}>
            <FieldLabel htmlFor="smtp-from-name">{t("settings.system.email.fromName")}</FieldLabel>
            <Input
              id="smtp-from-name"
              value={props.smtpFromName}
              onChange={(e) => props.setSmtpFromName(e.target.value)}
              disabled={props.loading || props.saving}
            />
          </Field>
        </div>

        <Field
          data-disabled={props.loading || props.saving || props.sendingTest}
          data-invalid={errors.smtpTestTo ? true : undefined}
        >
          <FieldLabel htmlFor="smtp-test-to">{t("settings.system.email.testTo")}</FieldLabel>
          <Input
            id="smtp-test-to"
            value={props.smtpTestTo}
            onChange={(e) => props.setSmtpTestTo(e.target.value)}
            placeholder="you@example.com"
            disabled={props.loading || props.saving || props.sendingTest}
            aria-invalid={errors.smtpTestTo ? true : undefined}
          />
          {errors.smtpTestTo ? <FieldDescription>{errors.smtpTestTo}</FieldDescription> : null}
        </Field>
      </FieldGroup>

      <SettingsSectionFooter
        onReset={props.onReset}
        resetDisabled={!props.dirty || props.saving || props.loading}
        resetLabel={t("common.resetAction")}
        saveType="submit"
        saveDisabled={
          props.saving ||
          props.loading ||
          !isValid ||
          !props.dirty ||
          (props.smtpEnabled && !props.smtpVerified) ||
          // Save is only relevant when enabling (or disabling an already-enabled config).
          (!props.smtpEnabled && !props.initialSmtpEnabled)
        }
        saveLabel={t("common.saveAction")}
        saving={props.savingSection === "smtp"}
        savingLabel={t("common.saving")}
        rightClassName="flex-row"
        rightExtra={
          <Button
            type="button"
            size="sm"
            variant="secondary"
            onClick={async () => {
              if (props.loading || props.saving || props.sendingTest) return

              setValidatedOnce(true)
              const nextErrors = validate("test")
              setErrors(nextErrors)
              if (Object.keys(nextErrors).length > 0) return

              const ok = await props.onSendTest()
              if (!ok) return

              // Nudge the user to enable sending.
              toast.success(t("settings.system.email.testSent"), {
                description: t("settings.system.email.testVerifiedEnableHint"),
              })
            }}
            disabled={props.loading || props.saving || props.sendingTest}
          >
            {props.sendingTest ? <Spinner aria-label={t("common.loading")} /> : <Mail aria-hidden="true" />}
            {props.sendingTest ? t("settings.system.email.testing") : t("settings.system.email.sendTestAction")}
          </Button>
        }
      />
    </form>
  )
}
