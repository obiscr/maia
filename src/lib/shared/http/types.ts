export type ApiIssue = {
  path?: string
  keyword?: string
  message?: string
  params?: Record<string, unknown>
  schemaPath?: string
}

/**
 * RFC 7807 Problem Details (application/problem+json)
 * https://www.rfc-editor.org/rfc/rfc7807
 *
 * We extend it with:
 * - `code`: stable, machine-readable error code (UI localizes from this)
 * - `issues`: optional structured validation issues (UI localizes from issue.keyword/params)
 * - `meta`: optional structured metadata (must not contain user-facing prose)
 */
export type ApiErrorBody = {
  // RFC 7807 standard members
  type: string
  title: string
  status: number
  detail?: string
  instance?: string

  // Extensions
  code: string
  issues?: ApiIssue[]
  meta?: Record<string, unknown>
}
