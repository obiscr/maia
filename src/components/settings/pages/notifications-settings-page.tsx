"use client"

import * as React from "react"

import { useI18n } from "@/components/i18n-provider"
import { SettingsSection } from "@/components/settings/settings-section"
import { SettingsSectionContent } from "@/components/settings/settings-section-content"
import { SettingsSectionFooter } from "@/components/settings/settings-section-footer"
import { SettingsSectionHeader } from "@/components/settings/settings-section-header"
import { Field, FieldDescription, FieldGroup, FieldTitle } from "@/components/ui/field"
import { Switch } from "@/components/ui/switch"
import { toast } from "@/lib/client/toast"
import { apiFetchJson } from "@/lib/shared/http/api"
import { tApiError } from "@/lib/shared/i18n/error"
import {
  hasEmailNotification,
  setEmailNotification,
  type EmailNotificationKey,
  isValidEmailNotificationMask,
} from "@/lib/shared/email/notification-mask"

type NotificationsSettings = {
  // null => not configured (fall back to system default)
  emailNotificationMask: number | null
  systemEmailNotificationMask: number
  effectiveEmailNotificationMask: number
}

const DEFAULTS: NotificationsSettings = {
  emailNotificationMask: null,
  systemEmailNotificationMask: 0,
  effectiveEmailNotificationMask: 0,
}

const RUN_KEYS: Array<{
  key: EmailNotificationKey
  titleKey: string
  descriptionKey: string
}> = [
  {
    key: "RUN_FAILED_NOTIFICATION",
    titleKey: "settings.notifications.items.RUN_FAILED_NOTIFICATION.title",
    descriptionKey: "settings.notifications.items.RUN_FAILED_NOTIFICATION.description",
  },
  {
    key: "RUN_SUCCEEDED_NOTIFICATION",
    titleKey: "settings.notifications.items.RUN_SUCCEEDED_NOTIFICATION.title",
    descriptionKey: "settings.notifications.items.RUN_SUCCEEDED_NOTIFICATION.description",
  },
  {
    key: "RUN_CANCELED_NOTIFICATION",
    titleKey: "settings.notifications.items.RUN_CANCELED_NOTIFICATION.title",
    descriptionKey: "settings.notifications.items.RUN_CANCELED_NOTIFICATION.description",
  },
]

function normalizeMask(v: unknown): number | null {
  return isValidEmailNotificationMask(v) ? Math.floor(v) : null
}

export default function NotificationsSettingsPage() {
  const { t } = useI18n()
  const [loading, setLoading] = React.useState(true)
  const [saving, setSaving] = React.useState(false)
  const [initial, setInitial] = React.useState<NotificationsSettings>(DEFAULTS)
  const [mask, setMask] = React.useState<number | null>(null)
  const [systemMask, setSystemMask] = React.useState<number>(0)

  React.useEffect(() => {
    let cancelled = false
    async function load() {
      setLoading(true)
      try {
        const json = await apiFetchJson<{ settings?: Partial<NotificationsSettings> }>("/api/settings/notifications", {
          method: "GET",
        })
        const next: NotificationsSettings = {
          emailNotificationMask: normalizeMask(json.settings?.emailNotificationMask ?? null),
          systemEmailNotificationMask: normalizeMask(json.settings?.systemEmailNotificationMask ?? 0) ?? 0,
          effectiveEmailNotificationMask: normalizeMask(json.settings?.effectiveEmailNotificationMask ?? 0) ?? 0,
        }
        if (cancelled) return
        setInitial(next)
        setMask(next.emailNotificationMask)
        setSystemMask(next.systemEmailNotificationMask)
      } catch {
        if (!cancelled) toast.error(t("common.loadFailed"))
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    void load()
    return () => {
      cancelled = true
    }
  }, [t])

  const effectiveMask = React.useMemo(() => (mask === null ? systemMask : mask), [mask, systemMask])

  const dirty = mask !== initial.emailNotificationMask

  function setEnabled(key: EmailNotificationKey, enabled: boolean) {
    const next = setEmailNotification(effectiveMask, key, enabled)
    setMask(next)
  }

  async function save() {
    if (saving || loading) return
    setSaving(true)
    try {
      const json = await apiFetchJson<{ settings?: Partial<NotificationsSettings> }>("/api/settings/notifications", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ emailNotificationMask: mask }),
      })
      const next: NotificationsSettings = {
        emailNotificationMask: normalizeMask(json.settings?.emailNotificationMask ?? mask),
        systemEmailNotificationMask:
          normalizeMask(json.settings?.systemEmailNotificationMask ?? systemMask) ?? systemMask,
        effectiveEmailNotificationMask:
          normalizeMask(json.settings?.effectiveEmailNotificationMask ?? (mask === null ? systemMask : mask)) ??
          (mask === null ? systemMask : mask),
      }
      setInitial(next)
      setMask(next.emailNotificationMask)
      setSystemMask(next.systemEmailNotificationMask)
      toast.success(t("common.saved"))
    } catch (e) {
      toast.error(tApiError({ t, err: e, fallbackKey: "errors.SAVE_FAILED" }))
    } finally {
      setSaving(false)
    }
  }

  function resetLocal() {
    setMask(initial.emailNotificationMask)
  }

  return (
    <SettingsSection>
      <SettingsSectionHeader
        title={t("settings.notifications.title")}
        description={t("settings.notifications.description")}
      />
      <form
        onSubmit={(e) => {
          e.preventDefault()
          if (saving || loading || !dirty) return
          void save()
        }}
      >
        <SettingsSectionContent>
          <div className="space-y-4">
            <FieldGroup className="gap-6">
              <Field
                orientation="horizontal"
                className="items-center justify-between gap-4"
                data-disabled={loading || saving}
              >
                <div className="space-y-0.5">
                  <FieldTitle>{t("settings.notifications.useSystemDefaultAction")}</FieldTitle>
                  <FieldDescription className="text-xs">
                    {t("settings.notifications.useSystemDefaultHint")}
                  </FieldDescription>
                </div>
                <Switch
                  checked={mask === null}
                  onCheckedChange={(v) => {
                    if (v) setMask(null)
                    else setMask(systemMask)
                  }}
                  disabled={loading || saving}
                />
              </Field>

              {RUN_KEYS.map((it) => {
                const enabled = hasEmailNotification(effectiveMask, it.key)
                const disabled = loading || saving || mask === null
                return (
                  <Field
                    key={it.key}
                    orientation="horizontal"
                    className="items-center justify-between gap-4"
                    data-disabled={disabled}
                  >
                    <div className="space-y-0.5">
                      <FieldTitle>{t(it.titleKey)}</FieldTitle>
                      <FieldDescription className="text-xs">{t(it.descriptionKey)}</FieldDescription>
                    </div>
                    <Switch checked={enabled} onCheckedChange={(v) => setEnabled(it.key, v)} disabled={disabled} />
                  </Field>
                )
              })}
            </FieldGroup>

            <SettingsSectionFooter
              onReset={resetLocal}
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
