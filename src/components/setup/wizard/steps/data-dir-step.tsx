"use client"

import * as React from "react"
import { ArrowLeft, ArrowRight } from "lucide-react"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Switch } from "@/components/ui/switch"
import { Skeleton } from "@/components/ui/skeleton"
import { Spinner } from "@/components/ui/spinner"
import { Field, FieldContent, FieldDescription, FieldLabel } from "@/components/ui/field"
import { useI18n } from "@/components/i18n-provider"
import { apiFetchJson } from "@/lib/shared/http/api"
import { tApiError, tError } from "@/lib/shared/i18n/error"
import { toast } from "@/lib/client/toast"

import { useSetupWizardFooter } from "../footer-context"
import { useSetupWizardStatus } from "../status-context"

type DataDirInfo = {
  config?: { dataDir?: string | null }
  effective?: { dataDir?: string; databaseUrl?: string }
  meta?: { lockedByEnv?: boolean; configPath?: string }
}

export function DataDirStep({
  onNext,
  onBack,
  active = true,
  committed = false,
  onCommitted,
}: {
  onNext: () => void
  onBack: () => void
  active?: boolean
  committed?: boolean
  onCommitted?: () => void
}) {
  const { t } = useI18n()
  const { initialized } = useSetupWizardStatus()
  const [loading, setLoading] = React.useState(true)
  const [saving, setSaving] = React.useState(false)
  const [useCustom, setUseCustom] = React.useState(false)
  const [customPath, setCustomPath] = React.useState("")
  const [effectivePath, setEffectivePath] = React.useState("")
  const [configPath, setConfigPath] = React.useState("")
  const [lockedByEnv, setLockedByEnv] = React.useState(false)
  const [pathError, setPathError] = React.useState<string | null>(null)
  const [checkingPath, setCheckingPath] = React.useState(false)

  React.useEffect(() => {
    let cancelled = false
    async function load() {
      setLoading(true)
      try {
        const json = await apiFetchJson<DataDirInfo>("/api/setup/data-dir", { method: "GET" })
        if (cancelled) return
        const cfg = typeof json.config?.dataDir === "string" ? json.config?.dataDir : ""
        const locked = Boolean(json.meta?.lockedByEnv)
        setLockedByEnv(locked)
        setConfigPath(String(json.meta?.configPath ?? ""))
        setUseCustom(!locked && Boolean(cfg.trim()))
        setCustomPath(!locked ? cfg : "")
        setEffectivePath(String(json.effective?.dataDir ?? ""))
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

  async function saveAndNext() {
    // Data dir becomes immutable once the instance has users/installation row (initialized).
    // If the user navigates back in the same session, allow them to continue without re-saving.
    if (initialized || committed) {
      onNext()
      return
    }
    if (saving || loading) return
    setSaving(true)
    try {
      // In deployments where MAIA_DATA_DIR is set, the data dir is locked but we still need
      // a user-driven "initialize" action in this step.
      if (lockedByEnv) {
        await apiFetchJson("/api/setup/initialize-db", { method: "POST" })
        toast.success(t("common.saved"))
        onCommitted?.()
        onNext()
        return
      }

      if (useCustom) {
        const v = customPath.trim()
        if (!v) {
          setPathError(tError({ t, code: "DATA_DIR_REQUIRED", fallbackKey: "errors.DATA_DIR_REQUIRED" }))
          return
        }
        setCheckingPath(true)
        setPathError(null)
        try {
          await apiFetchJson("/api/setup/data-dir", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ dataDir: v }),
          })
        } catch (e) {
          setPathError(tApiError({ t, err: e, fallbackKey: "errors.HTTP_ERROR" }))
          return
        } finally {
          setCheckingPath(false)
        }
      }

      const body = { dataDir: useCustom ? (customPath.trim() ? customPath.trim() : null) : null }
      const json = await apiFetchJson<{ effective?: { dataDir?: string } }>("/api/setup/data-dir", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      })
      setEffectivePath(String(json.effective?.dataDir ?? ""))
      toast.success(t("common.saved"))
      onCommitted?.()
      onNext()
    } catch (e) {
      toast.error(tApiError({ t, err: e, fallbackKey: "errors.HTTP_ERROR" }))
    } finally {
      setSaving(false)
    }
  }

  function onToggleCustom(next: boolean) {
    if (initialized || committed || lockedByEnv) return
    setUseCustom(next)
    setPathError(null)
    if (next) {
      setCustomPath((prev) => (prev.trim() ? prev : effectivePath))
    }
  }

  const isInvalid = useCustom && Boolean(pathError)

  useSetupWizardFooter(
    () => (
      <div className="flex items-center justify-between gap-3">
        <Button variant="ghost" size="sm" onClick={onBack}>
          <ArrowLeft className="size-4" aria-hidden="true" />
          {t("setupWizard.actions.backAction")}
        </Button>
        {initialized ? (
          <Button size="sm" onClick={onNext}>
            {t("setupWizard.admin.continueAction")}
            <ArrowRight className="size-4" aria-hidden="true" />
          </Button>
        ) : committed ? (
          <Button size="sm" onClick={onNext}>
            {t("setupWizard.admin.continueAction")}
            <ArrowRight className="size-4" aria-hidden="true" />
          </Button>
        ) : (
          <Button
            size="sm"
            onClick={saveAndNext}
            disabled={loading || saving || checkingPath || (useCustom && (!customPath.trim() || Boolean(pathError)))}
          >
            {(saving || checkingPath) && <Spinner aria-label={t("common.loading")} />}
            {t("setupWizard.dataDir.initializeAndContinueAction")}
            <ArrowRight className="size-4" aria-hidden="true" />
          </Button>
        )}
      </div>
    ),
    // Important: keep deps stable to avoid infinite update loops via footer context.
    [initialized, committed, loading, saving, useCustom, customPath, checkingPath, pathError, onNext, onBack, t],
    active,
  )

  if (loading) {
    return (
      <div className="space-y-4">
        <div className="space-y-2">
          <div className="flex items-center justify-between gap-4">
            <Skeleton className="h-5 w-24" />
            <Skeleton className="h-6 w-20 rounded-full" />
          </div>
          <Skeleton className="h-9 w-full" />
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-2">
      <Field data-invalid={isInvalid || undefined}>
        <div className="flex items-center justify-between gap-4">
          <FieldLabel htmlFor="data-dir" className="text-sm font-medium">
            {t("setupWizard.dataDir.label")}
            {useCustom ? <span className="text-destructive"> *</span> : null}
          </FieldLabel>
          <div className="flex items-center gap-2">
            <div className="text-sm text-muted-foreground">{t("setupWizard.dataDir.custom")}</div>
            <Switch
              checked={useCustom}
              onCheckedChange={onToggleCustom}
              disabled={lockedByEnv || initialized || committed || loading || saving}
            />
          </div>
        </div>

        <FieldContent className="gap-3">
          <Input
            id="data-dir"
            placeholder={t("setupWizard.dataDir.placeholder")}
            value={useCustom ? customPath : effectivePath}
            onChange={(e) => {
              setCustomPath(e.target.value)
              if (pathError) setPathError(null)
            }}
            disabled={lockedByEnv || initialized || committed || !useCustom || loading || saving}
            aria-invalid={isInvalid || undefined}
            spellCheck={false}
            className="font-mono text-xs"
          />
          {lockedByEnv ? (
            <FieldDescription>{t("setupWizard.dataDir.envLockedHint")}</FieldDescription>
          ) : initialized || committed ? (
            <FieldDescription>{t("setupWizard.dataDir.lockedHint")}</FieldDescription>
          ) : isInvalid ? (
            <FieldDescription>{pathError}</FieldDescription>
          ) : null}
        </FieldContent>
      </Field>
    </div>
  )
}
