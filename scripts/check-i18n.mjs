import fs from "node:fs/promises"
import path from "node:path"

const root = process.cwd()
const srcRoot = path.join(root, "src")
const localesDir = path.join(root, "src", "lib", "shared", "i18n")

function isObject(x) {
  return x && typeof x === "object" && !Array.isArray(x)
}

function getByPath(obj, key) {
  const parts = key.split(".").filter(Boolean)
  let cur = obj
  for (const p of parts) {
    if (!isObject(cur)) return undefined
    cur = cur[p]
  }
  return typeof cur === "string" ? cur : undefined
}

function collectStringLeafKeys(obj, prefix = "") {
  const out = []
  if (!isObject(obj)) return out
  for (const [k, v] of Object.entries(obj)) {
    const p = prefix ? `${prefix}.${k}` : k
    if (typeof v === "string") out.push(p)
    else if (isObject(v)) out.push(...collectStringLeafKeys(v, p))
  }
  return out
}

async function collectUsedKeys() {
  const set = new Set()
  const issues = {
    nonLiteralKeyArgs: /** @type {{ file: string; arg: string }[]} */ ([]),
    dynamicKeyArgs: /** @type {{ file: string; arg: string }[]} */ ([]),
    allowedDynamicKeyArgs: /** @type {{ file: string; arg: string }[]} */ ([]),
    suspiciousNoDot: /** @type {{ file: string; key: string }[]} */ ([]),
  }
  const walk = async (dir) => {
    const ents = await fs.readdir(dir, { withFileTypes: true })
    for (const ent of ents) {
      const p = path.join(dir, ent.name)
      if (ent.isDirectory()) {
        if (ent.name === "node_modules" || ent.name === ".next") continue
        await walk(p)
        continue
      }
      if (!ent.isFile()) continue
      if (!/\.(ts|tsx)$/.test(ent.name)) continue
      const txt = await fs.readFile(p, "utf8").catch(() => "")
      if (!txt) continue

      const addKeyIfDotted = (key) => {
        // Heuristic: we only treat dotted strings as i18n keys.
        if (typeof key !== "string") return
        set.add(key.trim())
      }

      // 1) Direct usage: t("some.key")
      {
        const re = /\bt\(\s*("([^"]+)"|'([^']+)')\s*(?:,|\))/g
        let m
        while ((m = re.exec(txt))) {
          const key = m[2] ?? m[3]
          if (typeof key === "string" && key.includes(".")) addKeyIfDotted(key)
          else if (typeof key === "string") issues.suspiciousNoDot.push({ file: p, key })
        }
      }

      // 1b) Ternary with static keys: t(cond ? "a.key" : "b.key")
      {
        const re = /\bt\(\s*[^,\)]*?\?\s*("([^"]+)"|'([^']+)')\s*:\s*("([^"]+)"|'([^']+)')\s*(?:,|\))/g
        let m
        while ((m = re.exec(txt))) {
          const a = m[2] ?? m[3]
          const b = m[5] ?? m[6]
          if (typeof a === "string" && a.includes(".")) addKeyIfDotted(a)
          else if (typeof a === "string") issues.suspiciousNoDot.push({ file: p, key: a })
          if (typeof b === "string" && b.includes(".")) addKeyIfDotted(b)
          else if (typeof b === "string") issues.suspiciousNoDot.push({ file: p, key: b })
        }
      }

      // 2) Indirect usage via constants/props: titleKey: "some.key"
      // This catches patterns like:
      //   { titleKey: "setupWizard.steps.appearance.title" }
      //   const emptyStateKey = "home.emptyState"
      {
        const re = /\b[A-Za-z0-9_]*Key\b\s*(?::|=)\s*("([^"]+)"|'([^']+)')/g
        let m
        while ((m = re.exec(txt))) {
          const key = m[2] ?? m[3]
          // For `*Key` assignments, only treat dotted strings as i18n keys.
          if (typeof key === "string" && key.includes(".")) addKeyIfDotted(key)
        }
      }

      // 3) Style checks for key usage in `t(...)` calls:
      // - disallow template strings / string concatenation (hard to statically analyze)
      // - discourage passing arbitrary variables (allow `*Key` identifiers / property paths)
      {
        const re = /\bt\(\s*([^,\)]*)/g
        let m
        while ((m = re.exec(txt))) {
          const rawArg = String(m[1] ?? "").trim()
          if (!rawArg) continue

          // Static literal is fine (already handled above, but also validate no-dot here)
          if (rawArg.startsWith('"') || rawArg.startsWith("'")) continue

          // Allow ternary with literal keys (handled above)
          if (
            rawArg.includes("?") &&
            /(\?|\:)\s*("([^"]+)"|'([^']+)')/.test(rawArg) &&
            /\?\s*("([^"]+)"|'([^']+)')\s*:\s*("([^"]+)"|'([^']+)')/.test(rawArg)
          ) {
            continue
          }

          // Template literals or concatenation are considered "dynamic"
          if (rawArg.startsWith("`") || rawArg.includes("${") || rawArg.includes("+")) {
            const allowedDynamicPrefixes = [
              /^`errors\./,
              /^`schedules\.policies\.(misfireHint|overlapHint)\./,
              /^`settings\.system\.common\.sources\./,
              /^`workflows\.orchestrator\.examples\.(items|difficulty)\./,
            ]
            const isAllowed = allowedDynamicPrefixes.some((r) => r.test(rawArg))
            ;(isAllowed ? issues.allowedDynamicKeyArgs : issues.dynamicKeyArgs).push({ file: p, arg: rawArg })
            continue
          }

          // Allow passing variables/properties that explicitly look like i18n keys.
          // Convention: ...Key / ...i18nKey / ...messageKey / ...fallbackKey
          if (/\b(?:[A-Za-z0-9_]*Key|messageKey|fallbackKey|i18nKey)\b/.test(rawArg)) continue

          // Allow shared i18n helper patterns that intentionally accept arbitrary keys.
          if (p.includes(`${path.sep}lib${path.sep}shared${path.sep}i18n${path.sep}`)) continue

          issues.nonLiteralKeyArgs.push({ file: p, arg: rawArg })
        }
      }
    }
  }
  await walk(srcRoot)
  return { used: [...set].sort(), issues }
}

