"use client"

import { useI18n } from "@/components/i18n-provider"
import { ItemsList } from "@/components/common/items-list"
import { EnvOnlyHeader } from "@/components/settings/system/env-only-header"
import { EnvVarListItem, type EnvVarListItemModel } from "@/components/settings/system/env-var-list-item"
import { useSystemEnvVars } from "@/components/settings/system/hooks/use-system-env-vars"

export function RetentionEnvSection() {
  const { t } = useI18n()
  const { vars } = useSystemEnvVars()

  const exportNames = [
    "OPS_CLEANUP_EVERY_MINUTES",
    "OPS_TTL_DAYS",
    "IDEMPOTENCY_TTL_DAYS",
    "OPS_RUNNING_MAX_AGE_DAYS",
    "OPS_OPERATION_HEARTBEAT_MS",
    "OPS_CLEANUP_ENGINE_TICK_MS",
  ] as const

  return (
    <div className="space-y-4 pb-8">
      <EnvOnlyHeader exportNames={exportNames} vars={vars} />

      <ItemsList<EnvVarListItemModel>
        items={[
          {
            name: "OPS_CLEANUP_EVERY_MINUTES",
            defaultValue: "60",
            description: t("settings.system.retention.opsCleanupEveryMinutes"),
            source: vars.OPS_CLEANUP_EVERY_MINUTES?.source,
            effectiveValue: vars.OPS_CLEANUP_EVERY_MINUTES?.effectiveValue,
          },
          {
            name: "OPS_TTL_DAYS",
            defaultValue: "30",
            description: t("settings.system.retention.opsTtlDays"),
            source: vars.OPS_TTL_DAYS?.source,
            effectiveValue: vars.OPS_TTL_DAYS?.effectiveValue,
          },
          {
            name: "IDEMPOTENCY_TTL_DAYS",
            defaultValue: "7",
            description: t("settings.system.retention.idempotencyTtlDays"),
            source: vars.IDEMPOTENCY_TTL_DAYS?.source,
            effectiveValue: vars.IDEMPOTENCY_TTL_DAYS?.effectiveValue,
          },
          {
            name: "OPS_RUNNING_MAX_AGE_DAYS",
            defaultValue: "2",
            description: t("settings.system.retention.opsRunningMaxAgeDays"),
            source: vars.OPS_RUNNING_MAX_AGE_DAYS?.source,
            effectiveValue: vars.OPS_RUNNING_MAX_AGE_DAYS?.effectiveValue,
          },
          {
            name: "OPS_OPERATION_HEARTBEAT_MS",
            defaultValue: "30000",
            description: t("settings.system.retention.opsOperationHeartbeatMs"),
            source: vars.OPS_OPERATION_HEARTBEAT_MS?.source,
            effectiveValue: vars.OPS_OPERATION_HEARTBEAT_MS?.effectiveValue,
          },
          {
            name: "OPS_CLEANUP_ENGINE_TICK_MS",
            defaultValue: "30000",
            description: t("settings.system.retention.opsCleanupEngineTickMs"),
            source: vars.OPS_CLEANUP_ENGINE_TICK_MS?.source,
            effectiveValue: vars.OPS_CLEANUP_ENGINE_TICK_MS?.effectiveValue,
          },
        ]}
        getKey={(it) => it.name}
        renderItem={(it) => <EnvVarListItem {...it} />}
      />
    </div>
  )
}
