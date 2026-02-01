import "server-only"

import { hashOpaqueToken, newOpaqueToken } from "@/lib/server/auth/token"

export type IssueOpaqueEmailTokenResult =
  | { ok: true; token: string; tokenHash: string; tokenRowId: string }
  | { ok: false; code: "TOKEN_PERSIST_FAILED" }

export async function issueOpaqueEmailToken(params: {
  create: (tokenHash: string) => Promise<{ id: string } | null>
}): Promise<IssueOpaqueEmailTokenResult> {
  const token = newOpaqueToken()
  const tokenHash = hashOpaqueToken(token)
  const row = await params.create(tokenHash).catch(() => null)
  if (!row?.id) return { ok: false, code: "TOKEN_PERSIST_FAILED" }
  return { ok: true, token, tokenHash, tokenRowId: row.id }
}

export async function revokeOpaqueEmailTokenBestEffort(params: {
  revoke: (tokenRowId: string) => Promise<unknown>
  tokenRowId: string
}): Promise<void> {
  try {
    await params.revoke(params.tokenRowId)
  } catch {}
}
