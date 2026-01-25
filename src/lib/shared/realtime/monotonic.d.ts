export function parseIsoMs(v: unknown): number | null

export function createEventIdGate(initialId?: number): {
  readonly lastId: number
  shouldApply(id: unknown): boolean
}

export function monotonicMerge<TPrev extends object, TPatch extends Partial<TPrev> & Record<string, unknown>>(
  prev: TPrev | null | undefined,
  patch: TPatch | null | undefined,
  opts?: {
    versionKey?: string
    getVersion?: (x: unknown) => number | null
    getStatus?: (x: unknown) => string | null | undefined
    terminalStatuses?: string[]
  },
): TPrev
