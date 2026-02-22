"use client"

import * as React from "react"
import { ChevronRight, Mail } from "lucide-react"

import { useI18n } from "@/components/i18n-provider"
import { ItemsList } from "@/components/common/items-list"
import { CommonListItem } from "@/components/common/common-list-item"
import { ItemContent, ItemDescription, ItemTitle } from "@/components/ui/item"
import { Button } from "@/components/ui/button"
import { Switch } from "@/components/ui/switch"
import { Spinner } from "@/components/ui/spinner"
import { useListQuery } from "@/hooks/list-query/use-list-query"
import { apiFetchJson } from "@/lib/shared/http/api"
import { toast } from "@/lib/client/toast"
import { tApiError } from "@/lib/shared/i18n/error"
import {
  EmailTemplateEditorSheet,
  type EmailTemplateEditorModel,
} from "@/components/settings/system/sheets/email-template-editor-sheet"
import { cn } from "@/lib/utils"
import {
  EMAIL_NOTIFICATION_BITS,
  hasEmailNotification,
  setEmailNotification,
  type EmailNotificationKey,
} from "@/lib/shared/email/notification-mask"

type EmailTemplateRow = {
  id: string
  key: string
  locale: string
  subjectTemplate: string
  htmlTemplate: string
  textTemplate: string | null
  schemaJson: string
  version: number
  updatedAt: string
}

const TEMPLATE_LOCALES = ["en", "zh-cn"] as const

function isNotificationKey(k: string): k is EmailNotificationKey {
  return k in EMAIL_NOTIFICATION_BITS
}

type TemplateItemSpec = {
  key: string
  titleKey: string
  descriptionKey: string
}

const groups: Array<{ titleKey: string; items: TemplateItemSpec[] }> = [
  {
    titleKey: "settings.system.emailTemplates.groups.authentication",
    items: [
      {
        key: "SIGNUP_CONFIRMATION",
        titleKey: "settings.system.emailTemplates.items.SIGNUP_CONFIRMATION.title",
        descriptionKey: "settings.system.emailTemplates.items.SIGNUP_CONFIRMATION.description",
      },
      {
        key: "SIGNUP_INVITE",
        titleKey: "settings.system.emailTemplates.items.SIGNUP_INVITE.title",
        descriptionKey: "settings.system.emailTemplates.items.SIGNUP_INVITE.description",
      },
      {
        key: "AUTH_MAGIC_LINK",
        titleKey: "settings.system.emailTemplates.items.AUTH_MAGIC_LINK.title",
        descriptionKey: "settings.system.emailTemplates.items.AUTH_MAGIC_LINK.description",
      },
      {
        key: "AUTH_EMAIL_OTP",
        titleKey: "settings.system.emailTemplates.items.AUTH_EMAIL_OTP.title",
        descriptionKey: "settings.system.emailTemplates.items.AUTH_EMAIL_OTP.description",
      },
      {
        key: "TOTP_ENABLED_NOTIFICATION",
        titleKey: "settings.system.emailTemplates.items.TOTP_ENABLED_NOTIFICATION.title",
        descriptionKey: "settings.system.emailTemplates.items.TOTP_ENABLED_NOTIFICATION.description",
      },
      {
        key: "TOTP_DISABLED_NOTIFICATION",
        titleKey: "settings.system.emailTemplates.items.TOTP_DISABLED_NOTIFICATION.title",
        descriptionKey: "settings.system.emailTemplates.items.TOTP_DISABLED_NOTIFICATION.description",
      },
      {
        key: "PASSWORD_RESET",
        titleKey: "settings.system.emailTemplates.items.PASSWORD_RESET.title",
        descriptionKey: "settings.system.emailTemplates.items.PASSWORD_RESET.description",
      },
      {
        key: "ADMIN_PASSWORD_RESET_LINK",
        titleKey: "settings.system.emailTemplates.items.ADMIN_PASSWORD_RESET_LINK.title",
        descriptionKey: "settings.system.emailTemplates.items.ADMIN_PASSWORD_RESET_LINK.description",
      },
    ],
  },
  {
    titleKey: "settings.system.emailTemplates.groups.notifications",
    items: [
      {
        key: "RUN_FAILED_NOTIFICATION",
        titleKey: "settings.system.emailTemplates.items.RUN_FAILED_NOTIFICATION.title",
        descriptionKey: "settings.system.emailTemplates.items.RUN_FAILED_NOTIFICATION.description",
      },
      {
        key: "RUN_SUCCEEDED_NOTIFICATION",
        titleKey: "settings.system.emailTemplates.items.RUN_SUCCEEDED_NOTIFICATION.title",
        descriptionKey: "settings.system.emailTemplates.items.RUN_SUCCEEDED_NOTIFICATION.description",
      },
      {
        key: "RUN_CANCELED_NOTIFICATION",
        titleKey: "settings.system.emailTemplates.items.RUN_CANCELED_NOTIFICATION.title",
        descriptionKey: "settings.system.emailTemplates.items.RUN_CANCELED_NOTIFICATION.description",
      },
    ],
  },
  {
    titleKey: "settings.system.emailTemplates.groups.system",
    items: [
      {
        key: "SYSTEM_SMTP_TEST",
        titleKey: "settings.system.emailTemplates.items.SYSTEM_SMTP_TEST.title",
        descriptionKey: "settings.system.emailTemplates.items.SYSTEM_SMTP_TEST.description",
      },
    ],
  },
] as const

