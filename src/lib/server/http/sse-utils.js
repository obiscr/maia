/**
 * Parse SSE cursor (`fromId`) from either:
 * - `Last-Event-ID` header (preferred when present)
 * - `fromId` query param (fallback)
 *
 * Returns a single monotonically increasing cursor: max(header, query).
 *
 * This file is JS on purpose so it can be imported by Node verification scripts
 * without a TS runtime/loader.
 */
export function parseSseFromIdParts(params) {
  const queryRaw = params?.queryFromId
  const headerRaw = params?.lastEventIdHeader

  const queryNum = queryRaw != null && String(queryRaw).trim() ? Number(queryRaw) : 0
  const headerNum = headerRaw != null && String(headerRaw).trim() ? Number(headerRaw) : 0

  const queryFromId = Number.isFinite(queryNum) && queryNum > 0 ? Math.floor(queryNum) : 0
  const headerFromId = Number.isFinite(headerNum) && headerNum > 0 ? Math.floor(headerNum) : 0

  return { fromId: Math.max(queryFromId, headerFromId), queryFromId, headerFromId }
}
