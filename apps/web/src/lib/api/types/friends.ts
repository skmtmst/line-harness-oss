import type {
  IdentityCandidateDetail,
  MergedPersonDetail,
  SavedSearchConditions,
  Friend,
  Tag,
  FriendUpcomingItem,
} from '@line-crm/shared'

export type FriendProfileCandidateOption = {
  candidateId: string
  sourceFriendId: string
  sourceLabel: string
  valuePreview: string | null
  verified: boolean
}

export type FriendProfileCandidate = {
  fieldKey: string
  fieldLabel: string
  options: FriendProfileCandidateOption[]
}

export type FriendTagCandidate = {
  id: string
  name: string
  color: string | null
  sourceFriendIds: string[]
}

export type IdentityCandidateWithProfiles = IdentityCandidateDetail & {
  profileCandidates: FriendProfileCandidate[]
  tagCandidates: FriendTagCandidate[]
}

export type MergedPersonWithCandidates = MergedPersonDetail & {
  profileCandidates: FriendProfileCandidate[]
  tagCandidates: FriendTagCandidate[]
}

export type UpdateMergedProfileCandidatesRequest = {
  expectedRevision: number
  selections: Array<{
    fieldKey: string
    candidateId: string
    updateMode: 'auto' | 'fixed'
  }>
}

export type FriendSavedView = {
  id: string
  name: string
  conditions: SavedSearchConditions
  revision: number
  isShared: boolean
  ownerId: string | null
  lineAccountId: string | null
  displayOrder: number
  match: {
    total: number | null
    byChannel: { line: number | null; mail: number | null }
    calculatedAt: string
    error: string | null
  }
  createdAt: string
  updatedAt: string
}

export type FriendListParams = {
  /** Cursor mode preserves stable timestamp/ID order; omit search and offset. */
  pagination?: 'cursor'
  cursor?: string
  offset?: string
  limit?: string | number
  tagId?: string
  accountId?: string
  /** 分析結果から作った24時間の対象者。友だちIDをURLへ並べない。 */
  audienceId?: string
  search?: string
  /**
   * `false` でタグ enrich をスキップ。autocomplete 等で displayName/picture
   * しか使わない呼び出し向け。デフォルトは true（既存呼び出しの挙動維持）。
   */
  includeTags?: boolean
  /**
   * `true` で latestIncomingMessage / latestOutgoingAt / activeScenario /
   * handled を付与。L-step 風友だちリスト UI 用。デフォルトは false。
   */
  includeChatStatus?: boolean
  fieldColumns?: string[]
  /** 並び替え。`oldest` で created_at ASC、未指定 / `recent` で DESC. */
  sort?: 'recent' | 'oldest'
  /** `unhandled` で「最新が未返信の incoming」だけに絞る (サーバ側 SQL filter). */
  handled?: 'unhandled'
  /** 最新の対応担当者。 */
  operatorId?: string
  /** 現在配信中のシナリオ。 */
  scenarioId?: string
  /** サーバーへ保存したAND/OR条件。選択中のLINEアカウントが必須。 */
  savedSearchId?: string
  /** 管理画面の14軸。AND/ORを同じJSONのまま件数確認と一覧へ渡す。 */
  conditions?: SavedSearchConditions

  // ── 詳細検索（設計 V2 2-2 の「絞り込み条件を設定」）─────────────────
  // どれも足し算。指定が無ければ何も起きない。

  /** タグ。**すべて満たす**（AND）。 */
  tagIds?: string[]
  /** このタグが付いていない人。 */
  excludeTagIds?: string[]
  /** 友だち情報が等しい。`{ 項目名: 値 }` */
  metadata?: Record<string, string>
  /** 友だち情報が等しくない。値を持たない人も含む。 */
  metadataNot?: Record<string, string>
  /** ステータスメッセージに含む。 */
  statusMessage?: string
  /** 友だち登録日（YYYY-MM-DD）。 */
  createdFrom?: string
  createdTo?: string
  /** 対応マーク。 */
  chatStatus?: 'unread' | 'in_progress' | 'on_hold' | 'resolved'
  /** 表示設定。未指定は全部。 */
  visibility?: 'following' | 'blocked'
  /** 行動スコアの現在値。片方だけでも指定できる。 */
  scoreMin?: number
  scoreMax?: number
  /**
   * R300: `true` で「点数がついている人」だけ（未採点の0点を除く）。
   * 行動スコア一覧の帯の引き継ぎ用。一覧・検索・配信の対象定義をそろえる。
   */
  scoredOnly?: boolean
}

export type FriendWithTags = Friend & { tags: Tag[] }

export type FriendFormSubmission = {
  id: string
  formId: string
  formName: string
  fields: Array<{ name: string; label: string }>
  data: Record<string, unknown>
  createdAt: string
}

export type FriendDetail = FriendWithTags & {
  realName?: string | null
  systemDisplayName?: string | null
  formSubmissions: FriendFormSubmission[]
  /** フォーム回答の総数。submissions=0 の軽い応答でも返る（PERF-13）。 */
  formSubmissionTotal?: number | null
  /** 対応の状況。やり取りがまだ無い友だちでは null。 */
  support: {
    status: 'unread' | 'in_progress' | 'on_hold' | 'resolved'
    operatorName: string | null
    notes: string | null
  } | null
}

/**
 * `GET /api/friends/:id/upcoming` の返事（IDEA-02）。
 * null は「予定なし」、*Error=true は「取得失敗（未取得）」を表す。
 * 確定した予定だけを返す。動的条件の将来配信は含まない。
 */
export type FriendUpcoming = {
  items?: FriendUpcomingItem[]
  itemsError?: boolean
  nextBooking: {
    kind: 'booking' | 'event_booking' | 'meet_consultation'
    /** booking は予約ID、event_booking はイベントID、meet_consultation は相談ID */
    id: string
    title: string
    startsAt: string
    status: string
  } | null
  nextBookingError: boolean
  nextAutoDelivery: {
    kind: 'scenario' | 'reminder'
    id: string
    name: string
    scheduledAt: string
  } | null
  nextAutoDeliveryError: boolean
}

/** Friend list items, optionally hydrated with chat status (when ?includeChatStatus=true) */
export type FriendListItem = FriendWithTags & Partial<{
  fieldValues: Record<string, string | null>
  latestIncomingMessage: { content: string; messageType: string; createdAt: string } | null
  latestOutgoingAt: string | null
  activeScenario: { name: string; status: string } | null
  handled: boolean
  operator: { id: string; name: string } | null
  supportMark: { id: string; name: string; color: string } | null
}>
