import type { Tag, FriendField, SupportMark, ApiResponse, SavedSearch } from '@line-crm/shared'
import type { SegmentCondition } from '../../segment-condition'

/**
 * タグを消したときに失われるもの（`GET /api/tags/:id/delete-impact`）。
 *
 * 実体は `packages/db` の `TagDeleteImpact`。web からは `packages/db` を
 * 読めないので、ここに写している。**増減したら両方直す。**
 */
export type TagDeleteImpactReferences = {
  broadcasts: number
  forms: number
  scenarios: number
  autoReplies: number
  savedSearches: number
  automations: number
  commonActions: number
  richMenus: number
  templates: number
  webinars: number
  reminders: number
  entryRoutes: number
  trackedLinks: number
  bookingMenus: number
  affiliateOffers: number
  events: number
  analyticsFunnels: number
  friendAddSettings: number
}

export type TagDeleteImpact = {
  tag: { id: string; name: string }
  /** タグを外される友だちの人数。**これだけでは削除を止めない。** */
  friendCount: number
  /** このタグIDをいまも保存している運用設定の件数。 */
  references: TagDeleteImpactReferences
  blockingReferenceCount: number
  canDelete: boolean
}

export type TagDefinitionAction = {
  id: string
  type: string
  params: Record<string, unknown>
  onFailure: 'stop' | 'continue'
}

export type TagDefinition = {
  tag: Tag
  automation: null | {
    id: string
    name: string
    status: 'draft' | 'published' | 'archived'
    draftVersion: null | { id: string; versionNumber: number; state: 'draft'; actions: TagDefinitionAction[] }
    publishedVersion: null | { id: string; versionNumber: number; state: 'published'; actions: TagDefinitionAction[] }
    actions: TagDefinitionAction[]
  }
}

export type SaveTagDefinition = {
  name: string
  description?: string | null
  groupId?: string | null
  isStarred?: boolean
  manualAssignmentAllowed?: boolean
  reapplyPolicy: 'first_only' | 'every_time'
  linkedEnabled: boolean
  mileage: { self: number; referrer: number; multiplier: number | null; priority: number }
  actions: TagDefinitionAction[]
  applyToExisting?: boolean
}

/** 遡及マイル実行の前にサーバーが数えた対象（N-047）。 */
export type TagRetroactivePreview = {
  tagId: string
  lineAccountId: string | null
  /** タグが付いている友だちの合計 */
  friendCount: number
  /** 本人マイルをまだ受け取っていない人数 */
  selfTargets: number
  /** 本人マイルをすでに受け取っている人数 */
  selfExcluded: number
  /** 紹介者マイルの対象人数（まだ紹介者へ付与されていない） */
  referralTargets: number
  /** 紹介者マイルがすでに付与済みの人数 */
  referralExcluded: number
  selfMiles: number
  referralMiles: number
  totalMiles: number
  expiresAt: string
  /** 実行時の引き換え券。PATCH へそのまま渡す。 */
  previewToken: string
}

export type TagDependencies = {
  tag: { id: string; name: string; version: number; status: 'active' | 'archived' }
  friendCount: number
  referenceCounts: TagDeleteImpactReferences
  references: Array<{
    kind: string
    name: string
    href: string
    count: number
    state: 'active'
    definitionVersion: number | null
  }>
  linkedActions: Array<{
    kind: 'common_action'
    name: string
    version: number
    state: 'published' | 'draft'
  }>
  pendingRunCount: number
  mileageImpact: {
    configured: boolean
    self: number
    referrer: number
    multiplier: number | null
    priority: number
    reapplyPolicy: 'first_only' | 'every_time'
    historyPreserved: true
  }
  blockingReferenceCount: number
  canArchive: boolean
  canDelete: boolean
  checkedAt: string
  revision: string
}

export type FriendFieldMigrationPreview = {
  source: FriendField
  target?: FriendField
  summary: { total: number; convertible: number; review: number; invalid: number }
  rows: Array<{
    friendId: string
    sourceValue: string
    convertedValue: string | null
    status: 'review' | 'invalid'
    reason: string | null
  }>
  usageTargets: Array<{ fieldId: string; kind: string; id: string; name: string; switchable: boolean }>
  runId: string | null
  previewToken: string | null
  previewExpiresAt: string | null
}

/** GET /api/field-migrations/:runId の返り値。実行状況と失敗行を画面へ出す。 */
export type FriendFieldMigrationRun = {
  runId: string
  sourceFieldId: string
  targetFieldId: string
  status: 'previewed' | 'queued' | 'running' | 'partial' | 'succeeded' | 'failed' | 'stale'
  summary: {
    total: number
    convertible: number
    review: number
    invalid: number
    processed: number
    succeeded: number
    failed: number
  }
  usageTargets: unknown
  rows: Array<{
    friendId: string
    sourceValue: string
    convertedValue: string | null
    status: string
    reason: string | null
  }>
  previewExpiresAt: string | null
  rollbackDeadline: string | null
  error: string | null
  createdAt: string
  updatedAt: string
}

export type SupportMarkListItem = SupportMark & {
  friendCount: number
  automationRules: SupportMarkAutomationRule[]
}

export type SupportMarkArchiveImpact = {
  mark: SupportMark
  friendCount: number
  usedIn: NonNullable<SupportMark['usedIn']>
  automationRules: SupportMarkAutomationRule[]
  displayTargets: NonNullable<SupportMark['displayTargets']>
  replacementOptions: SupportMark[]
  canArchive: boolean
  impactRevision: string
  checkedAt: string
  expectedVersion: number
}

export type SavedSearchSummary = {
  total: number
  usedInBroadcasts: number
  zeroMatches: number
  callsThisMonth: number
}

export type SavedSearchListResponse = ApiResponse<SavedSearch[]> & {
  items: SavedSearch[]
  summary: SavedSearchSummary
  pagination: { total: number; limit: number; cursor: string; nextCursor: string | null }
}

export type SavedSearchMatchPreview = {
  total: number | null
  byChannel: { line: number | null; mail: number | null }
  calculatedAt: string
  error: string | null
}

export type SavedSearchDetail = SavedSearch & {
  accountScope: { type: 'line_account'; id: string }
  owner: { id: string | null; isCurrentUser: boolean }
  match: SavedSearchMatchPreview
}

/**
 * 対応マークの自動変更ルール（設計 `GMvBd` 4-3-A）。
 *
 * きっかけは5つ。**Worker の `SUPPORT_MARK_RULE_EVENTS` と同じ並び**で持つ。
 * 画面側で足すと、選べるのに保存できない選択肢ができる。
 */
export type SupportMarkAutomationEvent =
  | 'message_received'
  | 'manual_reply_sent'
  | 'staff_assigned'
  | 'response_overdue'
  | 'condition_matched'

export type SupportMarkAutomationRule = {
  id: string
  name: string
  markId: string
  event: SupportMarkAutomationEvent
  condition: SegmentCondition | null
  priority: number
  /** 手で変えたマークを守る時間（分）。**0は「保護しない」で、未取得ではない。** */
  manualProtectionMinutes: number
  isActive: boolean
  /** 取り合いを見つけるための版。読んだ版と違えば 409。 */
  version: number
  updatedAt: string
}

export type SaveSupportMarkAutomationRule = Omit<
  SupportMarkAutomationRule,
  'id' | 'markId' | 'version' | 'updatedAt'
>
