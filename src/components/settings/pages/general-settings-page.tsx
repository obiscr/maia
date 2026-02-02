"use client"

import * as React from "react"

import { useI18n } from "@/components/i18n-provider"
import { SettingsSection } from "@/components/settings/settings-section"
import { SettingsSectionContent } from "@/components/settings/settings-section-content"
import { SettingsSectionFooter } from "@/components/settings/settings-section-footer"
import { SettingsSectionHeader } from "@/components/settings/settings-section-header"
import { SettingsSectionGroup } from "@/components/settings/settings-section-group"
import { Field, FieldDescription, FieldGroup, FieldLabel } from "@/components/ui/field"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { TimezoneCombobox } from "@/components/common/timezone-combobox"
import { toast } from "@/lib/client/toast"
import { tApiError } from "@/lib/shared/i18n/error"
import { useTimezone } from "@/components/timezone-provider"
import { apiFetchJson } from "@/lib/shared/http/api"
import { SettingsFormSkeleton } from "@/components/settings/settings-skeletons"

function normalizeUiLocale(uiLocale: string) {
  const l = String(uiLocale ?? "")
    .trim()
    .toLowerCase()
  return l === "zh-cn" || l.startsWith("zh") ? "zh-cn" : "en"
}

export default function GeneralSettingsPage() {
  const { t, locale: uiLocale } = useI18n()
  const uiPreferredLocale = React.useMemo(() => normalizeUiLocale(uiLocale), [uiLocale])

  // --- outbound language (Scheme A) ---
  type OutboundLanguage = "auto" | "en" | "zh-cn"
  const [outboundLoading, setOutboundLoading] = React.useState(true)
  const [outboundSaving, setOutboundSaving] = React.useState(false)
  const [outboundInitial, setOutboundInitial] = React.useState<OutboundLanguage>("auto")
  const [outboundLanguage, setOutboundLanguage] = React.useState<OutboundLanguage>("auto")

  React.useEffect(() => {
    let cancelled = false
    async function load() {
      setOutboundLoading(true)
      try {
        const json = await apiFetchJson<{ settings?: { outboundLanguage?: OutboundLanguage } }>(
          "/api/settings/preferred-language",
          { method: "GET" },
        )
        const v = (json.settings?.outboundLanguage ?? "auto") as OutboundLanguage
        if (cancelled) return
        setOutboundInitial(v)
        setOutboundLanguage(v)
      } catch (e) {
        if (!cancelled) toast.error(tApiError({ t, err: e, fallbackKey: "common.loadFailed" }))
      } finally {
        if (!cancelled) setOutboundLoading(false)
      }
    }
    void load()
    return () => {
      cancelled = true
    }
  }, [t, uiPreferredLocale])

  const outboundDirty = React.useMemo(() => {
    if (outboundLoading) return false
    return outboundLanguage !== outboundInitial
  }, [outboundLanguage, outboundInitial, outboundLoading])

  async function saveOutboundLanguage() {
    if (outboundSaving || outboundLoading) return
    setOutboundSaving(true)
    try {
      const json = await apiFetchJson<{ settings?: { outboundLanguage?: OutboundLanguage } }>(
        "/api/settings/preferred-language",
        {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ outboundLanguage }),
        },
      )
      const next = (json.settings?.outboundLanguage ?? outboundLanguage) as OutboundLanguage
      setOutboundInitial(next)
      setOutboundLanguage(next)
      toast.success(t("common.saved"))
    } catch (e) {
      toast.error(tApiError({ t, err: e, fallbackKey: "errors.SAVE_FAILED" }))
    } finally {
      setOutboundSaving(false)
    }
  }

  function resetOutboundLanguage() {
    if (outboundLoading || outboundSaving) return
    setOutboundLanguage(outboundInitial)
  }

  // --- timezone ---
  const { userTimezone, effectiveTimezone, loading: tzLoading, setUserTimezone } = useTimezone()
  const [tzDraft, setTzDraft] = React.useState<string>("UTC")
  const [tzSaving, setTzSaving] = React.useState(false)

  React.useEffect(() => {
    if (tzLoading) return
    setTzDraft(userTimezone || effectiveTimezone || "UTC")
  }, [effectiveTimezone, tzLoading, userTimezone])

  const tzDirty = !tzLoading && tzDraft.trim() !== String(userTimezone || effectiveTimezone || "UTC").trim()

  async function saveTimezone() {
    if (tzSaving || tzLoading) return
    setTzSaving(true)
    try {
      await setUserTimezone(tzDraft.trim())
      toast.success(t("common.saved"))
    } catch (e) {
      toast.error(tApiError({ t, err: e, fallbackKey: "errors.SAVE_FAILED" }))
    } finally {
      setTzSaving(false)
    }
  }

  function resetTimezone() {
    if (tzLoading || tzSaving) return
    setTzDraft(userTimezone || effectiveTimezone || "UTC")
  }

  return (
    <SettingsSectionGroup>
      <SettingsSection>
        <SettingsSectionHeader
          title={t("settings.general.preferredLanguage.sectionTitle")}
          description={t("settings.general.preferredLanguage.sectionHint")}
        />
        <SettingsSectionContent>
          {outboundLoading ? (
            <SettingsFormSkeleton rows={1} />
          ) : (
            <form
              onSubmit={(e) => {
                e.preventDefault()
                if (outboundSaving || outboundLoading || !outboundDirty) return
                void saveOutboundLanguage()
              }}
            >
              <div className="space-y-4">
                <FieldGroup>
                  <Field data-disabled={outboundLoading || outboundSaving}>
                    <FieldLabel htmlFor="preferred-language">
                      {t("settings.general.preferredLanguage.label")}
                    </FieldLabel>
                    <Select
                      value={outboundLanguage}
                      onValueChange={(v) => setOutboundLanguage(v as OutboundLanguage)}
                      disabled={outboundLoading || outboundSaving}
                    >
                      <SelectTrigger id="preferred-language">
                        <SelectValue placeholder={t("settings.general.preferredLanguage.placeholder")} />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="auto">{t("settings.general.preferredLanguage.followUi")}</SelectItem>
                        <SelectItem value="en">{t("language.english")}</SelectItem>
                        <SelectItem value="zh-cn">{t("language.chinese")}</SelectItem>
                      </SelectContent>
                    </Select>
                    <FieldDescription>
                      {outboundLanguage === "auto"
                        ? t("settings.general.preferredLanguage.followUiHint")
                        : t("settings.general.preferredLanguage.sectionHint")}
                    </FieldDescription>
                  </Field>
                </FieldGroup>

                <SettingsSectionFooter
                  onReset={resetOutboundLanguage}
                  resetDisabled={!outboundDirty || outboundSaving || outboundLoading}
                  resetLabel={t("common.resetAction")}
                  saveType="submit"
                  saveDisabled={outboundSaving || outboundLoading || !outboundDirty}
                  saveLabel={t("common.saveAction")}
                  saving={outboundSaving}
                  savingLabel={t("common.saving")}
                />
              </div>
            </form>
          )}
        </SettingsSectionContent>
      </SettingsSection>

      <SettingsSection>
        <SettingsSectionHeader title={t("settings.timezone.title")} description={t("settings.timezone.description")} />
        <SettingsSectionContent>
          {tzLoading ? (
            <SettingsFormSkeleton rows={1} />
          ) : (
            <form
              onSubmit={(e) => {
                e.preventDefault()
                if (tzSaving || tzLoading || !tzDirty) return
                void saveTimezone()
              }}
            >
              <div className="space-y-4">
                <FieldGroup>
                  <Field data-disabled={tzLoading || tzSaving} className="gap-2">
                    <FieldLabel>{t("schedules.timezone")}</FieldLabel>
                    <TimezoneCombobox
                      value={tzDraft}
                      onValueChange={setTzDraft}
                      disabled={tzLoading || tzSaving}
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
                  onReset={resetTimezone}
                  resetDisabled={!tzDirty || tzSaving || tzLoading}
                  resetLabel={t("common.resetAction")}
                  saveType="submit"
                  saveDisabled={tzSaving || tzLoading || !tzDirty}
                  saveLabel={t("common.saveAction")}
                  saving={tzSaving}
                  savingLabel={t("common.saving")}
                />
              </div>
            </form>
          )}
        </SettingsSectionContent>
      </SettingsSection>
    </SettingsSectionGroup>
  )
}
