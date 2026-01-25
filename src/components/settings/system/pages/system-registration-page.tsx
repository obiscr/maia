"use client"

import { useI18n } from "@/components/i18n-provider"
import { SettingsSection } from "@/components/settings/settings-section"
import { SettingsSectionContent } from "@/components/settings/settings-section-content"
import { SettingsSectionHeader } from "@/components/settings/settings-section-header"
import { useSystemSettings } from "@/components/settings/system/hooks/use-system-settings"
import { RegistrationSection } from "@/components/settings/system/sections"

export function SystemRegistrationPage() {
  const { t } = useI18n()
  const s = useSystemSettings()

  return (
    <SettingsSection>
      <SettingsSectionHeader
        title={t("settings.system.registration.sectionTitle")}
        description={t("settings.system.registration.hint")}
      />
      <SettingsSectionContent>
        <RegistrationSection
          loading={s.loading}
          saving={s.saving}
          savingSection={s.savingSection}
          dirty={s.dirtyRegistration}
          value={s.registrationMode}
          onChange={s.setRegistrationMode}
          onReset={s.resetRegistration}
          onSave={s.saveRegistration}
        />
      </SettingsSectionContent>
    </SettingsSection>
  )
}
