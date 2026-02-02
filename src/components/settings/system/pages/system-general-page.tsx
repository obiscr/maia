"use client"

import { useI18n } from "@/components/i18n-provider"
import { SettingsSection } from "@/components/settings/settings-section"
import { SettingsSectionContent } from "@/components/settings/settings-section-content"
import { SettingsSectionHeader } from "@/components/settings/settings-section-header"
import { useSystemSettings } from "@/components/settings/system/hooks/use-system-settings"
import { PublicBaseUrlSection, RegistrationSection } from "@/components/settings/system/sections"
import { SettingsSectionGroup } from "../../settings-section-group"

export function SystemGeneralPage() {
  const { t } = useI18n()
  const s = useSystemSettings()

  return (
    <SettingsSectionGroup>
      <SettingsSection>
        <SettingsSectionHeader
          title={t("settings.system.publicBaseUrl.sectionTitle")}
          description={t("settings.system.publicBaseUrl.sectionHint")}
        />
        <SettingsSectionContent>
          <PublicBaseUrlSection
            loading={s.loading}
            saving={s.saving}
            savingSection={s.savingSection}
            dirty={s.dirtyPublicBaseUrl}
            value={s.publicBaseUrl}
            onChange={s.setPublicBaseUrl}
            onReset={s.resetPublicBaseUrl}
            onSave={s.savePublicBaseUrl}
          />
        </SettingsSectionContent>
      </SettingsSection>

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
    </SettingsSectionGroup>
  )
}
