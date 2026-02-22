"use client"

import { useEffect, useMemo, useState } from "react"
import { Eye, EyeOff } from "lucide-react"

import { useI18n } from "@/components/i18n-provider"
import { SettingsSection } from "@/components/settings/settings-section"
import { SettingsSectionContent } from "@/components/settings/settings-section-content"
import { SettingsSectionFooter } from "@/components/settings/settings-section-footer"
import { SettingsSectionHeader } from "@/components/settings/settings-section-header"
import { Button } from "@/components/ui/button"
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field"
import { SecretInput } from "@/components/ui/secret-input"
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectSeparator,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { apiFetchJson } from "@/lib/shared/http/api"
import { tApiError } from "@/lib/shared/i18n/error"
import { toast } from "@/lib/client/toast"
import { SettingsFormSkeleton } from "@/components/settings/settings-skeletons"
import { AVAILABLE_MODELS, groupModelsByProvider } from "@/lib/shared/models"

type AgentSettingsStatus = {
  apiKeyConfigured: boolean
  model: string
}

type AgentSettingsResponse = {
  settings: AgentSettingsStatus
}

const DEFAULTS: AgentSettingsStatus = { apiKeyConfigured: false, model: "anthropic/claude-opus-4.6" }

export default function AgentSettingsPage() {
  const { t } = useI18n()
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [initial, setInitial] = useState<AgentSettingsStatus>(DEFAULTS)
  const [apiKeyDraft, setApiKeyDraft] = useState("")
  const [lastSavedApiKeyDraft, setLastSavedApiKeyDraft] = useState("")
  const [apiKeyClearRequested, setApiKeyClearRequested] = useState(false)
  const [model, setModel] = useState(DEFAULTS.model)
  const [showKey, setShowKey] = useState(false)

  useEffect(() => {
    let cancelled = false
    async function load() {
      setLoading(true)
      try {
        const json = await apiFetchJson<AgentSettingsResponse>("/api/settings/agent", {
          method: "GET",
        })
        const s: AgentSettingsStatus = {
          apiKeyConfigured: Boolean(json.settings?.apiKeyConfigured),
          model: String(json.settings?.model ?? DEFAULTS.model),
        }
        if (cancelled) return
        setInitial(s)
        // Never prefill secrets into the UI.
        setApiKeyDraft("")
        setLastSavedApiKeyDraft("")
        setApiKeyClearRequested(false)
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

  const dirty = model !== initial.model || apiKeyClearRequested || apiKeyDraft.trim() !== lastSavedApiKeyDraft

  const groupedModels = useMemo(() => groupModelsByProvider(AVAILABLE_MODELS, model), [model])

  async function save() {
    if (saving) return
    setSaving(true)
    try {
      const body: Record<string, unknown> = { model }
      const nextApiKeyDraft = apiKeyDraft.trim()
      if (nextApiKeyDraft) {
        body.apiKey = nextApiKeyDraft
      } else if (apiKeyClearRequested) {
        // User explicitly cleared a previously-saved key.
        body.apiKey = null
      }

      const json = await apiFetchJson<AgentSettingsResponse>("/api/settings/agent", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      })
      const s: AgentSettingsStatus = {
        apiKeyConfigured: Boolean(json.settings?.apiKeyConfigured ?? initial.apiKeyConfigured),
        model: String(json.settings?.model ?? model),
      }
      setInitial(s)
      // Never keep secrets in UI state after save.
      setApiKeyDraft("")
      setLastSavedApiKeyDraft("")
      setApiKeyClearRequested(false)
      setModel(s.model)
      toast.success(t("common.saved"))
    } catch (e) {
      toast.error(tApiError({ t, err: e, fallbackKey: "settings.agent.saveFailed" }))
    } finally {
      setSaving(false)
    }
  }

  function reset() {
    setApiKeyDraft("")
    setLastSavedApiKeyDraft("")
    setApiKeyClearRequested(false)
    setModel(initial.model)
  }

  return (
    <SettingsSection>
      <SettingsSectionHeader title={t("settings.agent.title")} description={t("settings.agent.description")} />
      <SettingsSectionContent>
        {loading ? (
          <SettingsFormSkeleton rows={2} />
        ) : (
          <form
            onSubmit={(e) => {
              e.preventDefault()
              if (saving || loading || !dirty) return
              void save()
            }}
          >
            <div className="space-y-4">
              <FieldGroup>
                <Field data-disabled={loading || saving}>
                  <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-2">
                    <FieldLabel htmlFor="agent-api-key" className="min-w-0 truncate">
                      {t("settings.agent.apiKey")}
                    </FieldLabel>
                    {initial.apiKeyConfigured ? (
                      <div className="inline-flex h-4 items-center gap-2 whitespace-nowrap text-sm leading-none text-muted-foreground">
                        <span className="select-none">{t("common.configured")}</span>
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          className="h-5 px-2 text-sm leading-none"
                          onClick={() => {
                            setApiKeyDraft("")
                            setApiKeyClearRequested(true)
                          }}
                          disabled={loading || saving}
                        >
                          {t("common.clearSecretAction")}
                        </Button>
                      </div>
                    ) : null}
                  </div>
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
                      {groupedModels.map((g, idx) => (
                        <SelectGroup key={g.provider}>
                          <SelectLabel>{g.provider}</SelectLabel>
                          {g.models.map((m) => (
                            <SelectItem key={m.id} value={m.id}>
                              {m.name}
                            </SelectItem>
                          ))}
                          {idx < groupedModels.length - 1 ? <SelectSeparator /> : null}
                        </SelectGroup>
                      ))}
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
          </form>
        )}
      </SettingsSectionContent>
    </SettingsSection>
  )
}
