"use client"

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import { useI18nOptional } from "@/components/i18n-provider"
import { cn } from "@/lib/utils"
import type { ApiIssue } from "@/lib/shared/http/types"
import { Info } from "lucide-react"

function readStringParam(params: unknown, key: string): string {
  if (!params || typeof params !== "object" || Array.isArray(params)) return ""
  const v = (params as Record<string, unknown>)[key]
  return typeof v === "string" ? String(v) : ""
}

function normalizePointer(path: string | null | undefined): string {
  const raw = String(path ?? "").trim()
  if (!raw) return "/"
  if (raw === "/") return "/"
  return raw.startsWith("/") ? raw : `/${raw}`
}

function parentJsonPointer(pointer: string | null | undefined): string {
  const p = normalizePointer(pointer)
  if (p === "/") return "/"
  const segs = p.split("/").slice(1)
  if (segs.length <= 1) return "/"
  return `/${segs.slice(0, -1).join("/")}`
}

function getIssuePaths(issue: ApiIssue): { displayPath: string; jumpPath: string } {
  const jumpPath = normalizePointer(issue.path)
  const keyword = String(issue.keyword ?? "")
  const params = issue.params ?? {}
  const hasAdditionalProp = typeof params.additionalProperty === "string" && String(params.additionalProperty)

  // For additionalProperties we jump to "/.../<prop>", but it's often nicer to display the parent object path.
  if (keyword === "additionalProperties" && hasAdditionalProp) {
    return { displayPath: parentJsonPointer(jumpPath), jumpPath }
  }

  return { displayPath: jumpPath, jumpPath }
}

function localizeAjvIssueMessage(
  issue: ApiIssue,
  t: ((key: string, params?: Record<string, string | number>) => string) | null,
): string | null {
  if (!t) return null
  const keyword = String(issue.keyword ?? "")
  const params = issue.params ?? {}
  const rawMessage = issue.message ? String(issue.message) : ""

  const tr = (messageKey: string, vars?: Record<string, string | number>) => {
    const out = t(messageKey, vars)
    return out === messageKey ? null : out
  }

  // JSON.parse / JSON syntax errors (not AJV keywords).
  if (keyword === "json") {
    const m =
      rawMessage.match(/\(line\s+(\d+)\s+column\s+(\d+)\)/i) ?? rawMessage.match(/\bline\s+(\d+)\s+column\s+(\d+)\b/i)
    const line = m?.[1] ? Number(m[1]) : null
    const column = m?.[2] ? Number(m[2]) : null
    if (line && column && Number.isFinite(line) && Number.isFinite(column)) {
      return tr("errors.json.parseAt", { line, column }) ?? tr("errors.INVALID_JSON")
    }
    return tr("errors.INVALID_JSON")
  }

  // Custom (non-AJV) structured issues used by our APIs.
  if (keyword === "reserved") {
    const field = readStringParam(params, "field")
    return tr("errors.issue.reserved", { field: field || "—" })
  }
  if (keyword === "disabled") {
    const field = readStringParam(params, "field")
    return tr("errors.issue.disabled", { field: field || "—" })
  }
  if (keyword === "not_supported") {
    const field = readStringParam(params, "field")
    return tr("errors.issue.notSupported", { field: field || "—" })
  }
  if (keyword === "not_found") {
    return tr("errors.issue.notFound")
  }
  if (keyword === "acceptMime") {
    return tr("errors.issue.acceptMime")
  }

  if (keyword === "additionalProperties") {
    const prop = typeof params.additionalProperty === "string" ? String(params.additionalProperty) : ""
    const suffix = prop ? ` (${prop})` : ""
    return tr("errors.ajv.additionalProperties", { property: suffix })
  }

  if (keyword === "required") {
    const prop = typeof params.missingProperty === "string" ? String(params.missingProperty) : ""
    const suffix = prop ? ` (${prop})` : ""
    return tr("errors.ajv.required", { property: suffix })
  }

  if (keyword === "type") {
    const tp = typeof params.type === "string" ? String(params.type) : ""
    return tr("errors.ajv.type", { type: tp || "unknown" })
  }

  if (keyword === "enum") {
    const allowed = Array.isArray(params.allowedValues) ? params.allowedValues : []
    const values = allowed.map((v: unknown) => JSON.stringify(v)).join(", ")
    return tr("errors.ajv.enum", { values: values || "…" })
  }

  if (keyword === "const") {
    const allowed = params.allowedValue
    const value = typeof allowed === "undefined" ? "…" : JSON.stringify(allowed)
    return tr("errors.ajv.const", { value })
  }

  if (keyword === "minimum" || keyword === "maximum") {
    const limit = params.limit
    const limitStr = typeof limit === "number" || typeof limit === "string" ? String(limit) : "…"
    return tr(keyword === "minimum" ? "errors.ajv.minimum" : "errors.ajv.maximum", { limit: limitStr })
  }

  if (keyword === "exclusiveMinimum" || keyword === "exclusiveMaximum") {
    const limit = params.limit
    const limitStr = typeof limit === "number" || typeof limit === "string" ? String(limit) : "…"
    return tr(keyword === "exclusiveMinimum" ? "errors.ajv.exclusiveMinimum" : "errors.ajv.exclusiveMaximum", {
      limit: limitStr,
    })
  }

  if (keyword === "minLength" || keyword === "maxLength") {
    const limit = params.limit
    const limitStr = typeof limit === "number" || typeof limit === "string" ? String(limit) : "…"
    return tr(keyword === "minLength" ? "errors.ajv.minLength" : "errors.ajv.maxLength", { limit: limitStr })
  }

  if (keyword === "minItems" || keyword === "maxItems") {
    const limit = params.limit
    const limitStr = typeof limit === "number" || typeof limit === "string" ? String(limit) : "…"
    return tr(keyword === "minItems" ? "errors.ajv.minItems" : "errors.ajv.maxItems", { limit: limitStr })
  }

  if (keyword === "minProperties" || keyword === "maxProperties") {
    const limit = params.limit
    const limitStr = typeof limit === "number" || typeof limit === "string" ? String(limit) : "…"
    return tr(keyword === "minProperties" ? "errors.ajv.minProperties" : "errors.ajv.maxProperties", {
      limit: limitStr,
    })
  }

  if (keyword === "multipleOf") {
    const multipleOf = params.multipleOf
    const n = typeof multipleOf === "number" || typeof multipleOf === "string" ? String(multipleOf) : "…"
    return tr("errors.ajv.multipleOf", { multipleOf: n })
  }

  if (keyword === "uniqueItems") {
    return tr("errors.ajv.uniqueItems")
  }

  if (keyword === "oneOf" || keyword === "anyOf" || keyword === "allOf" || keyword === "not") {
    return tr(
      keyword === "oneOf"
        ? "errors.ajv.oneOf"
        : keyword === "anyOf"
          ? "errors.ajv.anyOf"
          : keyword === "allOf"
            ? "errors.ajv.allOf"
            : "errors.ajv.not",
    )
  }

  if (keyword === "pattern") {
    return tr("errors.ajv.pattern")
  }

  if (keyword === "patternProperties") {
    return tr("errors.ajv.patternProperties")
  }

  if (keyword === "format") {
    const fmt = typeof params.format === "string" ? String(params.format) : ""
    return tr("errors.ajv.format", { format: fmt || "unknown" })
  }

  return null
}

