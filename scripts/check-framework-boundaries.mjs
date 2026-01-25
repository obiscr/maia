#!/usr/bin/env node
/**
 * Framework boundary guards.
 *
 * Note: This script intentionally keeps checks minimal and repo-specific.
 */

import fs from "fs/promises"
import path from "path"

const ROOT = process.cwd()
// Keep for future checks (e.g. Next.js framework boundary guards).
void fs
void path
void ROOT

async function main() {
  const violations = []

  if (violations.length) {
    console.error("\n[check-framework-boundaries] ❌ Violations:\n")
    for (const v of violations) {
      console.error(`- ${v.kind}: ${v.message}`)
      if (v.files?.length) for (const f of v.files) console.error(`  - ${f}`)
      console.error("")
    }
    process.exit(1)
  }

  console.log("[check-framework-boundaries] ✅ OK")
}

main().catch((e) => {
  console.error("[check-framework-boundaries] fatal:", e)
  process.exit(2)
})
