import Link from "next/link"
import { ArrowRight } from "lucide-react"

import { SettingsSection } from "@/components/settings/settings-section"
import { SettingsSectionContent } from "@/components/settings/settings-section-content"
import { SettingsSectionHeader } from "@/components/settings/settings-section-header"
import { Button } from "@/components/ui/button"
import { requireAuthedUser } from "@/lib/server/auth/require"
import { getT } from "@/lib/server/i18n/server"

export default async function SettingsHomePage() {
  const user = await requireAuthedUser()
  const showSystem = String(user.role) === "ADMIN"
  const { t } = await getT()

  return (
    <SettingsSection>
      <SettingsSectionHeader title={t("sidebar.preferences")} description={t("settings.description")} />
      <SettingsSectionContent>
        <div className="space-y-6">
          <div className="rounded-md border bg-card p-4">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div className="min-w-0">
                <div className="font-medium">{t("common.entities.agent")}</div>
                <div className="mt-0.5 text-sm text-muted-foreground">{t("settings.agent.description")}</div>
              </div>
              <div className="shrink-0">
                <Button asChild size="sm" variant="secondary">
                  <Link href="/preference/agent">
                    {t("common.openAction")}
                    <ArrowRight />
                  </Link>
                </Button>
              </div>
            </div>
          </div>

          <div className="rounded-md border bg-card p-4">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div className="min-w-0">
                <div className="font-medium">{t("settings.timezone.title")}</div>
                <div className="mt-0.5 text-sm text-muted-foreground">{t("settings.timezone.description")}</div>
              </div>
              <div className="shrink-0">
                <Button asChild size="sm" variant="secondary">
                  <Link href="/preference/timezone">
                    {t("common.openAction")}
                    <ArrowRight />
                  </Link>
                </Button>
              </div>
            </div>
          </div>

          {showSystem ? (
            <div className="rounded-md border bg-card p-4">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <div className="min-w-0">
                  <div className="font-medium">{t("sidebar.systemSettings")}</div>
                  <div className="mt-0.5 text-sm text-muted-foreground">{t("settings.system.description")}</div>
                </div>
                <div className="shrink-0">
                  <Button asChild size="sm" variant="secondary">
                    <Link href="/preference/system/registration">
                      {t("common.openAction")}
                      <ArrowRight />
                    </Link>
                  </Button>
                </div>
              </div>
            </div>
          ) : null}
        </div>
      </SettingsSectionContent>
    </SettingsSection>
  )
}
