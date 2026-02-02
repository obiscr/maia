"use client"

import { useI18n } from "@/components/i18n-provider"
import { ItemsList } from "@/components/common/items-list"
import { EnvOnlyHeader } from "@/components/settings/system/env-only-header"
import { EnvVarListItem, type EnvVarListItemModel } from "@/components/settings/system/env-var-list-item"
import { useSystemEnvVars } from "@/components/settings/system/hooks/use-system-env-vars"

export function SecurityEnvSection() {
  const { t } = useI18n()
  const { vars } = useSystemEnvVars()

  const exportNames = [
    // Runtime / storage / runner
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

    "SETUP_REPAIR_TOKEN",
    "RATE_LIMIT_MAX_BUCKETS",
    "RATE_LIMIT_PRUNE_EVERY_MS",
    "AUTH_RATE_LIMIT_SIGNIN_WINDOW_MS",
    "AUTH_RATE_LIMIT_SIGNIN_PER_IP",
    "AUTH_RATE_LIMIT_SIGNIN_PER_IP_EMAIL",
    "AUTH_RATE_LIMIT_SIGNUP_WINDOW_MS",
    "AUTH_RATE_LIMIT_SIGNUP_PER_IP",
    "AUTH_RATE_LIMIT_PASSWORD_FORGOT_WINDOW_MS",
    "AUTH_RATE_LIMIT_PASSWORD_FORGOT_PER_IP",
    "AUTH_RATE_LIMIT_PASSWORD_FORGOT_PER_IP_EMAIL",
    "AUTH_RATE_LIMIT_MAGIC_LINK_REQUEST_WINDOW_MS",
    "AUTH_RATE_LIMIT_MAGIC_LINK_REQUEST_PER_IP",
    "AUTH_RATE_LIMIT_MAGIC_LINK_REQUEST_PER_IP_EMAIL",
    "AUTH_RATE_LIMIT_EMAIL_OTP_REQUEST_WINDOW_MS",
    "AUTH_RATE_LIMIT_EMAIL_OTP_REQUEST_PER_IP",
    "AUTH_RATE_LIMIT_EMAIL_OTP_REQUEST_PER_IP_EMAIL",
    "AUTH_RATE_LIMIT_EMAIL_OTP_VERIFY_WINDOW_MS",
    "AUTH_RATE_LIMIT_EMAIL_OTP_VERIFY_PER_IP",
    "AUTH_RATE_LIMIT_EMAIL_OTP_VERIFY_PER_IP_EMAIL",
    "AUTH_RATE_LIMIT_CHALLENGE_WINDOW_MS",
    "AUTH_RATE_LIMIT_CHALLENGE_PER_IP",
    "AUTH_RATE_LIMIT_SETUP_WINDOW_MS",
    "AUTH_RATE_LIMIT_SETUP_PER_IP",
    "AUTH_PASSWORD_SCRYPT_N_LOG2",
    "AUTH_PASSWORD_SCRYPT_R",
    "AUTH_PASSWORD_SCRYPT_P",
    "AUTH_PASSWORD_SCRYPT_MAXMEM_MB",
  ] as const

  return (
    <div className="space-y-4 pb-8">
      <EnvOnlyHeader
        exportNames={exportNames}
        sensitiveNames={["SETUP_REPAIR_TOKEN", "RUNNER_TOKEN", "SETTINGS_ENCRYPTION_KEY"]}
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

      <div className="space-y-2">
        <div className="text-sm font-medium">{t("settings.system.security.recoveryTitle")}</div>
        <ItemsList<EnvVarListItemModel>
          items={[
            {
              name: "SETUP_REPAIR_TOKEN",
              defaultValue: "",
              description: t("settings.system.security.setupRepairToken"),
              source: vars.SETUP_REPAIR_TOKEN?.source,
              isSet: vars.SETUP_REPAIR_TOKEN?.isSet,
            },
          ]}
          getKey={(it) => it.name}
          renderItem={(it) => <EnvVarListItem {...it} />}
        />
      </div>

      <div className="space-y-2">
        <div className="text-sm font-medium">{t("settings.system.security.rateLimitTitle")}</div>
        <ItemsList<EnvVarListItemModel>
          items={[
            {
              name: "RATE_LIMIT_MAX_BUCKETS",
              defaultValue: "5000",
              description: t("settings.system.security.rateLimitMaxBuckets"),
              source: vars.RATE_LIMIT_MAX_BUCKETS?.source,
              effectiveValue: vars.RATE_LIMIT_MAX_BUCKETS?.effectiveValue,
            },
            {
              name: "RATE_LIMIT_PRUNE_EVERY_MS",
              defaultValue: "10000",
              description: t("settings.system.security.rateLimitPruneEveryMs"),
              source: vars.RATE_LIMIT_PRUNE_EVERY_MS?.source,
              effectiveValue: vars.RATE_LIMIT_PRUNE_EVERY_MS?.effectiveValue,
            },
            {
              name: "AUTH_RATE_LIMIT_SIGNIN_WINDOW_MS",
              defaultValue: "60000",
              description: t("settings.system.security.authRateLimitSigninWindowMs"),
              source: vars.AUTH_RATE_LIMIT_SIGNIN_WINDOW_MS?.source,
              effectiveValue: vars.AUTH_RATE_LIMIT_SIGNIN_WINDOW_MS?.effectiveValue,
            },
            {
              name: "AUTH_RATE_LIMIT_SIGNIN_PER_IP",
              defaultValue: "30",
              description: t("settings.system.security.authRateLimitSigninPerIp"),
              source: vars.AUTH_RATE_LIMIT_SIGNIN_PER_IP?.source,
              effectiveValue: vars.AUTH_RATE_LIMIT_SIGNIN_PER_IP?.effectiveValue,
            },
            {
              name: "AUTH_RATE_LIMIT_SIGNIN_PER_IP_EMAIL",
              defaultValue: "10",
              description: t("settings.system.security.authRateLimitSigninPerIpEmail"),
              source: vars.AUTH_RATE_LIMIT_SIGNIN_PER_IP_EMAIL?.source,
              effectiveValue: vars.AUTH_RATE_LIMIT_SIGNIN_PER_IP_EMAIL?.effectiveValue,
            },
            {
              name: "AUTH_RATE_LIMIT_SIGNUP_WINDOW_MS",
              defaultValue: "60000",
              description: t("settings.system.security.authRateLimitSignupWindowMs"),
              source: vars.AUTH_RATE_LIMIT_SIGNUP_WINDOW_MS?.source,
              effectiveValue: vars.AUTH_RATE_LIMIT_SIGNUP_WINDOW_MS?.effectiveValue,
            },
            {
              name: "AUTH_RATE_LIMIT_SIGNUP_PER_IP",
              defaultValue: "10",
              description: t("settings.system.security.authRateLimitSignupPerIp"),
              source: vars.AUTH_RATE_LIMIT_SIGNUP_PER_IP?.source,
              effectiveValue: vars.AUTH_RATE_LIMIT_SIGNUP_PER_IP?.effectiveValue,
            },
            {
              name: "AUTH_RATE_LIMIT_PASSWORD_FORGOT_WINDOW_MS",
              defaultValue: "60000",
              description: t("settings.system.security.authRateLimitPasswordForgotWindowMs"),
              source: vars.AUTH_RATE_LIMIT_PASSWORD_FORGOT_WINDOW_MS?.source,
              effectiveValue: vars.AUTH_RATE_LIMIT_PASSWORD_FORGOT_WINDOW_MS?.effectiveValue,
            },
            {
              name: "AUTH_RATE_LIMIT_PASSWORD_FORGOT_PER_IP",
              defaultValue: "10",
              description: t("settings.system.security.authRateLimitPasswordForgotPerIp"),
              source: vars.AUTH_RATE_LIMIT_PASSWORD_FORGOT_PER_IP?.source,
              effectiveValue: vars.AUTH_RATE_LIMIT_PASSWORD_FORGOT_PER_IP?.effectiveValue,
            },
            {
              name: "AUTH_RATE_LIMIT_PASSWORD_FORGOT_PER_IP_EMAIL",
              defaultValue: "5",
              description: t("settings.system.security.authRateLimitPasswordForgotPerIpEmail"),
              source: vars.AUTH_RATE_LIMIT_PASSWORD_FORGOT_PER_IP_EMAIL?.source,
              effectiveValue: vars.AUTH_RATE_LIMIT_PASSWORD_FORGOT_PER_IP_EMAIL?.effectiveValue,
            },
            {
              name: "AUTH_RATE_LIMIT_MAGIC_LINK_REQUEST_WINDOW_MS",
              defaultValue: "60000",
              description: t("settings.system.security.authRateLimitMagicLinkRequestWindowMs"),
              source: vars.AUTH_RATE_LIMIT_MAGIC_LINK_REQUEST_WINDOW_MS?.source,
              effectiveValue: vars.AUTH_RATE_LIMIT_MAGIC_LINK_REQUEST_WINDOW_MS?.effectiveValue,
            },
            {
              name: "AUTH_RATE_LIMIT_MAGIC_LINK_REQUEST_PER_IP",
              defaultValue: "10",
              description: t("settings.system.security.authRateLimitMagicLinkRequestPerIp"),
              source: vars.AUTH_RATE_LIMIT_MAGIC_LINK_REQUEST_PER_IP?.source,
              effectiveValue: vars.AUTH_RATE_LIMIT_MAGIC_LINK_REQUEST_PER_IP?.effectiveValue,
            },
            {
              name: "AUTH_RATE_LIMIT_MAGIC_LINK_REQUEST_PER_IP_EMAIL",
              defaultValue: "5",
              description: t("settings.system.security.authRateLimitMagicLinkRequestPerIpEmail"),
              source: vars.AUTH_RATE_LIMIT_MAGIC_LINK_REQUEST_PER_IP_EMAIL?.source,
              effectiveValue: vars.AUTH_RATE_LIMIT_MAGIC_LINK_REQUEST_PER_IP_EMAIL?.effectiveValue,
            },
            {
              name: "AUTH_RATE_LIMIT_EMAIL_OTP_REQUEST_WINDOW_MS",
              defaultValue: "60000",
              description: t("settings.system.security.authRateLimitEmailOtpRequestWindowMs"),
              source: vars.AUTH_RATE_LIMIT_EMAIL_OTP_REQUEST_WINDOW_MS?.source,
              effectiveValue: vars.AUTH_RATE_LIMIT_EMAIL_OTP_REQUEST_WINDOW_MS?.effectiveValue,
            },
            {
              name: "AUTH_RATE_LIMIT_EMAIL_OTP_REQUEST_PER_IP",
              defaultValue: "10",
              description: t("settings.system.security.authRateLimitEmailOtpRequestPerIp"),
              source: vars.AUTH_RATE_LIMIT_EMAIL_OTP_REQUEST_PER_IP?.source,
              effectiveValue: vars.AUTH_RATE_LIMIT_EMAIL_OTP_REQUEST_PER_IP?.effectiveValue,
            },
            {
              name: "AUTH_RATE_LIMIT_EMAIL_OTP_REQUEST_PER_IP_EMAIL",
              defaultValue: "5",
              description: t("settings.system.security.authRateLimitEmailOtpRequestPerIpEmail"),
              source: vars.AUTH_RATE_LIMIT_EMAIL_OTP_REQUEST_PER_IP_EMAIL?.source,
              effectiveValue: vars.AUTH_RATE_LIMIT_EMAIL_OTP_REQUEST_PER_IP_EMAIL?.effectiveValue,
            },
            {
              name: "AUTH_RATE_LIMIT_EMAIL_OTP_VERIFY_WINDOW_MS",
              defaultValue: "60000",
              description: t("settings.system.security.authRateLimitEmailOtpVerifyWindowMs"),
              source: vars.AUTH_RATE_LIMIT_EMAIL_OTP_VERIFY_WINDOW_MS?.source,
              effectiveValue: vars.AUTH_RATE_LIMIT_EMAIL_OTP_VERIFY_WINDOW_MS?.effectiveValue,
            },
            {
              name: "AUTH_RATE_LIMIT_EMAIL_OTP_VERIFY_PER_IP",
              defaultValue: "30",
              description: t("settings.system.security.authRateLimitEmailOtpVerifyPerIp"),
              source: vars.AUTH_RATE_LIMIT_EMAIL_OTP_VERIFY_PER_IP?.source,
              effectiveValue: vars.AUTH_RATE_LIMIT_EMAIL_OTP_VERIFY_PER_IP?.effectiveValue,
            },
            {
              name: "AUTH_RATE_LIMIT_EMAIL_OTP_VERIFY_PER_IP_EMAIL",
              defaultValue: "10",
              description: t("settings.system.security.authRateLimitEmailOtpVerifyPerIpEmail"),
              source: vars.AUTH_RATE_LIMIT_EMAIL_OTP_VERIFY_PER_IP_EMAIL?.source,
              effectiveValue: vars.AUTH_RATE_LIMIT_EMAIL_OTP_VERIFY_PER_IP_EMAIL?.effectiveValue,
            },
            {
              name: "AUTH_RATE_LIMIT_CHALLENGE_WINDOW_MS",
              defaultValue: "60000",
              description: t("settings.system.security.authRateLimitChallengeWindowMs"),
              source: vars.AUTH_RATE_LIMIT_CHALLENGE_WINDOW_MS?.source,
              effectiveValue: vars.AUTH_RATE_LIMIT_CHALLENGE_WINDOW_MS?.effectiveValue,
            },
            {
              name: "AUTH_RATE_LIMIT_CHALLENGE_PER_IP",
              defaultValue: "30",
              description: t("settings.system.security.authRateLimitChallengePerIp"),
              source: vars.AUTH_RATE_LIMIT_CHALLENGE_PER_IP?.source,
              effectiveValue: vars.AUTH_RATE_LIMIT_CHALLENGE_PER_IP?.effectiveValue,
            },
            {
              name: "AUTH_RATE_LIMIT_SETUP_WINDOW_MS",
              defaultValue: "3600000",
              description: t("settings.system.security.authRateLimitSetupWindowMs"),
              source: vars.AUTH_RATE_LIMIT_SETUP_WINDOW_MS?.source,
              effectiveValue: vars.AUTH_RATE_LIMIT_SETUP_WINDOW_MS?.effectiveValue,
            },
            {
              name: "AUTH_RATE_LIMIT_SETUP_PER_IP",
              defaultValue: "10",
              description: t("settings.system.security.authRateLimitSetupPerIp"),
              source: vars.AUTH_RATE_LIMIT_SETUP_PER_IP?.source,
              effectiveValue: vars.AUTH_RATE_LIMIT_SETUP_PER_IP?.effectiveValue,
            },
          ]}
          getKey={(it) => it.name}
          renderItem={(it) => <EnvVarListItem {...it} />}
        />
      </div>

      <div className="space-y-2">
        <div className="text-sm font-medium">{t("settings.system.security.passwordHashTitle")}</div>
        <ItemsList<EnvVarListItemModel>
          items={[
            {
              name: "AUTH_PASSWORD_SCRYPT_N_LOG2",
              defaultValue: "14",
              description: t("settings.system.security.authPasswordScryptNLog2"),
              source: vars.AUTH_PASSWORD_SCRYPT_N_LOG2?.source,
              effectiveValue: vars.AUTH_PASSWORD_SCRYPT_N_LOG2?.effectiveValue,
            },
            {
              name: "AUTH_PASSWORD_SCRYPT_R",
              defaultValue: "8",
              description: t("settings.system.security.authPasswordScryptR"),
              source: vars.AUTH_PASSWORD_SCRYPT_R?.source,
              effectiveValue: vars.AUTH_PASSWORD_SCRYPT_R?.effectiveValue,
            },
            {
              name: "AUTH_PASSWORD_SCRYPT_P",
              defaultValue: "1",
              description: t("settings.system.security.authPasswordScryptP"),
              source: vars.AUTH_PASSWORD_SCRYPT_P?.source,
              effectiveValue: vars.AUTH_PASSWORD_SCRYPT_P?.effectiveValue,
            },
            {
              name: "AUTH_PASSWORD_SCRYPT_MAXMEM_MB",
              defaultValue: "128",
              description: t("settings.system.security.authPasswordScryptMaxmemMb"),
              source: vars.AUTH_PASSWORD_SCRYPT_MAXMEM_MB?.source,
              effectiveValue: vars.AUTH_PASSWORD_SCRYPT_MAXMEM_MB?.effectiveValue,
            },
          ]}
          getKey={(it) => it.name}
          renderItem={(it) => <EnvVarListItem {...it} />}
        />
      </div>
    </div>
  )
}
