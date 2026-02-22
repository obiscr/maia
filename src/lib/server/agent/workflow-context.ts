import { prisma } from "@/lib/server/db"

function trimToMaxChars(s: string, max: number) {
  if (s.length <= max) return s
  if (max <= 50) return s.slice(0, Math.max(0, max))
  return `${s.slice(0, max - 20)}\n/* … truncated … */`
}

export async function readWorkflowForAgent(workflowId: string) {
  const wf = await prisma.workflow.findUnique({ where: { id: workflowId } })
  if (!wf) throw new Error("Not found")
  const steps = await prisma.workflowStep.findMany({ where: { workflowId }, orderBy: [{ key: "asc" }] })
  const deps = await prisma.workflowStepDep.findMany({ where: { workflowId } })
  const depMap = new Map<string, string[]>()
  for (const d of deps) {
    const arr = depMap.get(d.stepId) ?? []
    arr.push(d.dependsOnStepId)
    depMap.set(d.stepId, arr)
  }
  return {
    ...wf,
    steps: steps.map((s) => ({
      stepKey: s.key,
      name: s.name,
      description: s.description ?? undefined,
      scriptEsm: s.scriptEsm,
      timeoutMs: s.timeoutMs,
      deps: depMap.get(s.key) ?? [],
    })),
  }
}

export type WorkflowForContext = {
  id: string
  name: string
  description?: string | null
  dependencies?: string | null
  inputSpec?: string | null
  outputsSpec?: string | null
  steps?: Array<{
    stepKey: string
    name: string
    description?: string
    scriptEsm?: string
    timeoutMs?: number | null
    deps?: string[]
  }>
}

export function buildWorkflowContextPrompt(params: {
  workflow: WorkflowForContext
  maxChars?: number
  includeScripts?: boolean
}) {
  const max = params.maxChars ?? 18000
  const includeScripts = params.includeScripts === true
  const wf = params.workflow

  const lines: string[] = []
  lines.push("Here is the full workflow context (auto-injected).")
  lines.push(`workflowId: ${wf.id}`)
  lines.push(`name: ${wf.name}`)
  if (wf.description) lines.push(`description: ${wf.description}`)
  lines.push(`dependencies (JSON string): ${wf.dependencies ?? "{}"}`)
  if (wf.inputSpec) lines.push(`inputSpec (JSON string): ${String(wf.inputSpec).slice(0, 4000)}`)
  lines.push("")
  lines.push(
    includeScripts
      ? "steps:"
      : "steps: (scripts omitted to save context; call get_workflow if you need the full scriptEsm for a step)",
  )

  let out = lines.join("\n")
  for (const [i, s] of (wf.steps ?? []).entries()) {
    const header = [
      "",
      `${i + 1}) ${s.stepKey} — ${s.name}`,
      s.deps?.length ? `deps: ${s.deps.join(", ")}` : "deps: (none)",
      s.timeoutMs != null ? `timeoutMs: ${s.timeoutMs}` : "",
      s.description ? `description: ${s.description}` : "",
    ]
      .filter(Boolean)
      .join("\n")

    const remaining = max - (out.length + header.length + 50)
    let scriptBlock = ""
    if (includeScripts) {
      scriptBlock = "\nscriptEsm:\n```js\n\n```"
      if (remaining > 200) {
        const scriptBudget = Math.max(0, remaining - scriptBlock.length)
        const script = trimToMaxChars(String(s.scriptEsm ?? ""), scriptBudget)
        scriptBlock = `\nscriptEsm:\n\`\`\`js\n${script}\n\`\`\``
      } else {
        scriptBlock = "\nscriptEsm: (omitted to save context; ask me to expand if needed)"
      }
    }

    const chunk = `${header}${scriptBlock}`
    if (out.length + chunk.length > max) {
      out += "\n\n…(remaining steps truncated due to context limit)"
      break
    }
    out += chunk
  }

  return out
}
