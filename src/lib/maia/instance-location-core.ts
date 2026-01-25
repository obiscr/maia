import fs from "node:fs"
import path from "node:path"

export type MaiaInstanceConfig = {
  /**
   * Absolute or relative path for instance data directory.
   * - If relative: resolved from process.cwd()
   * - Supports "~" expansion
   */
  dataDir?: string
}

export function expandHome(p: string) {
  const s = String(p ?? "").trim()
  if (!s) return ""
  if (s === "~") return process.env.HOME ?? s
  if (s.startsWith("~/")) return path.join(process.env.HOME ?? "", s.slice(2))
  return s
}

export function isRunningInContainer(): boolean {
  // Explicit override for operators / tests.
  const forced = String(process.env.MAIA_IN_CONTAINER ?? "").trim()
  if (forced) return forced === "1" || forced.toLowerCase() === "true"

  // Env hints (k8s / generic).
  if (process.env.KUBERNETES_SERVICE_HOST) return true
  if (process.env.CONTAINER) return true

  // Heuristics (best-effort, sync-safe).
  try {
    if (fs.existsSync("/.dockerenv")) return true
  } catch {
    // ignore
  }

  try {
    const cgroup = fs.readFileSync("/proc/1/cgroup", "utf8")
    if (
      cgroup.includes("docker") ||
      cgroup.includes("containerd") ||
      cgroup.includes("kubepods") ||
      cgroup.includes("podman")
    ) {
      return true
    }
  } catch {
    // ignore
  }

  return false
}

export function defaultLocalDataDirSync(): string {
  const home = String(process.env.HOME ?? "").trim()
  const platform = process.platform

  // Windows: prefer LOCALAPPDATA (non-roaming), then APPDATA.
  if (platform === "win32") {
    const base = String(process.env.LOCALAPPDATA ?? process.env.APPDATA ?? "").trim()
    return path.join(base || home || process.cwd(), "maia-data")
  }

  // macOS: Application Support.
  if (platform === "darwin") {
    const base = home ? path.join(home, "Library", "Application Support") : process.cwd()
    return path.join(base, "maia-data")
  }

  // Linux/others: XDG data home.
  const xdg = String(process.env.XDG_DATA_HOME ?? "").trim()
  const base = xdg || (home ? path.join(home, ".local", "share") : process.cwd())
  return path.join(base, "maia-data")
}

export function resolveEnvDataDirSync(): string {
  const env = String(process.env.MAIA_DATA_DIR ?? "").trim()
  const expanded = expandHome(env)
  if (!expanded) return ""
  return path.isAbsolute(expanded) ? expanded : path.join(process.cwd(), expanded)
}

export function isDataDirControlledByEnvSync(): boolean {
  return Boolean(resolveEnvDataDirSync())
}

export function bootstrapDataDirSync(): string {
  // If env is set, config should live under that instance data dir.
  const envExpanded = resolveEnvDataDirSync()
  if (envExpanded) return envExpanded

  // Otherwise use the same defaults as the runtime would.
  if (isRunningInContainer()) return "/app/maia-data"
  return defaultLocalDataDirSync()
}

export function instanceConfigPathSync(): string {
  return path.join(bootstrapDataDirSync(), "settings", "instance.json")
}

export function readInstanceConfigFromDiskSync(): MaiaInstanceConfig {
  try {
    const raw = fs.readFileSync(instanceConfigPathSync(), "utf8")
    const parsed = JSON.parse(raw) as unknown
    if (!parsed || typeof parsed !== "object") return {}
    const obj = parsed as Record<string, unknown>
    return { dataDir: typeof obj.dataDir === "string" ? obj.dataDir : undefined }
  } catch {
    return {}
  }
}

export function resolveMaiaDataDirSync(): string {
  // Highest priority: explicit env (ops-controlled).
  const envExpanded = resolveEnvDataDirSync()
  if (envExpanded) return envExpanded

  // Next: config file (written by /setup wizard).
  const cfg = readInstanceConfigFromDiskSync()
  const v = typeof cfg.dataDir === "string" ? expandHome(cfg.dataDir) : ""
  if (v) return path.isAbsolute(v) ? v : path.join(process.cwd(), v)

  // Default:
  // - Container: fixed mount point inside image.
  // - Local: OS-standard user data directory.
  return bootstrapDataDirSync()
}

export function toSqliteDatabaseUrl(dataDir: string) {
  const dbPath = path.join(dataDir, "db.sqlite")
  return `file:${dbPath}`
}
