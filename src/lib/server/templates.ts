import path from "node:path"
import { readdir, readFile, stat } from "node:fs/promises"

import { workflowExportV1Schema, type WorkflowExportV1 } from "@/lib/shared/workflow-import-export"
import type { Locale } from "@/lib/shared/i18n/constants"

export type WorkflowTemplateMeta = {
  /** Filename without extension (may contain non-ascii chars). */
  id: string
  fileName: string
  name: string
  description: string | null
  stepCount: number
  depsCount: number
}

function templatesDir() {
  return path.join(process.cwd(), "templates")
}

async function dirExists(absPath: string): Promise<boolean> {
  try {
    const s = await stat(absPath)
    return s.isDirectory()
  } catch {
    return false
  }
}

async function resolveTemplatesDirForLocale(locale?: Locale): Promise<string> {
  const root = templatesDir()
  if (!locale) return root
  const localized = path.join(root, locale)
  if (await dirExists(localized)) return localized
  return root
}

function safeTemplateId(id: string) {
  const raw = String(id ?? "").trim()
  if (!raw) return null
  // Prevent path traversal. We allow unicode filenames, but disallow any path separators.
  if (raw.includes("/") || raw.includes("\\") || raw.includes("..")) return null
  if (path.basename(raw) !== raw) return null
  return raw
}

export async function listWorkflowTemplates(locale?: Locale): Promise<WorkflowTemplateMeta[]> {
  const dir = await resolveTemplatesDirForLocale(locale)
  let entries: string[]
  try {
    entries = await readdir(dir)
  } catch {
    return []
  }

  const files = entries.filter((n) => n.toLowerCase().endsWith(".json")).sort((a, b) => a.localeCompare(b))
  const out: WorkflowTemplateMeta[] = []
  for (const fileName of files) {
    const id = fileName.replace(/\.json$/i, "")
    const safeId = safeTemplateId(id)
    if (!safeId) continue
    try {
      const raw = await readFile(path.join(dir, fileName), "utf8")
      const parsed = workflowExportV1Schema.safeParse(JSON.parse(raw))
      if (!parsed.success) continue
      const exp = parsed.data
      out.push(toMeta(fileName, exp))
    } catch {
      // Ignore invalid template files.
      continue
    }
  }
  return out
}

export async function getWorkflowTemplateExport(templateId: string, locale?: Locale): Promise<WorkflowExportV1 | null> {
  const id = safeTemplateId(templateId)
  if (!id) return null
  const fileName = `${id}.json`
  const root = templatesDir()
  const preferredDir = await resolveTemplatesDirForLocale(locale)
  const candidates =
    preferredDir === root ? [path.join(root, fileName)] : [path.join(preferredDir, fileName), path.join(root, fileName)]

  for (const fullPath of candidates) {
    try {
      const raw = await readFile(fullPath, "utf8")
      const parsed = workflowExportV1Schema.safeParse(JSON.parse(raw))
      if (!parsed.success) return null
      return parsed.data
    } catch {
      // Try next candidate
      continue
    }
  }

  return null
}

function toMeta(fileName: string, exp: WorkflowExportV1): WorkflowTemplateMeta {
  const depsCount = Object.keys(exp.data.dependencies ?? {}).length
  const stepCount = Array.isArray(exp.data.steps) ? exp.data.steps.length : 0
  return {
    id: fileName.replace(/\.json$/i, ""),
    fileName,
    name: exp.data.meta?.name ?? exp.workflow?.name ?? fileName.replace(/\.json$/i, ""),
    description: (exp.data.meta?.description ?? exp.workflow?.description ?? null) as string | null,
    stepCount,
    depsCount,
  }
}