export function ApiIssuesAlert(props: {
  title: string
  issues: ApiIssue[]
  maxItems?: number
  className?: string
  onIssueClick?: (issue: ApiIssue) => void
}) {
  const i18n = useI18nOptional()
  const max = typeof props.maxItems === "number" ? props.maxItems : 8
  const issues = Array.isArray(props.issues) ? props.issues : []
  if (issues.length === 0) return null

  return (
    <Alert variant="destructive" className={cn("rounded-md", props.className)}>
      <Info aria-hidden="true" />
      <AlertTitle>{props.title}</AlertTitle>
      <AlertDescription>
        <ul className="list-disc pl-5 text-sm">
          {issues.slice(0, max).map((iss, idx) => {
            const key = `${iss.path ?? ""}:${iss.keyword ?? ""}:${idx}`
            const paths = getIssuePaths(iss)
            const localizedMsg = localizeAjvIssueMessage(iss, i18n?.t ?? null)
            const msg = localizedMsg ?? (iss.message ? String(iss.message) : "")
            const content = (
              <>
                <span className="font-mono text-xs" title={paths.jumpPath}>
                  {paths.displayPath}
                </span>
                {msg ? ` — ${msg}` : ""}
              </>
            )
            return (
              <li key={key}>
                {props.onIssueClick ? (
                  <Button
                    type="button"
                    variant="ghost"
                    className={[
                      "h-auto p-0",
                      "inline-block",
                      "text-[inherit] font-[inherit]",
                      "text-left cursor-pointer",
                      "hover:bg-transparent hover:text-[inherit]",
                    ].join(" ")}
                    onClick={() => props.onIssueClick?.(iss)}
                  >
                    {content}
                  </Button>
                ) : (
                  content
                )}
              </li>
            )
          })}
        </ul>
        {issues.length > max ? (
          <div className="mt-2 text-xs text-muted-foreground">+{issues.length - max} more</div>
        ) : null}
      </AlertDescription>
    </Alert>
  )
}
