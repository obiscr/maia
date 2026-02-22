/**
 * Project-specific helpers for working with AI SDK v6 tool-call message parts.
 *
 * SDK-provided utilities (`isToolUIPart`, `getToolName`) should be imported
 * directly from "ai". This module only exports project-specific additions:
 *
 *  - `canonicalToSdkToolName()` / `sdkToCanonicalToolName()` — reversible name codec
 *  - `ToolPart` — flat convenience type for component props (avoids
 *    discriminated-union narrowing overhead in render code)
 *  - `ToolPartState` — union of all possible tool invocation states
 *  - `isToolPartInState()` — state filter
 *  - `findToolPartByName()` — search a parts array by tool name + optional state
 */

import { isToolUIPart, getToolName } from "ai"

/**
 * Encode canonical tool names (e.g. "workflow.list") into AI SDK-safe names.
 * Fixed-token codec:
 * - "_" -> "__"
 * - "." -> "_d"
 */
export function canonicalToSdkToolName(canonical: string): string {
  return canonical.replaceAll("_", "__").replaceAll(".", "_d")
}

/**
 * Decode AI SDK-safe tool names back into canonical names.
 */
export function sdkToCanonicalToolName(sdkName: string): string {
  let out = ""
  for (let i = 0; i < sdkName.length; i++) {
    const ch = sdkName[i]
    if (ch !== "_") {
      out += ch
      continue
    }
    const next = sdkName[i + 1]
    if (next === "_") {
      out += "_"
      i++
      continue
    }
    if (next === "d") {
      out += "."
      i++
      continue
    }
    out += ch
  }
  return out
}

/**
 * Flat convenience type for tool message parts.
 *
 * The SDK's `ToolUIPart | DynamicToolUIPart` is a discriminated union on
 * `state` — you can only access `output` after narrowing to `output-available`.
 * That's great for type safety but impractical in UI components that read
 * multiple fields across states.  This flat shape is structurally compatible
 * with the SDK union (TypeScript allows the assignment) while keeping
 * property access ergonomic.
 */
export type ToolPart = {
  type: `tool-${string}` | "dynamic-tool"
  toolCallId: string
  state: ToolPartState
  input: unknown
  output?: unknown
  errorText?: string
  providerExecuted?: boolean
}

/**
 * All possible states a tool invocation can be in.
 * Mirrors the SDK's discriminated union on `UIToolInvocation.state`.
 */
export type ToolPartState =
  | "input-streaming"
  | "input-available"
  | "approval-requested"
  | "approval-responded"
  | "output-available"
  | "output-error"
  | "output-denied"

/** Check whether a tool part is in one of the given states. */
export function isToolPartInState(part: ToolPart, ...states: ToolPartState[]): boolean {
  return (states as string[]).includes(part.state)
}

/**
 * Find the first tool part matching `name` (and optionally one of `states`).
 * Returns `undefined` when no match is found.
 */
export function findToolPartByName(
  parts: ReadonlyArray<{ type: string }>,
  name: string,
  ...states: ToolPartState[]
): ToolPart | undefined {
  for (const raw of parts) {
    if (!isToolUIPart(raw as any)) continue
    const part = raw as unknown as ToolPart
    const toolName = getToolName(part as any)
    if (toolName !== name && sdkToCanonicalToolName(toolName) !== name) continue
    if (states.length === 0 || isToolPartInState(part, ...states)) return part
  }
  return undefined
}
