import "server-only"

import type { RequestAuthContext } from "@/lib/server/authz"
import { isAdminViewer, normalizeRole, type Viewer } from "@/lib/shared/viewer"

export type ViewerAuthContext = {
  userId: string
  viewer: Viewer
}

export function toViewerAuthContext(auth: RequestAuthContext): ViewerAuthContext {
  return {
    userId: auth.userId,
    viewer: {
      publicId: auth.publicId,
      role: normalizeRole(auth.role),
    },
  }
}

export function isAdminAuth(auth: ViewerAuthContext): boolean {
  return isAdminViewer(auth.viewer)
}
