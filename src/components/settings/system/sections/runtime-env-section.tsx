"use client"

import { useI18n } from "@/components/i18n-provider"
import { ItemsList } from "@/components/common/items-list"
import { EnvOnlyHeader } from "@/components/settings/system/env-only-header"
import { EnvVarListItem, type EnvVarListItemModel } from "@/components/settings/system/env-var-list-item"
import { useSystemEnvVars } from "@/components/settings/system/hooks/use-system-env-vars"

export function RuntimeEnvSection() {
  const { t } = useI18n()
  const { vars } = useSystemEnvVars()

  const exportNames = [
    "RUNNER_TOKEN",
    "SETTINGS_ENCRYPTION_KEY",
    "MAIA_DATA_MOUNT_TYPE",
    "MAIA_HOST_DATA_DIR",
    "MAIA_DATA_DIR",
    "MAIA_RUNNER_MOUNT_MODE",
    "RUNNER_DEBUG_RETAIN_FAILED",
    "RUNNER_NOFILE",
    "RUNNER_DOCKER_API_VERSION",
    "RUNNER_DEFAULT_MOUNT_MODE",
    "SYSTEM_PERFORMANCE_LOCKED",
  ] as const

  return (
    <div className="space-y-4 pb-8">
      <EnvOnlyHeader
        exportNames={exportNames}
        sensitiveNames={["RUNNER_TOKEN", "SETTINGS_ENCRYPTION_KEY"]}
        vars={vars}
      />

      <div className="space-y-2">
        <div className="text-sm font-medium">{t("settings.system.runtime.runtimeTitle")}</div>
        <ItemsList<EnvVarListItemModel>
          items={[
            {
              name: "RUNNER_TOKEN",
              defaultValue: "",
              description: t("settings.system.runtime.runnerToken"),
              source: vars.RUNNER_TOKEN?.source,
              isSet: vars.RUNNER_TOKEN?.isSet,
            },
            {
              name: "SETTINGS_ENCRYPTION_KEY",
              defaultValue: "",
              description: t("settings.system.runtime.settingsEncryptionKey"),
              source: vars.SETTINGS_ENCRYPTION_KEY?.source,
              isSet: vars.SETTINGS_ENCRYPTION_KEY?.isSet,
            },
          ]}
          getKey={(it) => it.name}
          renderItem={(it) => <EnvVarListItem {...it} />}
        />
      </div>

      <div className="space-y-2">
        <div className="text-sm font-medium">{t("settings.system.runtime.storageTitle")}</div>
        <ItemsList<EnvVarListItemModel>
          items={[
            {
              name: "MAIA_DATA_MOUNT_TYPE",
              defaultValue: "volume",
              description: t("settings.system.runtime.maiaDataMountType"),
              source: vars.MAIA_DATA_MOUNT_TYPE?.source,
              effectiveValue: vars.MAIA_DATA_MOUNT_TYPE?.effectiveValue,
            },
            {
              name: "MAIA_HOST_DATA_DIR",
              defaultValue: "",
              description: t("settings.system.runtime.maiaHostDataDir"),
              source: vars.MAIA_HOST_DATA_DIR?.source,
              effectiveValue: vars.MAIA_HOST_DATA_DIR?.effectiveValue,
            },
            {
              name: "MAIA_DATA_DIR",
              defaultValue: "",
              description: t("settings.system.runtime.maiaDataDir"),
              source: vars.MAIA_DATA_DIR?.source,
              effectiveValue: vars.MAIA_DATA_DIR?.effectiveValue,
            },
            {
              name: "MAIA_RUNNER_MOUNT_MODE",
              defaultValue: "default",
              description: t("settings.system.runtime.maiaRunnerMountMode"),
              source: vars.MAIA_RUNNER_MOUNT_MODE?.source,
              effectiveValue: vars.MAIA_RUNNER_MOUNT_MODE?.effectiveValue,
            },
          ]}
          getKey={(it) => it.name}
          renderItem={(it) => <EnvVarListItem {...it} />}
        />
      </div>

      <div className="space-y-2">
        <div className="text-sm font-medium">{t("settings.system.runtime.runnerTitle")}</div>
        <ItemsList<EnvVarListItemModel>
          items={[
            {
              name: "RUNNER_DEBUG_RETAIN_FAILED",
              defaultValue: "0",
              description: t("settings.system.runtime.runnerDebugRetainFailed"),
              source: vars.RUNNER_DEBUG_RETAIN_FAILED?.source,
              effectiveValue: vars.RUNNER_DEBUG_RETAIN_FAILED?.effectiveValue,
            },
            {
              name: "RUNNER_NOFILE",
              defaultValue: "0",
              description: t("settings.system.runtime.runnerNofile"),
              source: vars.RUNNER_NOFILE?.source,
              effectiveValue: vars.RUNNER_NOFILE?.effectiveValue,
            },
            {
              name: "RUNNER_DOCKER_API_VERSION",
              defaultValue: "",
              description: t("settings.system.runtime.runnerDockerApiVersion"),
              source: vars.RUNNER_DOCKER_API_VERSION?.source,
              effectiveValue: vars.RUNNER_DOCKER_API_VERSION?.effectiveValue,
            },
            {
              name: "RUNNER_DEFAULT_MOUNT_MODE",
              defaultValue: "default",
              description: t("settings.system.runtime.runnerDefaultMountMode"),
              source: vars.RUNNER_DEFAULT_MOUNT_MODE?.source,
              effectiveValue: vars.RUNNER_DEFAULT_MOUNT_MODE?.effectiveValue,
            },
          ]}
          getKey={(it) => it.name}
          renderItem={(it) => <EnvVarListItem {...it} />}
        />
      </div>

      <div className="space-y-2">
        <div className="text-sm font-medium">{t("settings.system.runtime.performanceTitle")}</div>
        <ItemsList<EnvVarListItemModel>
          items={[
            {
              name: "SYSTEM_PERFORMANCE_LOCKED",
              defaultValue: "0",
              description: t("settings.system.runtime.systemPerformanceLocked"),
              source: vars.SYSTEM_PERFORMANCE_LOCKED?.source,
              effectiveValue: vars.SYSTEM_PERFORMANCE_LOCKED?.effectiveValue,
            },
          ]}
          getKey={(it) => it.name}
          renderItem={(it) => <EnvVarListItem {...it} />}
        />
      </div>
    </div>
  )
}
