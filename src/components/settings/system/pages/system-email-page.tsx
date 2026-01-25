"use client"

import { useI18n } from "@/components/i18n-provider"
import { SettingsSection } from "@/components/settings/settings-section"
import { SettingsSectionContent } from "@/components/settings/settings-section-content"
import { SettingsSectionHeader } from "@/components/settings/settings-section-header"
import { useSystemSettings } from "@/components/settings/system/hooks/use-system-settings"
import { EmailSection } from "@/components/settings/system/sections"

export function SystemEmailPage() {
  const { t } = useI18n()
  const s = useSystemSettings()

  return (
    <SettingsSection>
      <SettingsSectionHeader
        title={t("settings.system.email.sectionTitle")}
        description={t("settings.system.email.enableActionHint")}
      />
      <SettingsSectionContent>
        <EmailSection
          loading={s.loading}
          saving={s.saving}
          savingSection={s.savingSection}
          dirty={s.dirtySmtp}
          smtpEnabled={s.smtpEnabled}
          setSmtpEnabled={s.setSmtpEnabled}
          smtpHost={s.smtpHost}
          setSmtpHost={s.setSmtpHost}
          smtpPort={s.smtpPort}
          setSmtpPort={s.setSmtpPort}
          smtpSecure={s.smtpSecure}
          setSmtpSecure={s.setSmtpSecure}
          smtpUsername={s.smtpUsername}
          setSmtpUsername={s.setSmtpUsername}
          smtpFromEmail={s.smtpFromEmail}
          setSmtpFromEmail={s.setSmtpFromEmail}
          smtpFromName={s.smtpFromName}
          setSmtpFromName={s.setSmtpFromName}
          smtpPasswordDraft={s.smtpPasswordDraft}
          setSmtpPasswordDraft={s.setSmtpPasswordDraft}
          smtpPasswordConfigured={s.smtpPasswordConfigured}
          showSmtpPassword={s.showSmtpPassword}
          setShowSmtpPassword={s.setShowSmtpPassword}
          smtpTestTo={s.smtpTestTo}
          setSmtpTestTo={s.setSmtpTestTo}
          sendingTest={s.sendingTest}
          onSendTest={s.sendSmtpTest}
          onReset={s.resetSmtp}
          onSave={s.saveSmtp}
        />
      </SettingsSectionContent>
    </SettingsSection>
  )
}
