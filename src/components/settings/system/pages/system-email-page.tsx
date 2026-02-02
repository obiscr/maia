"use client"

import Link from "next/link"

import { useI18n } from "@/components/i18n-provider"
import { InfoAlert } from "@/components/common/info-alert"
import { SettingsSection } from "@/components/settings/settings-section"
import { SettingsSectionContent } from "@/components/settings/settings-section-content"
import { SettingsSectionHeader } from "@/components/settings/settings-section-header"
import { useSystemSettings } from "@/components/settings/system/hooks/use-system-settings"
import { EmailSection, EmailTemplatesSection } from "@/components/settings/system/sections"
import { SettingsSectionGroup } from "../../settings-section-group"

export function SystemEmailPage() {
  const { t } = useI18n()
  const s = useSystemSettings()
  const missingPublicBaseUrl = !s.publicBaseUrl.trim()

  return (
    <SettingsSectionGroup>
      {missingPublicBaseUrl ? (
        <InfoAlert
          titleKey="settings.system.email.missingPublicBaseUrlAlertTitle"
          description={
            <div className="flex flex-col gap-2">
              {t("settings.system.email.missingPublicBaseUrlAlertDescription")}{" "}
              <Link href="/preference/system/general" className="underline underline-offset-4 w-fit">
                {t("settings.system.email.missingPublicBaseUrlAlertAction")}
              </Link>
            </div>
          }
        />
      ) : null}

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
            initialSmtpEnabled={s.initialSmtpEnabled}
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
            smtpPasswordClearRequested={s.smtpPasswordClearRequested}
            setSmtpPasswordClearRequested={s.setSmtpPasswordClearRequested}
            smtpPasswordConfigured={s.smtpPasswordConfigured}
            smtpVerifiedAt={s.smtpVerifiedAt}
            smtpVerified={s.smtpVerified}
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
      <SettingsSection>
        <SettingsSectionHeader
          title={t("settings.system.emailTemplates.sectionTitle")}
          description={t("settings.system.emailTemplates.sectionHint")}
        />
        <SettingsSectionContent>
          <EmailTemplatesSection
            emailNotificationMask={s.emailNotificationMask}
            onUpdateEmailNotificationMask={s.updateEmailNotificationMask}
          />
        </SettingsSectionContent>
      </SettingsSection>
    </SettingsSectionGroup>
  )
}
