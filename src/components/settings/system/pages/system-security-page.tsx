"use client"

import { useI18n } from "@/components/i18n-provider"
import { SettingsSection } from "@/components/settings/settings-section"
import { SettingsSectionContent } from "@/components/settings/settings-section-content"
import { SettingsSectionHeader } from "@/components/settings/settings-section-header"
import { SecurityEnvSection } from "@/components/settings/system/sections"

export function SystemSecurityPage() {
  const { t } = useI18n()

  return (
    <SettingsSection>
      <SettingsSectionHeader
        title={t("settings.system.security.sectionTitle")}
        description={t("settings.system.security.hint")}
      />
      <SettingsSectionContent>
        <SecurityEnvSection />
      </SettingsSectionContent>
    </SettingsSection>
  )
}
