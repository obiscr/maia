"use client"

import { useI18n } from "@/components/i18n-provider"
import { SettingsSection } from "@/components/settings/settings-section"
import { SettingsSectionContent } from "@/components/settings/settings-section-content"
import { SettingsSectionHeader } from "@/components/settings/settings-section-header"
import { RetentionEnvSection, SecurityEnvSection } from "@/components/settings/system/sections"
import { SettingsSectionGroup } from "../../settings-section-group"

export function SystemOpsPage() {
  const { t } = useI18n()

  return (
    <SettingsSectionGroup>
      <SettingsSection>
        <SettingsSectionHeader
          title={t("settings.system.security.sectionTitle")}
          description={t("settings.system.security.hint")}
        />
        <SettingsSectionContent>
          <SecurityEnvSection />
        </SettingsSectionContent>
      </SettingsSection>

      <SettingsSection>
        <SettingsSectionHeader
          title={t("settings.system.retention.sectionTitle")}
          description={t("settings.system.retention.hint")}
        />
        <SettingsSectionContent>
          <RetentionEnvSection />
        </SettingsSectionContent>
      </SettingsSection>
    </SettingsSectionGroup>
  )
}
