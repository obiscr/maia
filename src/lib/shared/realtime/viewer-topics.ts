import {
  makeAdminListStreamTopic,
  makeUserListStreamTopic,
  type ListStreamTopicKind,
  type StreamTopic,
} from "@/lib/shared/realtime/topics"
import type { Viewer } from "@/lib/shared/viewer"

export function makeListTopicForViewer(kind: ListStreamTopicKind, viewer: Viewer): StreamTopic {
  return viewer.role === "ADMIN" ? makeAdminListStreamTopic(kind) : makeUserListStreamTopic(kind, viewer.publicId)
}
