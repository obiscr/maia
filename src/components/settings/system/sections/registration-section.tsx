"use client"

import { useI18n } from "@/components/i18n-provider"
import { SettingsSectionFooter } from "@/components/settings/settings-section-footer"
import { SettingsFormSkeleton } from "@/components/settings/settings-skeletons"
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import type { RegistrationMode } from "@/components/settings/system/types"
import type { SavingSection } from "@/components/settings/system/hooks/use-system-settings"

export function RegistrationSection(props: {
  loading: boolean
  saving: boolean
  savingSection: SavingSection
  dirty: boolean

  value: RegistrationMode
  onChange: (v: RegistrationMode) => void
  onReset: () => void
  onSave: () => void
}) {
  const { t } = useI18n()

  if (props.loading) return <SettingsFormSkeleton rows={1} />

  return (
    <div className="space-y-4">
      <FieldGroup>
        <Field data-disabled={props.loading || props.saving}>
          <FieldLabel htmlFor="system-registration-mode">{t("settings.system.registration.mode")}</FieldLabel>
          <Select
            value={props.value}
            onValueChange={(v) => props.onChange(v as RegistrationMode)}
            disabled={props.loading || props.saving}
          >
            <SelectTrigger id="system-registration-mode">
              <SelectValue placeholder={t("settings.system.registration.modePlaceholder")} />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="DISABLED">{t("settings.system.registration.modes.disabled")}</SelectItem>
              <SelectItem value="OPEN">{t("settings.system.registration.modes.open")}</SelectItem>
              <SelectItem value="INVITE_ONLY">{t("settings.system.registration.modes.inviteOnly")}</SelectItem>
            </SelectContent>
          </Select>
        </Field>
      </FieldGroup>

      <SettingsSectionFooter
        onReset={props.onReset}
        resetDisabled={!props.dirty || props.saving || props.loading}
        resetLabel={t("common.resetAction")}
        onSave={props.onSave}
        saveDisabled={!props.dirty || props.saving || props.loading}
        saveLabel={t("common.saveAction")}
        saving={props.savingSection === "registration"}
        savingLabel={t("common.saving")}
      />
    </div>
  )
}
