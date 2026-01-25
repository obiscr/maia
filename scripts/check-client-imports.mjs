#!/usr/bin/env node
/**
 * Guard: client components must not import server-only modules.
 *
 * This script scans `src/**` for files that contain the `"use client"` directive,
 * then builds a local dependency graph (imports + re-exports) and fails if any
 * reachable module contains `import "server-only";`.
 *
 * Notes:
 * - We ignore `import type ...` and `export type ... from ...` (type-only).
 * - We only resolve local modules (relative, `@/*`, `@content/*`).
 */

import fs from "fs/promises"
import path from "path"
import ts from "typescript"

const ROOT = process.cwd()
const SRC = path.join(ROOT, "src")

const EXT_CANDIDATES = [".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs"]

function isLocalSpecifier(spec) {
  return spec.startsWith("./") || spec.startsWith("../") || spec.startsWith("@/") || spec.startsWith("@content/")
}

async function pathExists(p) {
  try {
    await fs.stat(p)
    return true
  } catch {
    return false
  }
}

async function resolveModule(spec, fromFile) {
  let base
  if (spec.startsWith("@/")) {
    base = path.join(SRC, spec.slice(2))
  } else if (spec.startsWith("@content/")) {
    base = path.join(SRC, "components", "content", spec.slice("@content/".length))
  } else {
    base = path.resolve(path.dirname(fromFile), spec)
  }

  // Exact path
  if (await pathExists(base)) return base

  // With extension
  for (const ext of EXT_CANDIDATES) {
    const p = base + ext
    if (await pathExists(p)) return p
  }

  // Directory index
  for (const ext of EXT_CANDIDATES) {
    const p = path.join(base, "index" + ext)
    if (await pathExists(p)) return p
  }

  return null
}

