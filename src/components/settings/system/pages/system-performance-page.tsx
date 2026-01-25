"use client"

import { useI18n } from "@/components/i18n-provider"
import { SettingsSection } from "@/components/settings/settings-section"
import { SettingsSectionContent } from "@/components/settings/settings-section-content"
import { SettingsSectionHeader } from "@/components/settings/settings-section-header"
import { useSystemSettings } from "@/components/settings/system/hooks/use-system-settings"
import { PerformanceSection } from "@/components/settings/system/sections"

export function SystemPerformancePage() {
  const { t } = useI18n()
  const s = useSystemSettings()

  return (
    <SettingsSection>
      <SettingsSectionHeader
        title={t("settings.system.performance.sectionTitle")}
        description={t("settings.system.advanced.hint")}
      />
      <SettingsSectionContent>
        <PerformanceSection
          loading={s.loading}
          saving={s.saving}
          savingSection={s.savingSection}
          dirty={s.dirtyPerformance}
          hardwareSummary={s.hardwareSummary}
          recommendedGlobalRunConcurrency={s.recommendedGlobalRunConcurrency}
          locked={s.performanceLocked}
          info={s.performanceInfo}
          globalRunConcurrency={s.globalRunConcurrency}
          setGlobalRunConcurrency={s.setGlobalRunConcurrency}
          perRunStepConcurrency={s.perRunStepConcurrency}
          setPerRunStepConcurrency={s.setPerRunStepConcurrency}
          defaultStepTimeoutMs={s.defaultStepTimeoutMs}
          setDefaultStepTimeoutMs={s.setDefaultStepTimeoutMs}
          inputDownloadConcurrency={s.inputDownloadConcurrency}
          setInputDownloadConcurrency={s.setInputDownloadConcurrency}
          inputDownloadTimeoutMs={s.inputDownloadTimeoutMs}
          setInputDownloadTimeoutMs={s.setInputDownloadTimeoutMs}
          inputDownloadMaxBytes={s.inputDownloadMaxBytes}
          setInputDownloadMaxBytes={s.setInputDownloadMaxBytes}
          onReset={s.resetPerformance}
          onSave={s.savePerformance}
        />
      </SettingsSectionContent>
    </SettingsSection>
  )
}
