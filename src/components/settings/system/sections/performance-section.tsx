"use client"

import { Cpu, MemoryStick } from "lucide-react"
import { Info } from "lucide-react"

import { OptionalTooltip } from "@/components/common/optional-tooltip"
import { useI18n } from "@/components/i18n-provider"
import { SettingsSectionFooter } from "@/components/settings/settings-section-footer"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Field, FieldDescription, FieldGroup, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import type { SavingSection } from "@/components/settings/system/hooks/use-system-settings"

type PerfSource = "override" | "env" | "default" | "invalid_env"
type PerfInfo = {
  effective: {
    globalRunConcurrency: number
    perRunStepConcurrency: number
    defaultStepTimeoutMs: number
    inputDownloadConcurrency: number
    inputDownloadTimeoutMs: number
    inputDownloadMaxBytes: number
  }
  source: {
    globalRunConcurrency: PerfSource
    perRunStepConcurrency: PerfSource
    defaultStepTimeoutMs: PerfSource
    inputDownloadConcurrency: PerfSource
    inputDownloadTimeoutMs: PerfSource
    inputDownloadMaxBytes: PerfSource
  }
}

export function PerformanceSection(props: {
  loading: boolean
  saving: boolean
  savingSection: SavingSection
  dirty: boolean

  hardwareSummary: string
  recommendedGlobalRunConcurrency: number | null

  locked: boolean
  info: PerfInfo | null

  globalRunConcurrency: string
  setGlobalRunConcurrency: (v: string) => void
  perRunStepConcurrency: string
  setPerRunStepConcurrency: (v: string) => void
  defaultStepTimeoutMs: string
  setDefaultStepTimeoutMs: (v: string) => void
  inputDownloadConcurrency: string
  setInputDownloadConcurrency: (v: string) => void
  inputDownloadTimeoutMs: string
  setInputDownloadTimeoutMs: (v: string) => void
  inputDownloadMaxBytes: string
  setInputDownloadMaxBytes: (v: string) => void

  onReset: () => void
  onSave: () => void
}) {
  const { t } = useI18n()
  const disabled = props.loading || props.saving || props.locked
  const canApplyRecommended =
    !!props.recommendedGlobalRunConcurrency &&
    String(props.recommendedGlobalRunConcurrency) !== props.globalRunConcurrency.trim()

  const infoButton = (tooltip: string, ariaLabel: string) => (
    <OptionalTooltip tooltip={tooltip} side="top" align="start">
      <Button
        type="button"
        variant="ghost"
        size="icon-sm"
        aria-label={ariaLabel}
        className="h-6 w-6 text-muted-foreground hover:text-foreground"
      >
        <Info className="size-4" />
      </Button>
    </OptionalTooltip>
  )

  const parsedHardwareSummary = (() => {
    const s = props.hardwareSummary?.trim()
    if (!s) return null
    const m =
      s.match(/cpu\s*[:=]\s*([^,]+)\s*,\s*mem(?:ory)?\s*[:=]\s*([^,]+)\s*$/i) ??
      s.match(/cpu\s*[:=]\s*([^,]+).*mem(?:ory)?\s*[:=]\s*([^,]+)/i)
    if (!m) return { raw: s }
    return { cpu: m[1]?.trim() ?? "", mem: m[2]?.trim() ?? "" }
  })()

  const sourceLabelKeyBySource: Record<PerfSource, string> = {
    override: "settings.system.advanced.sources.override",
    env: "settings.system.common.sources.env",
    default: "settings.system.common.sources.default",
    invalid_env: "settings.system.common.sources.invalid_env",
  }

  function metaLine(key: keyof PerfInfo["effective"]) {
    const src = props.info?.source?.[key]
    const eff = props.info?.effective?.[key]
    if (!src || typeof eff !== "number") return null
    const sourceLabelKey = sourceLabelKeyBySource[src]
    const sourceLabel = t(sourceLabelKey)
    return (
      <FieldDescription className="text-xs">
        {t("settings.system.common.effectiveLabel")} {String(eff)} · {t("settings.system.common.sourceLabel")}{" "}
        {sourceLabel}
      </FieldDescription>
    )
  }

  return (
    <div className="space-y-6">
      {props.locked ? (
        <div className="rounded-md border bg-muted/30 px-3 py-2 text-xs text-muted-foreground">
          {t("settings.system.advanced.lockedHint")}
        </div>
      ) : null}
      {parsedHardwareSummary ? (
        "raw" in parsedHardwareSummary ? (
          <div className="text-xs text-muted-foreground">{parsedHardwareSummary.raw}</div>
        ) : (
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant="outline" className="font-mono text-[11px] text-muted-foreground">
              <Cpu />
              CPU <span className="ml-1 text-foreground">{parsedHardwareSummary.cpu}</span>
            </Badge>
            <Badge variant="outline" className="font-mono text-[11px] text-muted-foreground">
              <MemoryStick />
              MEM <span className="ml-1 text-foreground">{parsedHardwareSummary.mem}</span>
            </Badge>
          </div>
        )
      ) : null}

      <FieldGroup className="gap-6">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field data-disabled={disabled}>
            <div className="flex items-center gap-2">
              <FieldLabel htmlFor="global-run-concurrency">
                {t("settings.system.advanced.globalRunConcurrency")}
              </FieldLabel>
              {infoButton(
                t("settings.system.advanced.globalRunConcurrencyHint"),
                `${t("common.info")}: ${t("settings.system.advanced.globalRunConcurrency")}`,
              )}
            </div>
            <div className="relative">
              <Input
                id="global-run-concurrency"
                value={props.globalRunConcurrency}
                onChange={(e) => props.setGlobalRunConcurrency(e.target.value)}
                placeholder={
                  props.recommendedGlobalRunConcurrency ? String(props.recommendedGlobalRunConcurrency) : "2"
                }
                inputMode="numeric"
                className={props.recommendedGlobalRunConcurrency ? "pr-28" : undefined}
                disabled={disabled}
              />
              {props.recommendedGlobalRunConcurrency ? (
                <Button
                  type="button"
                  size="sm"
                  variant="secondary"
                  disabled={!canApplyRecommended || disabled}
                  onClick={() =>
                    props.recommendedGlobalRunConcurrency &&
                    props.setGlobalRunConcurrency(String(props.recommendedGlobalRunConcurrency))
                  }
                  aria-label={t("settings.system.advanced.applyRecommendedAction")}
                  className="absolute right-1 top-1/2 h-7 -translate-y-1/2 px-2 text-xs"
                >
                  {t("settings.system.advanced.applyRecommendedAction")}
                </Button>
              ) : null}
            </div>
            {metaLine("globalRunConcurrency")}
          </Field>

          <Field data-disabled={disabled}>
            <div className="flex items-center gap-2">
              <FieldLabel htmlFor="per-run-step-concurrency">
                {t("settings.system.advanced.perRunStepConcurrency")}
              </FieldLabel>
              {infoButton(
                t("settings.system.advanced.perRunStepConcurrencyHint"),
                `${t("common.info")}: ${t("settings.system.advanced.perRunStepConcurrency")}`,
              )}
            </div>
            <Input
              id="per-run-step-concurrency"
              value={props.perRunStepConcurrency}
              onChange={(e) => props.setPerRunStepConcurrency(e.target.value)}
              placeholder="2"
              inputMode="numeric"
              disabled={disabled}
            />
            {metaLine("perRunStepConcurrency")}
          </Field>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <Field data-disabled={disabled}>
            <div className="flex items-center gap-2">
              <FieldLabel htmlFor="default-step-timeout">
                {t("settings.system.advanced.defaultStepTimeoutMs")}
              </FieldLabel>
              {infoButton(
                t("settings.system.advanced.defaultStepTimeoutMsHint"),
                `${t("common.info")}: ${t("settings.system.advanced.defaultStepTimeoutMs")}`,
              )}
            </div>
            <Input
              id="default-step-timeout"
              value={props.defaultStepTimeoutMs}
              onChange={(e) => props.setDefaultStepTimeoutMs(e.target.value)}
              placeholder="600000"
              inputMode="numeric"
              disabled={disabled}
            />
            {metaLine("defaultStepTimeoutMs")}
          </Field>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <Field data-disabled={disabled}>
            <div className="flex items-center gap-2">
              <FieldLabel htmlFor="input-download-concurrency">
                {t("settings.system.advanced.inputDownloadConcurrency")}
              </FieldLabel>
              {infoButton(
                t("settings.system.advanced.inputDownloadConcurrencyHint"),
                `${t("common.info")}: ${t("settings.system.advanced.inputDownloadConcurrency")}`,
              )}
            </div>
            <Input
              id="input-download-concurrency"
              value={props.inputDownloadConcurrency}
              onChange={(e) => props.setInputDownloadConcurrency(e.target.value)}
              placeholder="2"
              inputMode="numeric"
              disabled={disabled}
            />
            {metaLine("inputDownloadConcurrency")}
          </Field>
          <Field data-disabled={disabled}>
            <div className="flex items-center gap-2">
              <FieldLabel htmlFor="input-download-timeout">
                {t("settings.system.advanced.inputDownloadTimeoutMs")}
              </FieldLabel>
              {infoButton(
                t("settings.system.advanced.inputDownloadTimeoutMsHint"),
                `${t("common.info")}: ${t("settings.system.advanced.inputDownloadTimeoutMs")}`,
              )}
            </div>
            <Input
              id="input-download-timeout"
              value={props.inputDownloadTimeoutMs}
              onChange={(e) => props.setInputDownloadTimeoutMs(e.target.value)}
              placeholder="60000"
              inputMode="numeric"
              disabled={disabled}
            />
            {metaLine("inputDownloadTimeoutMs")}
          </Field>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <Field data-disabled={disabled}>
            <div className="flex items-center gap-2">
              <FieldLabel htmlFor="input-download-max-bytes">
                {t("settings.system.advanced.inputDownloadMaxBytes")}
              </FieldLabel>
              {infoButton(
                t("settings.system.advanced.inputDownloadMaxBytesHint"),
                `${t("common.info")}: ${t("settings.system.advanced.inputDownloadMaxBytes")}`,
              )}
            </div>
            <Input
              id="input-download-max-bytes"
              value={props.inputDownloadMaxBytes}
              onChange={(e) => props.setInputDownloadMaxBytes(e.target.value)}
              placeholder={String(50 * 1024 * 1024)}
              inputMode="numeric"
              disabled={disabled}
            />
            {metaLine("inputDownloadMaxBytes")}
          </Field>
        </div>
      </FieldGroup>

      <SettingsSectionFooter
        onReset={props.onReset}
        resetDisabled={!props.dirty || props.saving || props.loading || props.locked}
        resetLabel={t("common.resetAction")}
        onSave={props.onSave}
        saveDisabled={props.saving || props.loading || props.locked}
        saveLabel={t("common.saveAction")}
        saving={props.savingSection === "performance"}
        savingLabel={t("common.saving")}
      />
    </div>
  )
}