function isUseClientFile(text) {
  // directive should be near the top; scan first 20 lines to be safe
  const head = text.split("\n").slice(0, 20).join("\n")
  return /["']use client["']\s*;/.test(head)
}

function isServerOnlyFile(text) {
  // allow it anywhere, but convention is top-of-file
  return /import\s+["']server-only["']\s*;/.test(text)
}

function getScriptKind(filePath) {
  const ext = path.extname(filePath).toLowerCase()
  if (ext === ".tsx") return ts.ScriptKind.TSX
  if (ext === ".ts") return ts.ScriptKind.TS
  if (ext === ".jsx") return ts.ScriptKind.JSX
  if (ext === ".js") return ts.ScriptKind.JS
  if (ext === ".mjs") return ts.ScriptKind.JS
  if (ext === ".cjs") return ts.ScriptKind.JS
  return ts.ScriptKind.Unknown
}

function parseSpecifiers(text, filePath) {
  /**
   * Use TS AST to avoid false positives:
   * - Ignore `import type ...`
   * - Ignore `import { type X } from "..."` and `export { type X } from "..."`
   * - Keep mixed imports like `import { foo, type Bar } from "..."`
   */
  const sf = ts.createSourceFile(
    filePath,
    text,
    ts.ScriptTarget.Latest,
    /*setParentNodes*/ true,
    getScriptKind(filePath),
  )

  const specs = []

  function pushModuleSpecifier(mod) {
    if (mod && ts.isStringLiteral(mod)) specs.push(mod.text)
  }

  function isTypeOnlyNamedImports(namedBindings) {
    if (!namedBindings) return false
    if (!ts.isNamedImports(namedBindings)) return false
    // If all specifiers are type-only (and there's no default import), treat as type-only overall.
    return namedBindings.elements.length > 0 && namedBindings.elements.every((e) => e.isTypeOnly)
  }

  function isTypeOnlyNamedExports(exportClause) {
    if (!exportClause) return false
    if (!ts.isNamedExports(exportClause)) return false
    return exportClause.elements.length > 0 && exportClause.elements.every((e) => e.isTypeOnly)
  }

  function visit(node) {
    if (ts.isImportDeclaration(node)) {
      const clause = node.importClause
      if (clause?.isTypeOnly) return

      // `import { type X } from "..."` should not count as a runtime dep.
      if (clause && !clause.name && isTypeOnlyNamedImports(clause.namedBindings)) return

      // Side-effect import `import "x";` counts as runtime dep.
      pushModuleSpecifier(node.moduleSpecifier)
      return
    }

    if (ts.isExportDeclaration(node)) {
      if (node.isTypeOnly) return

      // `export { type X } from "..."` should not count as a runtime dep.
      if (node.exportClause && isTypeOnlyNamedExports(node.exportClause)) return

      if (node.moduleSpecifier) pushModuleSpecifier(node.moduleSpecifier)
      return
    }

    ts.forEachChild(node, visit)
  }

  visit(sf)
  return specs
}

async function walk(dir) {
  const out = []
  const entries = await fs.readdir(dir, { withFileTypes: true })
  for (const e of entries) {
    if (e.name.startsWith(".")) continue
    const p = path.join(dir, e.name)
    if (e.isDirectory()) {
      // Skip build output directories if they exist under src (usually not)
      if (e.name === "node_modules") continue
      out.push(...(await walk(p)))
    } else {
      if (!EXT_CANDIDATES.some((ext) => e.name.endsWith(ext))) continue
      out.push(p)
    }
  }
  return out
}

const fileTextCache = new Map()
async function readTextCached(p) {
  const key = path.normalize(p)
  if (fileTextCache.has(key)) return fileTextCache.get(key)
  const txt = await fs.readFile(key, "utf8")
  fileTextCache.set(key, txt)
  return txt
}

const depsCache = new Map()
async function getDeps(p) {
  const key = path.normalize(p)
  if (depsCache.has(key)) return depsCache.get(key)
  const txt = await readTextCached(key)
  const specs = parseSpecifiers(txt, key).filter(isLocalSpecifier)
  const resolved = []
  for (const s of specs) {
    const r = await resolveModule(s, key)
    if (r) resolved.push(r)
  }
  depsCache.set(key, resolved)
  return resolved
}

async function main() {
  const files = await walk(SRC)
  const clientFiles = []
  for (const f of files) {
    const txt = await readTextCached(f)
    if (isUseClientFile(txt)) clientFiles.push(f)
  }

  const serverOnlyMemo = new Map()
  async function isServerOnlyPath(p) {
    const key = path.normalize(p)
    if (serverOnlyMemo.has(key)) return serverOnlyMemo.get(key)
    const txt = await readTextCached(key)
    const yes = isServerOnlyFile(txt)
    serverOnlyMemo.set(key, yes)
    return yes
  }

  const violations = []

  for (const entry of clientFiles) {
    const queue = [entry]
    const seen = new Set()
    const parent = new Map() // child -> parent for path reconstruction

    while (queue.length) {
      const cur = queue.shift()
      const norm = path.normalize(cur)
      if (seen.has(norm)) continue
      seen.add(norm)

      if (cur !== entry && (await isServerOnlyPath(cur))) {
        // reconstruct a chain entry -> ... -> cur
        const chain = [cur]
        let p = cur
        while (parent.has(p)) {
          p = parent.get(p)
          chain.push(p)
          if (p === entry) break
        }
        chain.reverse()
        violations.push({ entry, serverOnly: cur, chain })
        break
      }

      const deps = await getDeps(cur)
      for (const d of deps) {
        if (!seen.has(path.normalize(d))) parent.set(d, cur)
        queue.push(d)
      }
    }
  }

  if (violations.length) {
    console.error("\n[check-client-imports] ❌ Client files import server-only modules:\n")
    for (const v of violations) {
      console.error(`- Client: ${path.relative(ROOT, v.entry)}`)
      console.error(`  Reaches server-only: ${path.relative(ROOT, v.serverOnly)}`)
      console.error("  Chain:")
      for (const c of v.chain) console.error(`    - ${path.relative(ROOT, c)}`)
      console.error("")
    }
    console.error("Fix: move the import behind an API route/server action, or refactor into a shared module.\n")
    process.exit(1)
  }

  console.log(`[check-client-imports] ✅ OK (${clientFiles.length} client files scanned)`)
}

main().catch((e) => {
  console.error("[check-client-imports] fatal:", e)
  process.exit(2)
})
