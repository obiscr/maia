"use client"

import { useI18n } from "@/components/i18n-provider"
import { InfoAlert } from "@/components/common/info-alert"
import { SettingsSectionFooter } from "@/components/settings/settings-section-footer"
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import type { SavingSection } from "@/components/settings/system/hooks/use-system-settings"

export function PublicBaseUrlSection(props: {
  loading: boolean
  saving: boolean
  savingSection: SavingSection
  dirty: boolean

  value: string
  onChange: (v: string) => void
  onReset: () => void
  onSave: () => void
}) {
  const { t } = useI18n()
  const missing = !props.value.trim()

  return (
    <div className="space-y-4">
      <FieldGroup>
        <Field data-disabled={props.loading || props.saving}>
          <FieldLabel htmlFor="system-public-base-url">{t("settings.system.publicBaseUrl.label")}</FieldLabel>
          <Input
            id="system-public-base-url"
            value={props.value}
            onChange={(e) => props.onChange(e.target.value)}
            placeholder={t("settings.system.publicBaseUrl.placeholder")}
            disabled={props.loading || props.saving}
            inputMode="url"
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
          />
        </Field>
      </FieldGroup>

      {missing ? (
        <InfoAlert
          titleKey="settings.system.email.missingPublicBaseUrlAlertTitle"
          descriptionKey="settings.system.email.missingPublicBaseUrlAlertDescription"
        />
      ) : null}

      <SettingsSectionFooter
        onReset={props.onReset}
        resetDisabled={!props.dirty || props.saving || props.loading}
        resetLabel={t("common.resetAction")}
        onSave={props.onSave}
        saveDisabled={!props.dirty || props.saving || props.loading}
        saveLabel={t("common.saveAction")}
        saving={props.savingSection === "publicBaseUrl"}
        savingLabel={t("common.saving")}
      />
    </div>
  )
}
