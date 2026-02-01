"use client"

import { Eye, EyeOff, Mail } from "lucide-react"

import { useI18n } from "@/components/i18n-provider"
import { SettingsSectionFooter } from "@/components/settings/settings-section-footer"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Field, FieldDescription, FieldGroup, FieldLabel, FieldTitle } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { SecretInput } from "@/components/ui/secret-input"
import { Spinner } from "@/components/ui/spinner"
import { Switch } from "@/components/ui/switch"
import type { SavingSection } from "@/components/settings/system/hooks/use-system-settings"

export function EmailSection(props: {
  loading: boolean
  saving: boolean
  savingSection: SavingSection
  dirty: boolean

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
  showSmtpPassword: boolean
  setShowSmtpPassword: (v: boolean) => void

  smtpTestTo: string
  setSmtpTestTo: (v: string) => void
  sendingTest: boolean

  onSendTest: () => void
  onReset: () => void
  onSave: () => void
}) {
  const { t } = useI18n()

  const smtpPortNumber = props.smtpPort.trim() ? Number(props.smtpPort) : NaN
  const smtpHasPort = props.smtpPort.trim() !== "" && Number.isFinite(smtpPortNumber) && smtpPortNumber > 0

  const smtpHasPassword = props.smtpPasswordConfigured || props.smtpPasswordDraft.trim().length > 0
  const smtpMinConfigOk =
    Boolean(props.smtpHost.trim()) &&
    smtpHasPort &&
    Boolean(props.smtpUsername.trim()) &&
    Boolean(props.smtpFromEmail.trim()) &&
    smtpHasPassword

  // Allow disabling even when config is incomplete, but block enabling until minimal config is present.
  const smtpEnableSwitchDisabled = props.loading || props.saving || (!props.smtpEnabled && !smtpMinConfigOk)

  return (
    <form
      className="space-y-4"
      onSubmit={(e) => {
        e.preventDefault()
        if (props.loading || props.saving) return
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
              {!props.smtpEnabled && !smtpMinConfigOk ? (
                <>
                  {" "}
                  <span className="font-medium text-destructive">{t("settings.system.email.enableBlockedHint")}</span>
                </>
              ) : null}
            </FieldDescription>
          </div>
          <Switch
            checked={props.smtpEnabled}
            onCheckedChange={props.setSmtpEnabled}
            disabled={smtpEnableSwitchDisabled}
          />
        </Field>

        <div className="grid gap-4 sm:grid-cols-2">
          <Field data-disabled={props.loading || props.saving}>
            <FieldLabel htmlFor="smtp-host">{t("settings.system.email.host")}</FieldLabel>
            <Input
              id="smtp-host"
              value={props.smtpHost}
              onChange={(e) => props.setSmtpHost(e.target.value)}
              placeholder="smtp.example.com"
              disabled={props.loading || props.saving}
            />
          </Field>
          <Field data-disabled={props.loading || props.saving}>
            <FieldLabel htmlFor="smtp-port">{t("settings.system.email.port")}</FieldLabel>
            <Input
              id="smtp-port"
              value={props.smtpPort}
              onChange={(e) => props.setSmtpPort(e.target.value)}
              placeholder="587"
              inputMode="numeric"
              disabled={props.loading || props.saving}
            />
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
          <Field data-disabled={props.loading || props.saving}>
            <FieldLabel htmlFor="smtp-username">{t("settings.system.email.username")}</FieldLabel>
            <Input
              id="smtp-username"
              value={props.smtpUsername}
              onChange={(e) => props.setSmtpUsername(e.target.value)}
              placeholder="user@example.com"
              disabled={props.loading || props.saving}
            />
          </Field>

          <Field data-disabled={props.loading || props.saving}>
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
          </Field>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <Field data-disabled={props.loading || props.saving}>
            <FieldLabel htmlFor="smtp-from-email">{t("settings.system.email.fromEmail")}</FieldLabel>
            <Input
              id="smtp-from-email"
              value={props.smtpFromEmail}
              onChange={(e) => props.setSmtpFromEmail(e.target.value)}
              placeholder="no-reply@example.com"
              disabled={props.loading || props.saving}
            />
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

        <Field data-disabled={props.loading || props.saving || props.sendingTest}>
          <FieldLabel htmlFor="smtp-test-to">{t("settings.system.email.testTo")}</FieldLabel>
          <Input
            id="smtp-test-to"
            value={props.smtpTestTo}
            onChange={(e) => props.setSmtpTestTo(e.target.value)}
            placeholder="you@example.com"
            disabled={props.loading || props.saving || props.sendingTest}
          />
        </Field>
      </FieldGroup>

      <SettingsSectionFooter
        onReset={props.onReset}
        resetDisabled={!props.dirty || props.saving || props.loading}
        resetLabel={t("common.resetAction")}
        saveType="submit"
        saveDisabled={props.saving || props.loading}
        saveLabel={t("common.saveAction")}
        saving={props.savingSection === "smtp"}
        savingLabel={t("common.saving")}
        rightClassName="flex-row"
        rightExtra={
          <Button
            type="button"
            size="sm"
            variant="secondary"
            onClick={props.onSendTest}
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
