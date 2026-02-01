import { SettingsSection } from "@/components/settings/settings-section"
import { SettingsSectionContent } from "@/components/settings/settings-section-content"
import { SettingsSectionHeader } from "@/components/settings/settings-section-header"
import { SettingsOverviewList, type SettingsOverviewItem } from "@/components/settings/pages/settings-overview-list"
import { requireAuthedUser } from "@/lib/server/auth/require"
import { getT } from "@/lib/server/i18n/server"

export default async function SettingsHomePage() {
  const user = await requireAuthedUser()
  const showSystem = String(user.role) === "ADMIN"
  const { t } = await getT()

  const items: SettingsOverviewItem[] = [
    {
      key: "security",
      title: t("settings.security.title"),
      description: t("settings.security.description"),
      href: "/preference/security",
    },
    {
      key: "agent",
      title: t("common.entities.agent"),
      description: t("settings.agent.description"),
      href: "/preference/agent",
    },
    {
      key: "timezone",
      title: t("settings.timezone.title"),
      description: t("settings.timezone.description"),
      href: "/preference/timezone",
    },
    ...(showSystem
      ? [
          {
            key: "system",
            title: t("sidebar.systemSettings"),
            description: t("settings.system.description"),
            href: "/preference/system/registration",
          },
        ]
      : []),
  ]

  return (
    <SettingsSection>
      <SettingsSectionHeader title={t("sidebar.preferences")} description={t("settings.description")} />
      <SettingsSectionContent>
        <SettingsOverviewList items={items} openLabel={t("common.openAction")} />
      </SettingsSectionContent>
    </SettingsSection>
  )
}
