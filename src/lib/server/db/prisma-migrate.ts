import "server-only"

import { spawn } from "node:child_process"
import fs from "node:fs"
import path from "node:path"

import { isRunningInContainer } from "@/lib/server/maia/instance-location"

function hasLocalPrismaCli(): boolean {
  // In local/dev installs, Prisma CLI is a devDependency.
  // In production runtime image, it is intentionally absent.
  const bin = path.join(process.cwd(), "node_modules", ".bin")
  const candidates = [
    path.join(bin, "prisma"),
    path.join(bin, "prisma.cmd"),
    path.join(bin, "prisma.ps1"),
  ]
  try {
    return candidates.some((p) => fs.existsSync(p))
  } catch {
    return false
  }
}

async function run(cmd: string, args: string[]): Promise<{ ok: true } | { ok: false; exitCode: number | null }> {
  return await new Promise((resolve) => {
    const child = spawn(cmd, args, { stdio: "inherit", env: process.env })
    child.on("exit", (code) => resolve(code === 0 ? { ok: true } : { ok: false, exitCode: code }))
    child.on("error", () => resolve({ ok: false, exitCode: null }))
  })
}

export type PrismaMigrateDeployResult =
  | { ok: true }
  | { ok: false; code: "MIGRATOR_REQUIRED" | "PRISMA_MIGRATE_DEPLOY_FAILED"; meta?: Record<string, unknown> }

/**
 * Run `prisma migrate deploy` (production-safe flow).
 *
 * - In containers, migrations should be executed by the dedicated migrator/job (Mode B),
 *   so this intentionally returns MIGRATOR_REQUIRED.
 * - In local/dev, we allow running Prisma CLI if it's installed (devDependency).
 */
export async function prismaMigrateDeploy(): Promise<PrismaMigrateDeployResult> {
  if (isRunningInContainer()) return { ok: false, code: "MIGRATOR_REQUIRED" }

  if (!hasLocalPrismaCli()) return { ok: false, code: "MIGRATOR_REQUIRED" }

  // Use pnpm script to ensure the project-pinned Prisma version is used.
  const res = await run("pnpm", ["prisma:migrate"])
  if (!res.ok) return { ok: false, code: "PRISMA_MIGRATE_DEPLOY_FAILED", meta: { exitCode: res.exitCode } }
  return { ok: true }
}

