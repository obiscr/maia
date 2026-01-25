import { ZodError } from "zod"

import type { ApiIssue } from "@/lib/shared/http/types"

function toPointer(path: Array<string | number>) {
  if (!path.length) return "/"
  const segs = path.map((p) => String(p).replace(/~/g, "~0").replace(/\//g, "~1"))
  return `/${segs.join("/")}`
}

export function zodIssues(err: ZodError): ApiIssue[] {
  return err.issues.map((i) => ({
    path: toPointer(i.path as Array<string | number>),
    keyword: "zod",
    message: i.message,
    params: { code: i.code },
  }))
}
