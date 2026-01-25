import type { Monaco } from "@/lib/client/monaco"
import type { Messages } from "@/lib/shared/i18n/messages"
import { tOptional } from "@/lib/shared/i18n/t"

export type WorkflowCompletionContext = {
  workflowId: string
  allStepKeys: string[]
  upstreamStepKeys: string[]
  stepNameByKey?: Record<string, string | undefined>
}

const modelUriToCtx = new Map<string, WorkflowCompletionContext>()
let didRegister = false
let workflowCompletionMessages: Messages | null = null

export function setWorkflowCompletionMessages(messages: Messages | null) {
  workflowCompletionMessages = messages
}

function tr(key: string, fallback: string, params?: Record<string, string | number>) {
  if (!workflowCompletionMessages) return fallback
  return tOptional(workflowCompletionMessages, key, params) ?? fallback
}

function isValidIdentifier(key: string) {
  return /^[A-Za-z_$][A-Za-z0-9_$]*$/.test(key)
}

function escapeForDoubleQuotedString(s: string) {
  return s.replace(/\\/g, "\\\\").replace(/"/g, '\\"')
}

export function registerMaiaWorkflowCompletions(monaco: Monaco) {
  if (didRegister) return
  didRegister = true

  const provider: import("monaco-editor").languages.CompletionItemProvider = {
    triggerCharacters: ["."],
    provideCompletionItems(model, position) {
      const ctx = modelUriToCtx.get(model.uri.toString())
      if (!ctx) return { suggestions: [] }

      const linePrefix = model.getLineContent(position.lineNumber).slice(0, Math.max(0, position.column - 1))
      const insertAtCursorRange = {
        startLineNumber: position.lineNumber,
        endLineNumber: position.lineNumber,
        startColumn: position.column,
        endColumn: position.column,
      }

      // ctx.<...>
      if (/\bctx\.\s*$/.test(linePrefix)) {
        const ctxProps = [
          {
            key: "params",
            detail: tr("monaco.workflowCompletions.ctx.params.detail", "Run inputs"),
          },
          {
            key: "upstream",
            detail: tr("monaco.workflowCompletions.ctx.upstream.detail", "Upstream outputs map"),
          },
          { key: "files", detail: tr("monaco.workflowCompletions.ctx.files.detail", "Run files") },
          { key: "urls", detail: tr("monaco.workflowCompletions.ctx.urls.detail", "Run URLs") },
          {
            key: "artifacts",
            detail: tr("monaco.workflowCompletions.ctx.artifacts.detail", "Attempt artifacts"),
          },
        ]
        return {
          suggestions: ctxProps.map((p) => ({
            label: p.key,
            kind: monaco.languages.CompletionItemKind.Property,
            insertText: p.key,
            range: insertAtCursorRange,
            detail: p.detail,
            sortText: `0_${p.key}`,
          })),
        }
      }

      // ctx.artifacts.<...>
      // Also supports optional chaining ctx.artifacts?.
      if (/\bctx\.artifacts(?:\?\.|\.)\s*$/.test(linePrefix)) {
        const artifactFns = [
          {
            key: "writeText",
            detail: tr("monaco.workflowCompletions.artifacts.writeText.detail", "Write text artifact"),
            documentation: tr(
              "monaco.workflowCompletions.artifacts.writeText.documentation",
              "Signature:\n" +
                "`await ctx.artifacts.writeText(name, text, { kind?, summary? })`\n" +
                "Returns: `{ name, absPath }`",
            ),
          },
          {
            key: "writeBytes",
            detail: tr("monaco.workflowCompletions.artifacts.writeBytes.detail", "Write binary artifact"),
            documentation: tr(
              "monaco.workflowCompletions.artifacts.writeBytes.documentation",
              "Signature:\n" +
                "`await ctx.artifacts.writeBytes(name, bytes, { kind?, summary?, encoding? })`\n\n" +
                "Where `bytes` can be: `Buffer | Uint8Array | ArrayBuffer | string`.\n" +
                'If `bytes` is a string, `encoding` defaults to `"base64"` (or set `"utf8"`).\n\n' +
                "Returns: `{ name, absPath }`",
            ),
          },
          {
            key: "registerFile",
            detail: tr("monaco.workflowCompletions.artifacts.registerFile.detail", "Register file as artifact"),
            documentation: tr(
              "monaco.workflowCompletions.artifacts.registerFile.documentation",
              "Signature:\n" +
                "`await ctx.artifacts.registerFile(absPath, { kind?, name?, summary? })`\n\n" +
                "Note: only files under the current attempt directory are accepted.",
            ),
          },
        ]
        return {
          suggestions: artifactFns.map((p) => ({
            label: p.key,
            kind: monaco.languages.CompletionItemKind.Method,
            insertText: p.key,
            range: insertAtCursorRange,
            detail: p.detail,
            documentation: { value: p.documentation },
            sortText: `0_${p.key}`,
          })),
        }
      }

      // upstream.<stepKey> or ctx.upstream.<stepKey>
      // Also supports optional chaining upstream?. / ctx.upstream?.
      const isOptionalChain = /\?\.\s*$/.test(linePrefix)
      const isUpstreamAccess = /\b(?:ctx\.)?upstream(?:\?\.|\.)\s*$/.test(linePrefix)
      if (isUpstreamAccess) {
        const keys = (ctx.upstreamStepKeys?.length ? ctx.upstreamStepKeys : ctx.allStepKeys).filter(Boolean)
        if (!keys.length) return { suggestions: [] }

        return {
          suggestions: keys
            .slice()
            .sort((a, b) => a.localeCompare(b))
            .map((stepKey) => {
              const name = ctx.stepNameByKey?.[stepKey]
              const canDot = isValidIdentifier(stepKey)
              const bracket = `["${escapeForDoubleQuotedString(stepKey)}"]`

              // `upstream.<notIdentifier>`: replace dot with bracket accessor -> upstream["x"]
              // `upstream?.<notIdentifier>`: keep `?.` and insert bracket (-> upstream?.["x"])
              const dotRange = {
                startLineNumber: position.lineNumber,
                endLineNumber: position.lineNumber,
                startColumn: Math.max(1, position.column - 1),
                endColumn: position.column,
              }

              return {
                label: stepKey,
                kind: monaco.languages.CompletionItemKind.Field,
                insertText: canDot ? stepKey : bracket,
                range: canDot ? insertAtCursorRange : isOptionalChain ? insertAtCursorRange : dotRange,
                detail: name ? `${name} (${stepKey})` : stepKey,
                documentation: name
                  ? {
                      value: tr(
                        "monaco.workflowCompletions.upstream.documentationNamed",
                        `Upstream output for **${name}** (\`${stepKey}\`).\nShape: \`{ ok, timestamp, data }\``,
                        { name, stepKey },
                      ),
                    }
                  : {
                      value: tr(
                        "monaco.workflowCompletions.upstream.documentationUnnamed",
                        `Upstream output for \`${stepKey}\`.\nShape: \`{ ok, timestamp, data }\``,
                        { stepKey },
                      ),
                    },
                sortText: `0_${stepKey}`,
              }
            }),
        }
      }

      return { suggestions: [] }
    },
  }

  // Register for both the default JS language and our MAIA JS language.
  monaco.languages.registerCompletionItemProvider("javascript", provider)
  monaco.languages.registerCompletionItemProvider("maia-javascript", provider)
}

export function setWorkflowCompletionContextForModelUri(modelUri: string, ctx: WorkflowCompletionContext) {
  modelUriToCtx.set(modelUri, ctx)
}

export function clearWorkflowCompletionContextForModelUri(modelUri: string) {
  modelUriToCtx.delete(modelUri)
}
