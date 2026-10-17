export type SavedSearchConditionKind =
  | "visit_count" | "purchase_amount" | "last_activity_at" | "member_tier"
  | "name"
  | "tag"
  | "field"
  | "form"
  | "purchase"
  | "mark"
  | "assignee"
  | "scenario"
  | "event_booking"
  | "calendar_booking"
  | "chat_status"
  | "last_activity"
  | "reminder"
  | "memo"
  | "following"
  | "status_message"
  | "created_at"
  | "common_event";

/** 保存した検索の条件1本。kind ごとに op / key / value の意味が変わる。 */
export interface SavedSearchCondition {
  kind: SavedSearchConditionKind;
  key?: string;
  formId?: string;
  op: string;
  value?: unknown;
}

/**
 * 保存した検索の中身。
 *
 * AND と OR は1段だけにする。入れ子を許すと編集画面と実行側で同じ条件を
 * 再現できなくなる。説明と一覧表示も同じJSONに置き、DB列を増やさず既存
 * データとの互換性を保つ。
 */
export interface SavedSearchConditions {
  all?: SavedSearchCondition[];
  any?: SavedSearchCondition[];
  visibility?: "visible_only" | "hidden_only" | "all";
  description?: string;
  list?: {
    columns?: string[];
    sort?: "recent" | "oldest";
    limit?: 10 | 20 | 30 | 40 | 50;
  };
}

/** 共通の配信対象条件1本。画面・人数確認・実送信で同じ形を使う。 */
export interface SavedSegmentRule {
  type:
    | "customer_segment" | "visit_count" | "purchase_amount" | "last_activity_at" | "member_tier"
    | "tag_exists"
    | "tag_not_exists"
    | "tag_all"
    | "tag_not_all"
    | "metadata_equals"
    | "metadata_not_equals"
    | "ref_code"
    | "is_following"
    | "scenario_subscribed"
    | "name"
    | "private_memo"
    | "status_message"
    | "registered_at"
    | "support_mark"
    | "is_hidden"
    | "friend_field"
    | "scenario_state"
    | "form_answered"
    | "last_reaction_at"
    | "reaction_state"
    | "score_range";
  value: unknown;
}

export interface SavedSegmentCondition {
  operator: "AND" | "OR";
  rules: SavedSegmentRule[];
  groups?: SavedSegmentCondition[];
}

/**
 * 配信対象として保存した条件。
 *
 * 旧い友だち検索の `{ all, any }` と見分けるため、版と本体を明示する。
 * 条件本体だけを推測で判別すると、種類を増やした時に誤変換が起きる。
 */
export interface SavedSegmentConditions {
  version: 1;
  condition: SavedSegmentCondition;
}

/** 保存した検索 */
export interface SavedSearch {
  id: string;
  name: string;
  scope: "friends" | "chats" | "bookings";
  /** { all: [...], any: [...], visibility } の形 */
  conditions: SavedSearchConditions;
  createdBy: string | null;
  lineAccountId: string | null;
  isShared: boolean;
  displayOrder: number;
  createdAt: string;
  conditionFormat?: "search_v1" | "segment_v1";
  updatedBy?: string | null;
  updatedAt?: string;
  revision?: number;
  /** 現在の保存条件に一致する友だち数。評価不能・未取得は null。 */
  matchCount?: number | null;
  /** matchCount が null のとき、黙って0件にせず理由を返す。 */
  matchCountError?: string | null;
  /** 配信・自動化など、保存検索をIDで参照している利用先。 */
  usedIn?: SavedSearchUsage[];
  /** 使用先が無いとサーバーで確認できたときだけ true。 */
  canDelete?: boolean;
  /** 今月、この保存条件が呼び出された回数。未取得時は省略する。 */
  callCountThisMonth?: number;
}

/** 共通の配信対象として保存した条件。友だち検索とJSONの形を混ぜない。 */
export interface SavedSegmentPreset {
  id: string;
  name: string;
  scope: "friends";
  conditionFormat: "segment_v1";
  conditions: SavedSegmentConditions;
  createdBy: string | null;
  lineAccountId: string | null;
  isShared: boolean;
  displayOrder: number;
  createdAt: string;
  usedIn?: Array<{
    kind: "broadcast" | "automation" | "scenario" | "other";
    id: string;
    name: string;
    mode: "live" | "fixed";
    lastUsedAt: string | null;
  }>;
  canDelete?: boolean;
}

export type SavedSearchUsageKind = "broadcast" | "automation" | "scenario" | "other";

export type SavedSearchReferenceMode = "live" | "fixed";

/** 保存した検索を参照している実データ。固定値の説明には使わない。 */
export interface SavedSearchUsage {
  kind: SavedSearchUsageKind;
  id: string;
  name: string;
  mode: SavedSearchReferenceMode;
  lastUsedAt: string | null;
  revision?: number | null;
  callCountThisMonth?: number;
}
