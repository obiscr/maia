"use client"

import * as React from "react"

import { useI18n } from "@/components/i18n-provider"
import { SettingsSection } from "@/components/settings/settings-section"
import { SettingsSectionContent } from "@/components/settings/settings-section-content"
import { SettingsSectionFooter } from "@/components/settings/settings-section-footer"
import { SettingsSectionHeader } from "@/components/settings/settings-section-header"
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field"
import { TimezoneCombobox } from "@/components/common/timezone-combobox"
import { toast } from "@/lib/client/toast"
import { tApiError } from "@/lib/shared/i18n/error"
import { useTimezone } from "@/components/timezone-provider"

export default function TimezoneSettingsPage() {
  const { t } = useI18n()
  const { userTimezone, effectiveTimezone, loading, setUserTimezone } = useTimezone()

  // Draft value is always a concrete timezone string.
  const [draft, setDraft] = React.useState<string>("UTC")
  const [saving, setSaving] = React.useState(false)

  React.useEffect(() => {
    if (loading) return
    // Prefer persisted setting; fall back to current effective.
    setDraft(userTimezone || effectiveTimezone || "UTC")
  }, [effectiveTimezone, loading, userTimezone])

  const dirty = !loading && draft.trim() !== String(userTimezone || effectiveTimezone || "UTC").trim()

  async function save() {
    if (saving || loading) return
    setSaving(true)
    try {
      await setUserTimezone(draft.trim())
      toast.success(t("common.saved"))
    } catch (e) {
      toast.error(tApiError({ t, err: e, fallbackKey: "errors.SAVE_FAILED" }))
    } finally {
      setSaving(false)
    }
  }

  function reset() {
    if (loading || saving) return
    setDraft(userTimezone || effectiveTimezone || "UTC")
  }

  return (
    <SettingsSection>
      <SettingsSectionHeader title={t("settings.timezone.title")} description={t("settings.timezone.description")} />
      <form
        onSubmit={(e) => {
          e.preventDefault()
          if (saving || loading || !dirty) return
          void save()
        }}
      >
        <SettingsSectionContent>
          <div className="space-y-4">
            <FieldGroup>
              <Field data-disabled={loading || saving} className="gap-2">
                <FieldLabel>{t("schedules.timezone")}</FieldLabel>
                <TimezoneCombobox
                  value={draft}
                  onValueChange={setDraft}
                  disabled={loading || saving}
                  placeholder={t("schedules.timezoneSelect")}
                  searchPlaceholder={t("common.timezoneCombobox.searchPlaceholder")}
                  emptyText={t("common.timezoneCombobox.empty")}
                  commonGroupLabel={t("common.timezoneCombobox.commonGroup")}
                  allGroupLabel={t("common.timezoneCombobox.allGroup")}
                  className="w-full"
                />
              </Field>
            </FieldGroup>

            <SettingsSectionFooter
              onReset={reset}
              resetDisabled={!dirty || saving || loading}
              resetLabel={t("common.resetAction")}
              saveType="submit"
              saveDisabled={saving || loading || !dirty}
              saveLabel={t("common.saveAction")}
              saving={saving}
              savingLabel={t("common.saving")}
            />
          </div>
        </SettingsSectionContent>
      </form>
    </SettingsSection>
  )
}