const { used, issues } = await collectUsedKeys()
const en = JSON.parse(await fs.readFile(path.join(localesDir, "en.json"), "utf8"))
const zh = JSON.parse(await fs.readFile(path.join(localesDir, "zh-cn.json"), "utf8"))

const missingEn = []
const missingZh = []
for (const k of used) {
  if (!getByPath(en, k)) missingEn.push(k)
  if (!getByPath(zh, k)) missingZh.push(k)
}

if (missingEn.length) {
  console.error(`[i18n] missing en: ${missingEn.length}`)
  console.error(missingEn.slice(0, 200).join("\n"))
}
if (missingZh.length) {
  console.error(`[i18n] missing zh-cn: ${missingZh.length}`)
  console.error(missingZh.slice(0, 200).join("\n"))
}

// Style diagnostics (non-fatal by default; pass --strict or set I18N_STRICT=1 to fail)
// Industry standard enforcement:
// - static keys preferred
// - allow controlled key passing via *Key / messageKey / fallbackKey / i18nKey
// - disallow dynamic key building (template strings / concatenation), even if "common" in project
const strict = true
if (issues.dynamicKeyArgs.length) {
  console.error(`[i18n] dynamic key expressions in t(...): ${issues.dynamicKeyArgs.length}`)
  console.error(
    issues.dynamicKeyArgs
      .slice(0, 100)
      .map((x) => `${x.file}\n  t(${x.arg} ...)`)
      .join("\n"),
  )
}
if (issues.allowedDynamicKeyArgs.length) {
  // Still considered non-compliant per enforced standard (no dynamic key building).
  console.error(`[i18n] dynamic key expressions (previously whitelisted): ${issues.allowedDynamicKeyArgs.length}`)
  console.error(
    issues.allowedDynamicKeyArgs
      .slice(0, 100)
      .map((x) => `${x.file}\n  t(${x.arg} ...)`)
      .join("\n"),
  )
}
if (issues.nonLiteralKeyArgs.length) {
  console.error(`[i18n] non-literal t(...) key args (not *Key): ${issues.nonLiteralKeyArgs.length}`)
  console.error(
    issues.nonLiteralKeyArgs
      .slice(0, 100)
      .map((x) => `${x.file}\n  t(${x.arg} ...)`)
      .join("\n"),
  )
}
if (issues.suspiciousNoDot.length) {
  console.error(`[i18n] suspicious keys without dot: ${issues.suspiciousNoDot.length}`)
  console.error(
    issues.suspiciousNoDot
      .slice(0, 100)
      .map((x) => `${x.file}\n  ${x.key}`)
      .join("\n"),
  )
}

// Also validate that locale files have the same set of string-leaf keys (parity).
const enAll = new Set(collectStringLeafKeys(en))
const zhAll = new Set(collectStringLeafKeys(zh))
const missingInZh = [...enAll].filter((k) => !zhAll.has(k)).sort()
const missingInEn = [...zhAll].filter((k) => !enAll.has(k)).sort()

if (missingInZh.length) {
  console.error(`[i18n] locale parity missing in zh-cn: ${missingInZh.length}`)
  console.error(missingInZh.slice(0, 200).join("\n"))
}
if (missingInEn.length) {
  console.error(`[i18n] locale parity missing in en: ${missingInEn.length}`)
  console.error(missingInEn.slice(0, 200).join("\n"))
}

const hardFail =
  missingEn.length ||
  missingZh.length ||
  missingInZh.length ||
  missingInEn.length ||
  (strict &&
    (issues.dynamicKeyArgs.length ||
      issues.nonLiteralKeyArgs.length ||
      issues.suspiciousNoDot.length ||
      issues.allowedDynamicKeyArgs.length))
process.exitCode = hardFail ? 2 : 0
