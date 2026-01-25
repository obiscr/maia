"use client"

import { useEffect, useState } from "react"
import { Eye, EyeOff } from "lucide-react"

import { useI18n } from "@/components/i18n-provider"
import { SettingsSection } from "@/components/settings/settings-section"
import { SettingsSectionContent } from "@/components/settings/settings-section-content"
import { SettingsSectionFooter } from "@/components/settings/settings-section-footer"
import { SettingsSectionHeader } from "@/components/settings/settings-section-header"
import { Button } from "@/components/ui/button"
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { SecretInput } from "@/components/ui/secret-input"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { apiFetchJson } from "@/lib/shared/http/api"
import { tApiError } from "@/lib/shared/i18n/error"
import { toast } from "@/lib/client/toast"

type AgentSettingsStatus = {
  apiKeyConfigured: boolean
  apiKey?: string
  model: string
}

const DEFAULTS: AgentSettingsStatus = { apiKeyConfigured: false, model: "deepseek-chat" }

export default function AgentSettingsPage() {
  const { t } = useI18n()
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [initial, setInitial] = useState<AgentSettingsStatus>(DEFAULTS)
  const [apiKeyDraft, setApiKeyDraft] = useState("")
  const [lastSavedApiKeyDraft, setLastSavedApiKeyDraft] = useState("")
  const [model, setModel] = useState(DEFAULTS.model)
  const [showKey, setShowKey] = useState(false)

  useEffect(() => {
    let cancelled = false
    async function load() {
      setLoading(true)
      try {
        const json = await apiFetchJson<{ settings?: Partial<AgentSettingsStatus> }>("/api/settings/agent", {
          method: "GET",
        })
        const s: AgentSettingsStatus = {
          apiKeyConfigured: Boolean(json.settings?.apiKeyConfigured),
          apiKey: typeof json.settings?.apiKey === "string" ? String(json.settings?.apiKey) : undefined,
          model: String(json.settings?.model ?? DEFAULTS.model),
        }
        if (cancelled) return
        setInitial(s)
        const loadedKey = String(s.apiKey ?? "").trim()
        setApiKeyDraft(loadedKey)
        setLastSavedApiKeyDraft(loadedKey)
        setModel(s.model)
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

  const dirty = model !== initial.model || apiKeyDraft.trim() !== lastSavedApiKeyDraft

  async function save() {
    if (saving) return
    setSaving(true)
    try {
      const body: Record<string, unknown> = { model }
      const nextApiKeyDraft = apiKeyDraft.trim()
      if (nextApiKeyDraft) {
        body.apiKey = nextApiKeyDraft
      } else if (lastSavedApiKeyDraft) {
        // User cleared a previously-saved key.
        body.apiKey = null
      }

      const json = await apiFetchJson<{ settings?: Partial<AgentSettingsStatus> }>("/api/settings/agent", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      })
      const s: AgentSettingsStatus = {
        apiKeyConfigured: Boolean(json.settings?.apiKeyConfigured ?? initial.apiKeyConfigured),
        model: String(json.settings?.model ?? model),
      }
      setInitial(s)
      // Keep the key visible (masked) after save if user provided one.
      if (nextApiKeyDraft) {
        setApiKeyDraft(nextApiKeyDraft)
        setLastSavedApiKeyDraft(nextApiKeyDraft)
      } else {
        setApiKeyDraft("")
        setLastSavedApiKeyDraft("")
      }
      setModel(s.model)
      toast.success(t("common.saved"))
    } catch (e) {
      toast.error(tApiError({ t, err: e, fallbackKey: "settings.agent.saveFailed" }))
    } finally {
      setSaving(false)
    }
  }

  function reset() {
    setApiKeyDraft(lastSavedApiKeyDraft)
    setModel(initial.model)
  }

  return (
    <SettingsSection>
      <SettingsSectionHeader title={t("settings.agent.title")} description={t("settings.agent.description")} />
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
              <Field data-disabled={loading || saving}>
                <FieldLabel htmlFor="agent-api-key">{t("settings.agent.apiKey")}</FieldLabel>
                <div className="relative">
                  <SecretInput
                    id="agent-api-key"
                    value={apiKeyDraft}
                    onChange={(e) => setApiKeyDraft(e.target.value)}
                    masked={!showKey}
                    placeholder={t("settings.agent.apiKeyPlaceholder")}
                    className="w-full pr-10 font-mono text-xs"
                    disabled={loading || saving}
                  />
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-sm"
                    onClick={() => setShowKey((v) => !v)}
                    disabled={loading || saving}
                    aria-label={showKey ? t("settings.agent.hideAction") : t("settings.agent.showAction")}
                    className="absolute right-1 top-1/2 -translate-y-1/2 bg-transparent hover:bg-transparent focus-visible:ring-0 focus-visible:border-transparent"
                  >
                    {showKey ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
                  </Button>
                </div>
              </Field>

              <Field data-disabled={loading || saving}>
                <FieldLabel htmlFor="agent-model">{t("settings.agent.model")}</FieldLabel>
                <Select value={model} onValueChange={setModel} disabled={loading || saving}>
                  <SelectTrigger id="agent-model">
                    <SelectValue placeholder={t("settings.agent.modelPlaceholder")} />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="deepseek-chat">{t("settings.agent.models.deepseekChat")}</SelectItem>
                    <SelectItem value="deepseek-reasoner">{t("settings.agent.models.deepseekReasoner")}</SelectItem>
                  </SelectContent>
                </Select>
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
