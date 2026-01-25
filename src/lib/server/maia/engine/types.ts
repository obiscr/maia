import "server-only"

export type RunInputFile =
  | {
      id: string
      name: string
      source: "upload"
      status: "ready"
      path: string // run-relative (e.g. "uploads/abc.txt")
      sizeBytes?: number
      sha256?: string
      mime?: string
    }
  | {
      id: string
      name: string
      source: "url"
      url: string
      status: "fetching" | "failed" | "ready"
      path?: string // run-relative when ready
      sizeBytes?: number
      sha256?: string
      mime?: string
      error?: string
    }

export type DownloadingInput = {
  runId: string
  fileId: string
  abort: AbortController
}

type RunningProcBase = {
  runId: string
  stepKey: string
  attemptNo: number
  timeout: NodeJS.Timeout | null
  timeoutMs: number
  timedOut: boolean
}

export type RunningProc =
  | (RunningProcBase & {
      kind: "child_process"
      child: import("child_process").ChildProcess
    })
  | (RunningProcBase & {
      kind: "runner"
      execId: string
      abort: AbortController
      cancel: (mode: "stop" | "kill") => Promise<void>
      execErrorMessage?: string | null
    })

export function isUrlInputFile(f: RunInputFile): f is Extract<RunInputFile, { source: "url" }> {
  return f.source === "url"
}
