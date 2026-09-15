import type { ApiResponse, MediaDeleteImpact, MediaDeleteImpactReference } from '@line-crm/shared'
import { fetchApi } from '@/lib/api'

/*
 * 使用先ごとの参照方法（常に最新＝ライブ参照 / 版固定）。
 *
 * delete-impact の返す使用先ごとのモードと版一覧、および PATCH での
 * 切替をまとめる。api.ts へは触れず、この画面の呼び出しだけをここに置く。
 */

export type MediaUsageReferenceMode = 'live' | 'pinned' | 'mixed' | 'unknown' | 'unavailable'

export interface MediaUsageReferenceState {
  mode: MediaUsageReferenceMode
  versionNo: number | null
}

export interface MediaUsageReferenceItem extends MediaDeleteImpactReference {
  refKind: string | null
  refId: string | null
  reference: MediaUsageReferenceState | null
}

export interface MediaVersionChoice {
  versionNo: number
  mimeType: string
  sizeBytes: number
  changeReason: string | null
  createdAt: string
  publishedAt: string | null
  isCurrent: boolean
}

export interface MediaUsageImpact extends Omit<MediaDeleteImpact, 'references'> {
  references: MediaUsageReferenceItem[]
  versions: MediaVersionChoice[]
  liveUrl: string
}

export type MediaUsageReferenceTarget =
  | { refKind: string; refId: string; mode: 'live' }
  | { refKind: string; refId: string; mode: 'pinned'; versionNo: number }

export interface MediaUsageReferenceResult {
  refKind: string
  refId: string
  mode: MediaUsageReferenceMode
  versionNo: number | null
  changed: boolean
}

export function setMediaUsageReference(
  mediaId: string,
  accountId: string,
  input: MediaUsageReferenceTarget,
) {
  return fetchApi<ApiResponse<{ usageReference: MediaUsageReferenceResult }>>(
    `/api/media/${encodeURIComponent(mediaId)}?accountId=${encodeURIComponent(accountId)}`,
    { method: 'PATCH', body: JSON.stringify({ usageReference: input }) },
  )
}
