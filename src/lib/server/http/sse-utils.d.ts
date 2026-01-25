export function parseSseFromIdParts(params: {
  queryFromId: string | null | undefined
  lastEventIdHeader: string | null | undefined
}): { fromId: number; queryFromId: number; headerFromId: number }
