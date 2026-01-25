"use client"

import { useI18n } from "@/components/i18n-provider"
import { SettingsSection } from "@/components/settings/settings-section"
import { SettingsSectionContent } from "@/components/settings/settings-section-content"
import { SettingsSectionHeader } from "@/components/settings/settings-section-header"
import { RetentionEnvSection } from "@/components/settings/system/sections"

export function SystemRetentionPage() {
  const { t } = useI18n()

  return (
    <SettingsSection>
      <SettingsSectionHeader
        title={t("settings.system.retention.sectionTitle")}
        description={t("settings.system.retention.hint")}
      />
      <SettingsSectionContent>
        <RetentionEnvSection />
      </SettingsSectionContent>
    </SettingsSection>
  )
}
