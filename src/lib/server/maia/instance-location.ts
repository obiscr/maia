import "server-only"

export {
  bootstrapDataDirSync,
  expandHome,
  instanceConfigPathSync,
  isDataDirControlledByEnvSync,
  isRunningInContainer,
  readInstanceConfigFromDiskSync,
  resolveEnvDataDirSync,
  resolveMaiaDataDirSync,
  toSqliteDatabaseUrl,
  type MaiaInstanceConfig,
} from "@/lib/maia/instance-location-core"
