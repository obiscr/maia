export type Step = {
  stepKey: string
  name: string
  description?: string | null
  scriptEsm: string
  timeoutMs: number
  deps: string[]
}

export type Workflow = {
  id: string
  name: string
  description: string | null
  dependencies: string
  envJson: string
  inputSpec?: string | null
  outputsSpec?: string | null
  depsStatus: string
  depsErrorCode: string | null
  depsErrorMessage: string | null
  depsErrorMetaJson?: string | null
  depsErrorAt?: string | null
  steps: Step[]
}
