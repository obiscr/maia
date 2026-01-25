export type WorkflowRow = {
  id: string
  publicId: string
  publicNumber: number
  name: string
  description: string | null
  depsStatus: string
  depsErrorCode: string | null
  depsErrorMessage: string | null
  depsErrorMetaJson?: string | null
  depsErrorAt?: string | null
  npmDepsCount: number
  envCount?: number
  hasInputSpec?: boolean
  hasOutputsSpec?: boolean
  latestVersionNumber?: number
  lastRun?: {
    id: string
    status: string
    createdAt: string
    startedAt: string | null
    finishedAt: string | null
    workflowVersionNumber: number | null
  } | null
  recentSuccessRatePct?: number | null
  recentSuccessRateCompleted?: number
  recentSuccessRateN?: number
  stepCount: number
  runCount: number
  runningRunCount: number
  updatedAt?: string
}