export function EmailTemplatesSection(props: {
  emailNotificationMask: number
  onUpdateEmailNotificationMask: (nextMask: number) => void | Promise<void>
  className?: string
}) {
  const { t, locale: uiLocale } = useI18n()

  const templatesQuery = useListQuery<{ templates?: EmailTemplateRow[] }>({
    queryKey: ["emailTemplates"],
    queryFn: async ({ signal }) => apiFetchJson("/api/settings/system/email/templates", { method: "GET", signal }),
  })
  const rows = Array.isArray(templatesQuery.data?.templates) ? templatesQuery.data.templates : []
  const loading = templatesQuery.isLoading && !templatesQuery.data

  const [saving, setSaving] = React.useState(false)

  const [sheetOpen, setSheetOpen] = React.useState(false)
  const [activeKey, setActiveKey] = React.useState<string | null>(null)
  const preferredLocale = React.useMemo(() => {
    return uiLocale === "zh-cn" || uiLocale.startsWith("zh") ? "zh-cn" : "en"
  }, [uiLocale])
  const [activeLocale, setActiveLocale] = React.useState<string>(() => preferredLocale)

  React.useEffect(() => {
    if (sheetOpen) return
    setActiveLocale(preferredLocale)
  }, [preferredLocale, sheetOpen])

  const templateByKeyLocale = React.useMemo(() => {
    const map = new Map<string, EmailTemplateRow>()
    for (const r of rows) {
      map.set(`${r.key}:${r.locale}`, r)
    }
    return map
  }, [rows])

  const activeTemplate: EmailTemplateEditorModel | null = React.useMemo(() => {
    if (!activeKey) return null
    const row = templateByKeyLocale.get(`${activeKey}:${activeLocale}`) ?? null
    if (!row) return null
    return {
      key: row.key,
      locale: row.locale,
      subjectTemplate: row.subjectTemplate,
      htmlTemplate: row.htmlTemplate,
      textTemplate: row.textTemplate,
      schemaJson: row.schemaJson,
    }
  }, [activeKey, activeLocale, templateByKeyLocale])

  function openTemplate(key: string) {
    setActiveKey(key)
    // Always default to the current UI language when opening a template.
    setActiveLocale(preferredLocale)
    setSheetOpen(true)
  }

  async function saveTemplate(draft: EmailTemplateEditorModel) {
    if (saving) return
    setSaving(true)
    try {
      const json = await apiFetchJson<{ template?: EmailTemplateRow }>("/api/settings/system/email/templates", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          key: draft.key,
          locale: draft.locale,
          subjectTemplate: draft.subjectTemplate,
          htmlTemplate: draft.htmlTemplate,
          textTemplate: draft.textTemplate,
          schemaJson: draft.schemaJson,
        }),
      })
      await templatesQuery.refetch()
      toast.success(t("common.saved"))
    } catch (e) {
      toast.error(tApiError({ t, err: e, fallbackKey: "common.updateFailed" }))
    } finally {
      setSaving(false)
    }
  }

  async function toggleNotification(key: EmailNotificationKey, enabled: boolean) {
    const nextMask = setEmailNotification(props.emailNotificationMask, key, enabled)
    await props.onUpdateEmailNotificationMask(nextMask)
  }

  return (
    <div className={cn("space-y-6 pb-8", props.className)}>
      {groups.map((g) => (
        <div key={g.titleKey} className="space-y-2">
          <div className="text-sm font-medium">{t(g.titleKey)}</div>
          <ItemsList<TemplateItemSpec>
            items={g.items}
            getKey={(it) => it.key}
            separator={true}
            empty={loading ? t("common.loading") : "—"}
            renderItem={(it) => {
              const notifKey = isNotificationKey(it.key) ? it.key : null
              const enabled = notifKey ? hasEmailNotification(props.emailNotificationMask, notifKey) : null

              const leftColumn = (
                <ItemContent className="min-w-0">
                  <ItemTitle className="w-full min-w-0">
                    <span className="truncate">{t(it.titleKey)}</span>
                  </ItemTitle>
                  <ItemDescription className="mt-0.5 text-xs">{t(it.descriptionKey)}</ItemDescription>
                </ItemContent>
              )

              const actions = (
                <div className="flex items-center gap-2">
                  {notifKey ? (
                    <Switch
                      checked={Boolean(enabled)}
                      disabled={loading}
                      onCheckedChange={(v) => {
                        void toggleNotification(notifKey, v)
                      }}
                      onClick={(e) => e.stopPropagation()}
                    />
                  ) : null}
                  <Button
                    type="button"
                    size="icon-sm"
                    variant="ghost"
                    disabled={loading}
                    aria-label={t("common.editAction")}
                    onClick={() => openTemplate(it.key)}
                  >
                    <ChevronRight className="size-4" aria-hidden="true" />
                  </Button>
                </div>
              )

              return (
                <CommonListItem
                  columns={[{ key: "left", content: leftColumn, showOnMobile: true }]}
                  actions={
                    loading ? (
                      <div className="flex items-center gap-2">
                        <Spinner aria-label={t("common.loading")} />
                      </div>
                    ) : (
                      actions
                    )
                  }
                />
              )
            }}
          />
        </div>
      ))}

      <EmailTemplateEditorSheet
        open={sheetOpen}
        onOpenChange={setSheetOpen}
        template={activeTemplate}
        locales={[...TEMPLATE_LOCALES]}
        onChangeLocale={(next) => setActiveLocale(next)}
        saving={saving}
        onSave={saveTemplate}
      />
    </div>
  )
}
