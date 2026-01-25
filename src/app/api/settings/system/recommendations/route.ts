import os from "node:os"
import fs from "node:fs"

import { getAuthedUserFromRequest } from "@/lib/server/auth/session"
import { fail, ok } from "@/lib/server/http/response"
import { withApiObservability } from "@/lib/server/observability"

export const runtime = "nodejs"

type OsWithAvailableParallelism = typeof os & { availableParallelism?: () => number }

function getAvailableParallelism() {
  const maybe = (os as unknown as OsWithAvailableParallelism).availableParallelism
  return typeof maybe === "function" ? Number(maybe()) : os.cpus().length
}

function readCgroupV2MemoryMaxBytes(): number | null {
  try {
    const raw = fs.readFileSync("/sys/fs/cgroup/memory.max", "utf8").trim()
    if (!raw || raw === "max") return null
    const n = Number(raw)
    return Number.isFinite(n) && n > 0 ? n : null
  } catch {
    return null
  }
}

function readCgroupV2CpuQuotaCores(): number | null {
  try {
    const raw = fs.readFileSync("/sys/fs/cgroup/cpu.max", "utf8").trim()
    // format: "<quota> <period>" or "max <period>"
    const [quotaRaw, periodRaw] = raw.split(/\s+/)
    if (!quotaRaw || !periodRaw || quotaRaw === "max") return null
    const quota = Number(quotaRaw)
    const period = Number(periodRaw)
    if (!Number.isFinite(quota) || !Number.isFinite(period) || quota <= 0 || period <= 0) return null
    const cores = quota / period
    return cores > 0 ? cores : null
  } catch {
    return null
  }
}

function recommendedGlobalRunConcurrency(params: { cpu: number; memGiB: number }) {
  const cpu = Math.max(1, Math.floor(params.cpu))
  const memGiB = Number.isFinite(params.memGiB) ? params.memGiB : 0

  // CPU-based baseline (conservative).
  let base = cpu <= 2 ? 1 : cpu <= 4 ? 2 : cpu <= 8 ? 4 : Math.floor(cpu * 0.5)

  // Memory guardrails (very rough).
  if (memGiB > 0 && memGiB < 2) base = Math.min(base, 1)
  else if (memGiB > 0 && memGiB < 4) base = Math.min(base, 2)
  else if (memGiB > 0 && memGiB < 8) base = Math.min(base, 3)

  // Hard cap to avoid surprising overload.
  base = Math.max(1, Math.min(base, 8))
  return base
}

export const GET = withApiObservability(async (req: Request) => {
  const user = await getAuthedUserFromRequest(req).catch(() => null)
  if (!user) return fail({ status: 401, code: "UNAUTHORIZED" })
  if (String(user.role) !== "ADMIN") return fail({ status: 403, code: "FORBIDDEN" })

  const cpuAvail = getAvailableParallelism()
  const cgroupCpu = readCgroupV2CpuQuotaCores()
  const cpu = Math.max(1, Math.floor(Number.isFinite(cgroupCpu ?? NaN) ? (cgroupCpu as number) : cpuAvail))

  const memBytes = readCgroupV2MemoryMaxBytes() ?? os.totalmem()
  const memGiB = memBytes / 1024 ** 3

  const recommended = {
    globalRunConcurrency: recommendedGlobalRunConcurrency({ cpu, memGiB }),
  }

  return ok({
    hardware: { cpu, memGiB: Number(memGiB.toFixed(2)) },
    recommended,
  })
})
