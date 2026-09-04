// =============================================================================
// LINE OSS CRM - 共有型定義
// Cloudflare D1 の挙動:
//   - TEXT / BLOB 列 → string
//   - INTEGER / REAL 列 → number
//   - NULL 列 → null
// IDと日付は TEXT で格納するため string 型を使用する
// =============================================================================

// -----------------------------------------------------------------------------
// 友だち (Friend)
// -----------------------------------------------------------------------------
export interface Friend {
  /** 主キー (UUIDv4) */
  id: string;
  /** LINE ユーザーID */
  lineUserId: string;
  /** 表示名 */
  displayName: string;
  /** プロフィール画像URL */
  pictureUrl: string | null;
  /** ステータスメッセージ */
  statusMessage: string | null;
  /**
   * フォロー中かどうか (ブロック・退会で false になる)
   * D1はBOOLEANをINTEGER(0/1)で格納するが、Cloudflare D1クライアントはJavaScript boolean に変換して返す
   */
  isFollowing: boolean;
  /** メタデータ (フォーム回答, 業種等). serializeFriend が JSON.parse 済 */
  metadata?: Record<string, unknown>;
  /** 流入経路 ref コード (?ref=… で渡されたトラッキング識別子). 設定無しなら null */
  refCode?: string | null;
  /** 内部 user_id (UUIDv4). cross-account dedup 用 */
  userId?: string | null;
  /**
   * 流入元キャンペーン名 (LP/トラッキングリンク). 友だち追加時に attribute、
   * 以後不変. 一覧 API の chat-status hydration が有効なときのみ付与.
   */
  firstTrackedLinkName?: string | null;
  /**
   * チャット状態. /chats 画面の status と整合.
   *   unread       未対応 (incoming あり、operator が読んでない)
   *   in_progress  対応中 (operator が見て、まだ閉じてない)
   *   resolved     対応済み (デフォルト. chats 行がない friend もここ)
   * 一覧 API の chat-status hydration が有効なときのみ付与.
   */
  chatStatus?: 'unread' | 'in_progress' | 'on_hold' | 'resolved';
  /** 作成日時 (ISO 8601) */
  createdAt: string;
  /** 更新日時 (ISO 8601) */
  updatedAt: string;
}

/**
 * 友だち一覧のチャット状況フィールド (`?includeChatStatus=true` で付与).
 * L-step 風の友だちリスト UI で「未対応 / シナリオ / 直近受信メッセージ」を
 * 表示するため、サーバー側で 3 本の batched クエリで集計して返す。
 */
export interface FriendChatStatus {
  /** 直近の受信メッセージ. ない場合は null */
  latestIncomingMessage: {
    content: string;
    messageType: string;
    createdAt: string;
  } | null;
  /** 直近の送信メッセージ時刻. なければ null */
  latestOutgoingAt: string | null;
  /** 進行中シナリオ. 複数あれば最新 (started_at DESC). なければ null */
  activeScenario: { name: string; status: string } | null;
  /**
   * "対応済み" フラグ.
   * true = 受信メッセージなし or 受信より新しい送信メッセージあり (= 既に対応済).
   * false = 直近の活動が受信メッセージ (= 未対応).
   */
  handled: boolean;
}

// -----------------------------------------------------------------------------
// タグ (Tag)
// -----------------------------------------------------------------------------
export interface Tag {
  /** 主キー (UUIDv4) */
  id: string;
  /** タグ名 */
  name: string;
  /** 表示色 (HEX: #RRGGBB) */
  color: string;
  /** 所属する親分類のID。null は未分類 */
  groupId?: string | null;
  /** このタグを初めて獲得したときに付与するマイル */
  mileageReward?: number;
  /** 紹介された友だちがこのタグを獲得したとき、紹介者へ付与するマイル */
  referralMileageReward?: number;
  /** 今後の行動マイル倍率。10000 = 1.0倍、null = 倍率タグとして使わない */
  mileageMultiplierBps?: number | null;
  /** 複数の倍率タグがある場合の優先順位（大きい値を採用） */
  mileageMultiplierPriority?: number;
  /** 友だち一覧の「★つきタグ」列に出すか */
  isStarred?: boolean;
  /** 一覧での並び順。小さいほど上 */
  displayOrder?: number;
  /** 作成日時 (ISO 8601) */
  createdAt: string;
  /** このタグが付与されている友だち数 (GET /api/tags のみ付与) */
  friendCount?: number;
  /** 自動付与のきっかけ。履歴から断定できない場合は省略する。 */
  assignSource?: "ec" | "line_login" | "form" | "ec_purchase" | "manual" | "birthday";
  /** このタグを参照している機能と件数。0件の機能は省略する。 */
  usedIn?: {
    broadcasts?: number;
    forms?: number;
    scenarios?: number;
    autoReplies?: number;
    savedSearches?: number;
  };
  /** このタグが付いた後に動く、マイル以外のアクション数。0件なら省略する。 */
  otherActionCount?: number;
  /** タグ管理の整理候補に入る理由。withCounts=1 のときだけ返る。 */
  cleanupReasons?: Array<"unused" | "duplicate_name">;
}

/** CSV一括登録で画面からAPIへ渡す1行。lineは見出しを含む元CSVの行番号。 */
export interface TagCsvImportInputRow {
  line?: number;
  name: string;
  folderName?: string;
}

export type TagCsvImportRowStatus =
  | "ready"
  | "created"
  | "skipped"
  | "invalid"
  | "failed";

export type TagCsvImportRowCode =
  | "name_required"
  | "name_too_long"
  | "invalid_character"
  | "already_exists"
  | "duplicate_in_file"
  | "folder_not_found"
  | "folder_ambiguous"
  | "folder_changed"
  | "create_failed";

/** 事前確認・実行結果で共通して返す1行。失敗行CSVを画面で作れる情報を残す。 */
export interface TagCsvImportRowResult {
  line: number;
  name: string;
  folderName: string;
  status: TagCsvImportRowStatus;
  code?: TagCsvImportRowCode;
  message?: string;
  tagId?: string;
}

export interface TagCsvImportSummary {
  total: number;
  ready: number;
  created: number;
  skipped: number;
  invalid: number;
  failed: number;
}

export interface TagCsvImportPreview {
  summary: TagCsvImportSummary;
  rows: TagCsvImportRowResult[];
}

export interface TagCsvImportResult extends TagCsvImportPreview {
  outcome: "success" | "partial" | "failed";
}

/** 友だち情報欄の種類 */
export type FriendFieldType =
  | "text"
  | "textarea"
  | "number"
  | "date"
  | "select"
  | "multi_select"
  | "checkbox"
  | "url"
  | "tel"
  | "email";

/**
 * 友だち情報欄の項目。
 *
 * フォームの回答 → 情報欄 → 友だち詳細 → テンプレートの差し込み、が
 * 1本の線で繋がる。その起点。
 */
export interface FriendField {
  id: string;
  folderId: string | null;
  /** 画面に出す名前 */
  name: string;
  /** 差し込み変数名。{{field.pet_name}} のように使う */
  fieldKey: string;
  type: FriendFieldType;
  /** select / multi_select のときの選択肢 */
  options: string[] | null;
  defaultValue: string | null;
  source: "manual" | "form" | "ec" | "automation";
  ecFieldPath: string | null;
  /** true ならEC側が正。管理画面からは変更できない */
  ecIsMaster: boolean;
  /** 本名・電話・住所など。閲覧を役割で絞る */
  isPersonal: boolean;
  isStarred: boolean;
  displayOrder: number;
  createdAt: string;
  updatedAt: string;
  /** GET /api/friends/:id/fields のときだけ付く */
  value?: string | null;
  updatedBy?: string | null;
  /** ?withUsage=1 のときだけ付く */
  usageCount?: number;
  /** 選択中アカウント専用でなく、移行前からある共通項目。 */
  isInherited?: boolean;
}

export interface FriendFieldListSummary {
  total: number;
  inUse: number;
  registeredFriends: number;
  formLinks: number | null;
  updatedThisMonth: number;
}

/** 汎用フォルダ */
export interface Folder {
  id: string;
  kind: string;
  name: string;
  parentId: string | null;
  displayOrder: number;
  /**
   * #RRGGBB。未設定は null。
   *
   * 色はフォルダに付く。タグ1つずつに色を決めさせると、100枚あるタグで
   * 色がばらけて一覧での区別に使えない。分類の色を、属するタグに出す。
   */
  color: string | null;
  createdAt: string;
  updatedAt: string;
}

/** 対応マーク */
export interface SupportMark {
  id: string;
  name: string;
  color: string;
  isDefault: boolean;
  autoOnInbound: boolean;
  displayOrder: number;
  createdAt: string;
  /** 旧環境から共有されているマーク。編集時に選択中アカウントへ複製される。 */
  isInherited?: boolean;
  /** GET /api/support-marks の一覧で返る実参照数。省略は未取得、0は参照なし。 */
  usedIn?: {
    broadcasts: number;
    scenarios: number;
    autoReplies: number;
    savedSearches: number;
    automations: number;
  };
}

/** メディアライブラリの1件 */
export interface MediaItem {
  id: string;
  lineAccountId: string | null;
  folderId: string | null;
  kind: "image" | "video" | "audio" | "file";
  filename: string;
  mimeType: string;
  sizeBytes: number;
  width: number | null;
  height: number | null;
  durationMs: number | null;
  url: string;
  uploadedBy: string | null;
  createdAt: string;
  /** 0は未使用。省略は旧APIなどでまだ取得できていない状態。 */
  usageCount?: number;
}

/** メディアの使用箇所 */
export interface MediaUsage {
  refKind: string;
  refId: string;
  scannedAt: string;
}

export type MediaDeleteImpactReferenceKind =
  | "template"
  | "broadcast"
  | "rich_menu"
  | "scenario_step"
  | "nen_column"
  | "event"
  | "webinar";

/** 登録メディアを消す前に、運用者が確認する現在の使用先。 */
export interface MediaDeleteImpactReference {
  kind: MediaDeleteImpactReferenceKind;
  /** 権限内で現在の正本を引けたときだけ入る。内部IDは画面へ返さない。 */
  name: string | null;
  /** 同じLINEアカウントの使用先へ移動できるときだけ入る。 */
  href: string | null;
  /** 参照先が削除済み、または別アカウントで詳細を見せられない場合。 */
  state: "available" | "unavailable";
  scannedAt: string;
}

/** `GET /api/media/:id/delete-impact` の返り値。 */
export interface MediaDeleteImpact {
  media: {
    id: string;
    filename: string;
    kind: MediaItem["kind"];
  };
  usageCount: number;
  references: MediaDeleteImpactReference[];
  /** 7種類すべてを削除直前に読み切った時刻。0件でも必ず入る。 */
  checkedAt: string;
  lastScannedAt: string | null;
  canDelete: boolean;
  recommendedAction: "delete" | "review_references";
}

export type MediaReplacementBlocker =
  | "same_media"
  | "different_kind"
  | "unavailable_reference"
  | "shared_reference"
  | "unsupported_reference";

/** 一括差し替えの対象になる使用先。内部IDは画面へ返さない。 */
export interface MediaReplacementReference extends MediaDeleteImpactReference {
  replaceable: boolean;
  blocker: MediaReplacementBlocker | null;
  reason: string | null;
}

/** `GET /api/media/:id/replacement-impact` の返り値。 */
export interface MediaReplacementImpact {
  source: MediaDeleteImpact["media"];
  replacement: MediaDeleteImpact["media"];
  usageCount: number;
  replaceableCount: number;
  references: MediaReplacementReference[];
  blockers: MediaReplacementBlocker[];
  canReplace: boolean;
  checkedAt: string;
  /** 影響確認後に使用先が変わっていないことを、実行直前に照合する値。 */
  revision: string;
}

export interface MediaReplacementResult {
  sourceId: string;
  replacementId: string;
  replacedUsageCount: number;
  remainingUsageCount: number | null;
  verification: "verified" | "partial" | "unavailable";
  checkedAt: string;
}

/** 共通情報。テンプレートに {{var.shop_hours}} として差し込む */
export interface CommonVar {
  id: string;
  lineAccountId: string | null;
  folderId: string | null;
  name: string;
  varKey: string;
  type: "text" | "url" | "image" | "number";
  value: string;
  createdAt: string;
  updatedAt: string;
  nextSchedule?: {
    effectiveFrom: string;
    value: string;
  } | null;
  pendingScheduleCount?: number;
}

/** 共通情報の日付での切り替え予約 */
export interface CommonVarSchedule {
  id: string;
  varId: string;
  effectiveFrom: string;
  value: string;
  appliedAt: string | null;
}

/** 共通情報を差し込んでいる設定の種類。 */
export type CommonVarUsageKind =
  | "template"
  | "broadcast"
  | "scenario"
  | "reminder"
  | "auto_reply"
  | "form"
  | "automation"
  | "friend_add"
  | "common_action";

/** 共通情報を削除する前に、運用者へ見せる使用先。内部IDは専用項目で返さない。 */
export interface CommonVarDeleteImpactItem {
  kind: CommonVarUsageKind;
  kindLabel: string;
  name: string;
  status: string;
  href: string;
  blocksDeletion: boolean;
  currentPreview: string;
}

/** 所属を確定できず、名前や本文を安全に見せられない使用先。 */
export interface CommonVarDeleteImpactUnavailableReference {
  kind: CommonVarUsageKind;
  kindLabel: string;
  count: number;
  reason: string;
}

/** 共通情報の削除前確認（GET /api/common-vars/:id/delete-impact）。 */
export interface CommonVarDeleteImpact {
  variable: { id: string; name: string; varKey: string };
  total: number;
  blockingTotal: number;
  historicalTotal: number;
  unscopedFormTotal: number;
  canDelete: boolean;
  byKind: Record<CommonVarUsageKind, number>;
  items: CommonVarDeleteImpactItem[];
  unavailableReferences: CommonVarDeleteImpactUnavailableReference[];
  checkedAt: string;
  recommendedAction: "delete" | "review_references";
}

export type SavedSearchConditionKind =
  | "name"
  | "tag"
  | "field"
  | "form"
  | "purchase"
  | "mark"
  | "scenario"
  | "chat_status"
  | "following"
  | "status_message"
  | "created_at";

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
  /** 現在の保存条件に一致する友だち数。評価不能・未取得は null。 */
  matchCount?: number | null;
  /** matchCount が null のとき、黙って0件にせず理由を返す。 */
  matchCountError?: string | null;
  /** 配信・自動化など、保存検索をIDで参照している利用先。 */
  usedIn?: SavedSearchUsage[];
  /** 使用先が無いとサーバーで確認できたときだけ true。 */
  canDelete?: boolean;
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
}

/**
 * タグの親分類。「お悩み」「ペット」のようにタグをまとめる。
 * 入れ子にはしない（二段で足りる）。
 */
export interface TagGroup {
  /** 主キー (UUIDv4) */
  id: string;
  /** 分類名 */
  name: string;
  /** 一覧での並び順。小さいほど上 */
  sortOrder: number;
  /**
   * #RRGGBB。未設定は null。
   *
   * 色はこの分類（フォルダ）に付く。属するタグの印に出る。
   * タグ1つずつに色を決めさせると、100枚あるタグで色がばらけて
   * 一覧での区別に使えない。
   */
  color: string | null;
  /** 作成日時 (ISO 8601) */
  createdAt: string;
  /** 更新日時 (ISO 8601) */
  updatedAt: string;
}

// -----------------------------------------------------------------------------
// 友だち×タグ 中間テーブル (FriendTag)
// -----------------------------------------------------------------------------
export interface FriendTag {
  /** 友だちID */
  friendId: string;
  /** タグID */
  tagId: string;
  /** 割り当て日時 (ISO 8601) */
  assignedAt: string;
}

// -----------------------------------------------------------------------------
// シナリオ (Scenario)
// -----------------------------------------------------------------------------

/** シナリオのトリガー種別 */
export type ScenarioTriggerType = "friend_add" | "tag_added" | "manual";

/**
 * シナリオの配信モード
 * - relative: 前ステップからの相対遅延 (delayMinutes)
 * - elapsed: 購読開始からの経過時間 (offsetDays + offsetMinutes)
 * - absolute_time: 購読開始から N 日後の HH:MM JST (offsetDays + deliveryTime)
 */
export type DeliveryMode = "relative" | "elapsed" | "absolute_time";

export interface Scenario {
  /** 主キー (UUIDv4) */
  id: string;
  /** シナリオ名 */
  name: string;
  /** 説明文 */
  description: string | null;
  /** トリガー種別 */
  triggerType: ScenarioTriggerType;
  /** トリガーとなるタグID (triggerType が 'tag_added' の場合のみ使用) */
  triggerTagId: string | null;
  /** 紐づく LINE アカウント ID。null = 全アカウント共通として発火 */
  lineAccountId: string | null;
  /** 有効/無効フラグ */
  isActive: boolean;
  /** 配信モード (作成後の変更不可)。レスポンスでは常にセット、Create リクエストでは省略可 (default: 'relative') */
  deliveryMode?: DeliveryMode;
  /**
   * 他のシナリオと同時に動いてよいか。既定は true（並行を許す）。
   * false にすると、他のシナリオが動いている人はこのシナリオに登録されない。
   */
  allowConcurrent?: boolean;
  /** 一覧での並び順。小さいほど上 */
  displayOrder?: number;
  /** 作成日時 (ISO 8601) */
  createdAt: string;
  /** 更新日時 (ISO 8601) */
  updatedAt: string;
  /** 置き場。未分類は null。 */
  folderId?: string | null;
  /** シナリオ全体の配信対象 (120)。SegmentCondition。null は条件なし。 */
  audienceCondition?: unknown;
  /** 最終コンテンツを配り終えたあとどうするか (121)。 */
  onCompleteMode?: 'pause' | 'resume_previous' | 'move';
  /** onCompleteMode が 'move' のときの移動先 (122)。 */
  onCompleteScenarioId?: string | null;
}

// -----------------------------------------------------------------------------
// シナリオステップ (ScenarioStep)
// -----------------------------------------------------------------------------

/** メッセージ種別 */
/**
 * シナリオの通で送れる種別（132 で拡張）。
 *
 * カルーセルは含めない。LINE のカルーセルは Flex の一種なので flex として
 * 送る。別の種別にすると、配信側で同じものを2通りに扱うことになる。
 */
export type MessageType =
  | "text"
  | "image"
  | "flex"
  | "location"
  | "video"
  | "audio"
  | "sticker"
  | "carousel";

export interface ScenarioStep {
  /** 主キー (UUIDv4) */
  id: string;
  /** 所属するシナリオID */
  scenarioId: string;
  /** ステップ順序 (1始まり) */
  stepOrder: number;
  /** 前のステップからの遅延時間 (分) — relative mode のみ意味あり、他モードは 0 */
  delayMinutes: number;
  /** 購読開始からの経過日数 — elapsed / absolute_time mode 用 */
  offsetDays?: number | null;
  /** 経過日数に追加する分 (0..1439) — elapsed mode 用 */
  offsetMinutes?: number | null;
  /** 配信時刻 "HH:MM" (JST) — absolute_time mode 用 */
  deliveryTime?: string | null;
  /** 参照するテンプレート ID (null = 直接入力モード) */
  templateId?: string | null;
  /** このステップ到達時に付与するタグ ID */
  onReachTagId?: string | null;
  /** この通を送ったあと。'pause' なら次へ進めず止める */
  afterSend?: 'continue' | 'pause';
  /** メッセージ種別 */
  messageType: MessageType;
  /** メッセージ内容 (テキスト or JSONシリアライズ済みFlexメッセージ等) */
  messageContent: string;
  /**
   * 1通ごとの配信対象 (124)。SegmentCondition。null は「購読中の全員に配信する」。
   *
   * ステップの条件 (condition_type) とは意味が違う。あちらは「満たさなければ
   * 次へ飛ばす」、こちらは「対象でなければこの通だけ送らない」。
   */
  targetCondition?: unknown;
  /** 質問メッセージ (125)。ScenarioQuestion。null ならふつうの通。 */
  question?: unknown;
  /** 下書き (126)。true なら配信の対象から外れる。 */
  isDraft?: boolean;
  /** 作成日時 (ISO 8601) */
  createdAt: string;
}

/** シナリオ到達率ダッシュボード */
export interface ScenarioStats {
  enrolledTotal: number;
  activeNow: number;
  completed: number;
  paused: number;
  steps: Array<{
    stepOrder: number;
    reachedCount: number;
    /** 0..1 */
    reachRate: number;
  }>;
}

/** テンプレ使用箇所一覧 */
export interface TemplateUsages {
  autoReplies: Array<{
    id: string;
    keyword: string;
    lineAccountId: string | null;
  }>;
  scenarioSteps: Array<{
    scenarioId: string;
    scenarioName: string;
    stepId: string;
    stepOrder: number;
  }>;
  automations: Array<{ id: string; name: string; eventType: string }>;
  reminderSteps: Array<{ reminderId: string; reminderName: string; stepId: string }>;
  richMenuAreas: Array<{
    groupId: string;
    groupName: string;
    pageName: string;
    areaId: string;
    label: string | null;
  }>;
  trackedLinks: Array<{ id: string; name: string }>;
}

// -----------------------------------------------------------------------------
// 友だち×シナリオ 進捗テーブル (FriendScenario)
// -----------------------------------------------------------------------------

/** シナリオ配信ステータス */
export type FriendScenarioStatus = "active" | "paused" | "completed";

export interface FriendScenario {
  /** 主キー (UUIDv4) */
  id: string;
  /** 友だちID */
  friendId: string;
  /** シナリオID */
  scenarioId: string;
  /** 現在処理中のステップ順序 */
  currentStepOrder: number;
  /** 配信ステータス */
  status: FriendScenarioStatus;
  /** 開始日時 (ISO 8601) */
  startedAt: string;
  /** 次回配信予定日時 (ISO 8601、null は配信完了) */
  nextDeliveryAt: string | null;
  /** 更新日時 (ISO 8601) */
  updatedAt: string;
}

// -----------------------------------------------------------------------------
// 一斉配信 (Broadcast)
// -----------------------------------------------------------------------------

/** 配信対象種別 */
export type BroadcastTargetType = "all" | "tag" | "segment" | "multi-account-dedup";

/** 配信ステータス */
export type BroadcastStatus = "draft" | "scheduled" | "sending" | "sent";

export interface Broadcast {
  /** 主キー (UUIDv4) */
  id: string;
  /** 配信タイトル (管理用ラベル) */
  title: string;
  /** メッセージ種別 */
  messageType: MessageType;
  /** メッセージ内容 */
  messageContent: string;
  /** 配信対象種別 */
  targetType: BroadcastTargetType;
  /** 対象タグID (targetType が 'tag' の場合のみ使用) */
  targetTagId: string | null;
  /** 配信ステータス */
  status: BroadcastStatus;
  /** 予約配信日時 (ISO 8601、即時配信の場合は null) */
  scheduledAt: string | null;
  /** 配信完了日時 (ISO 8601) */
  sentAt: string | null;
  /** 配信対象人数 */
  totalCount: number;
  /** 配信成功人数 */
  successCount: number;
  /** 作成日時 (ISO 8601) */
  createdAt: string;
}

// -----------------------------------------------------------------------------
// メッセージログ (MessageLog)
// -----------------------------------------------------------------------------

/** メッセージの方向 */
export type MessageDirection = "incoming" | "outgoing";

export interface MessageLog {
  /** 主キー (UUIDv4) */
  id: string;
  /** 友だちID */
  friendId: string;
  /** メッセージ方向 (incoming: ユーザー→Bot, outgoing: Bot→ユーザー) */
  direction: MessageDirection;
  /** メッセージ種別 */
  messageType: MessageType;
  /** メッセージ内容 */
  content: string;
  /** 紐付く一斉配信ID (outgoing かつ配信経由の場合) */
  broadcastId: string | null;
  /** 紐付くシナリオステップID (outgoing かつシナリオ経由の場合) */
  scenarioStepId: string | null;
  /** 作成日時 (ISO 8601) */
  createdAt: string;
}

// -----------------------------------------------------------------------------
// 自動返信 (AutoReply)
// -----------------------------------------------------------------------------

/** キーワードマッチ種別 */
export type AutoReplyMatchType = "exact" | "contains";

export interface AutoReply {
  /** 主キー (UUIDv4) */
  id: string;
  /** マッチさせるキーワード */
  keyword: string;
  /** マッチ種別 (exact: 完全一致, contains: 部分一致) */
  matchType: AutoReplyMatchType;
  /** レスポンスメッセージ種別 */
  responseType: MessageType;
  /** レスポンス内容 */
  responseContent: string;
  /** 有効/無効フラグ */
  isActive: boolean;
  /** 作成日時 (ISO 8601) */
  createdAt: string;
}

// -----------------------------------------------------------------------------
// 管理ユーザー (AdminUser)
// -----------------------------------------------------------------------------

/**
 * 管理ユーザー (内部用 — パスワードハッシュを含む)
 * ※ API レスポンスとして直接返してはならない。フロントへは AdminUserPublic を使う。
 */
export interface AdminUser {
  /** 主キー (UUIDv4) */
  id: string;
  /** メールアドレス */
  email: string;
  /** パスワードハッシュ (bcrypt) — フロントエンドに絶対に返さないこと */
  passwordHash: string;
  /** 作成日時 (ISO 8601) */
  createdAt: string;
}

/**
 * 管理ユーザー (公開用 — パスワードハッシュを除いたもの)
 * API レスポンスやセッション情報にはこちらを使う。
 */
export type AdminUserPublic = Omit<AdminUser, "passwordHash">;

// -----------------------------------------------------------------------------
// 内部ユーザー (User) — UUID Cross-Account System
// -----------------------------------------------------------------------------

export interface User {
  /** 主キー (UUIDv4) — 内部UUID */
  id: string;
  /** メールアドレス (識別子) */
  email: string | null;
  /** 電話番号 (識別子) */
  phone: string | null;
  /** 外部システムID */
  externalId: string | null;
  /** 表示名 */
  displayName: string | null;
  /** 作成日時 (ISO 8601) */
  createdAt: string;
  /** 更新日時 (ISO 8601) */
  updatedAt: string;
}

// -----------------------------------------------------------------------------
// LINE アカウント (LineAccount) — マルチアカウント管理
// -----------------------------------------------------------------------------

export interface LineAccount {
  /** 主キー (UUIDv4) */
  id: string;
  /** LINE Channel ID (Messaging API) */
  channelId: string;
  /** アカウント名 */
  name: string;
  /** 新しい値を保存するときだけ送る。保存後のレスポンスには含まれない。 */
  channelAccessToken?: string;
  /** 新しい値を保存するときだけ送る。保存後のレスポンスには含まれない。 */
  channelSecret?: string;
  /** 保存済みかどうかだけを示し、値そのものは返さない。 */
  channelAccessTokenConfigured?: boolean;
  /** 保存済みかどうかだけを示し、値そのものは返さない。 */
  channelSecretConfigured?: boolean;
  /** LINE Login Channel ID. 友だち追加 OAuth 導線で使う. 未設定なら null. */
  loginChannelId: string | null;
  /** 新しい値を保存するときだけ送る。保存後のレスポンスには含まれない。 */
  loginChannelSecret?: string | null;
  /** 保存済みかどうかだけを示し、値そのものは返さない。 */
  loginChannelSecretConfigured?: boolean;
  /** LIFF ID. このアカ向けの LIFF page を開くときに `?liffId=` で識別する. */
  liffId: string | null;
  /** 有効/無効 */
  isActive: boolean;
  /** 統括内で最初に選ぶ既定アカウントか。 */
  isDefault: boolean;
  /** アーカイブ日時。null なら通常利用中。 */
  archivedAt: string | null;
  /** 友だち数の上限。null なら上限を管理しない */
  friendCapacity?: number | null;
  /** 何人で警告を出すか。null なら警告しない */
  capacityWarnAt?: number | null;
  /** 管理画面の一覧やヘッダーで使うアイコン。OGP用の ogDefaultImageUrl とは用途が違う */
  iconUrl?: string | null;
  /** 作成日時 (ISO 8601) */
  createdAt: string;
  /** 更新日時 (ISO 8601) */
  updatedAt: string;
  /** 自由文字列の国/地域名 (例: '日本', 'Japan'). UI で client-side lookup table から国旗 emoji を引く. */
  country: string | null;
  /** 自由文字列の役割タグ (例: '本店', 'プロモ'). UI 表示専用、ロジック非依存. */
  role: string | null;
  /** サイドバーアカ切替および /accounts ページの並び順 (drag-drop で更新). */
  displayOrder: number;
  /** OGP: og:site_name。空欄時は name がフォールバックとして使われる。 */
  ogSiteName: string | null;
  /** OGP: アカウント全体のデフォルト og:description。個別レコードで未設定時に使用。 */
  ogDefaultDescription: string | null;
  /** OGP: アカウント全体のデフォルト og:image。個別レコードで未設定時に使用。 */
  ogDefaultImageUrl: string | null;
  /** LINE公式アカウント構成の上位アカウント。null は未設定（ルート）。 */
  parentLineAccountId: string | null;
  /** 管理画面の一覧で表示する Webhook URL の照合結果。 */
  webhook?: {
    expectedUrl: string;
    actualUrl: string | null;
    active: boolean | null;
    status: 'matched' | 'mismatched' | 'unconfigured' | 'unknown';
  };
}

// -----------------------------------------------------------------------------
// Traffic Pool — マルチアカウント分散先
// -----------------------------------------------------------------------------

export interface TrafficPool {
  id: string;
  slug: string;
  name: string;
  activeAccountId: string | null;
  accountName?: string | null;
  liffId?: string | null;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface PoolAccount {
  id: string;
  poolId: string;
  lineAccountId: string;
  accountName?: string | null;
  liffId?: string | null;
  isActive: boolean;
  createdAt: string;
}

// -----------------------------------------------------------------------------
// Entry Route (リファラルリンク) — 流入経路 1 件
// -----------------------------------------------------------------------------

export interface EntryRoute {
  id: string;
  refCode: string;
  genre: string | null;
  name: string;
  tagId: string | null;
  scenarioId: string | null;
  redirectUrl: string | null;
  poolId: string | null;
  introTemplateId: string | null;
  runAccountFriendAddScenarios: boolean;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface EntryRouteGenre {
  id: string;
  name: string;
  createdAt: string;
  updatedAt: string;
}

export interface CreateEntryRouteInput {
  refCode: string;
  genre?: string | null;
  name: string;
  tagId?: string | null;
  scenarioId?: string | null;
  redirectUrl?: string | null;
  poolId?: string | null;
  introTemplateId?: string | null;
  runAccountFriendAddScenarios?: boolean;
  isActive?: boolean;
}

export interface EntryRouteFunnel {
  click_count: number;
  friend_add_count: number;
  form_submission_count: number;
  cv_count: number;
}

// -----------------------------------------------------------------------------
// LINE 友だちリンク (LineFriend) — LINE userId ↔ 内部UUID マッピング
// -----------------------------------------------------------------------------

export interface LineFriend {
  /** 主キー (UUIDv4) */
  id: string;
  /** LINE ユーザーID (アカウントごとに異なる) */
  lineUserId: string;
  /** LINE アカウントID */
  lineAccountId: string;
  /** 内部ユーザーUUID (紐付け済みの場合) */
  userId: string | null;
  /** 表示名 */
  displayName: string | null;
  /** プロフィール画像URL */
  pictureUrl: string | null;
  /** フォロー中かどうか */
  isFollowing: boolean;
  /** 作成日時 (ISO 8601) */
  createdAt: string;
  /** 更新日時 (ISO 8601) */
  updatedAt: string;
}

// -----------------------------------------------------------------------------
// コンバージョンポイント (ConversionPoint) — CV計測
// -----------------------------------------------------------------------------

/** 成果をどうやって数えるか */
export type ConversionMeasureMethod = "url_reach" | "webhook" | "manual";

export interface ConversionPoint {
  /** 主キー (UUIDv4) */
  id: string;
  /** CV名 */
  name: string;
  /** CV種別 */
  eventType: string;
  /** 金額 (任意) */
  value: number | null;
  /** どうやって数えるか。既定は manual（人が記録する） */
  measureMethod?: ConversionMeasureMethod;
  /** url_reach のときの対象URL。前方一致で判定する */
  targetUrl?: string | null;
  /** 同じ人を何度でも数えるか。false なら一人一回 */
  countRepeat?: boolean;
  /** 成果を紐づける日数。null なら全体の既定（90日） */
  attributionDays?: number | null;
  /** 集計対象を1アカウントに絞る場合。null なら全アカウント */
  lineAccountId?: string | null;
  /** 作成日時 (ISO 8601) */
  createdAt: string;
}

// -----------------------------------------------------------------------------
// コンバージョンイベント (ConversionEvent) — CV記録
// -----------------------------------------------------------------------------

export interface ConversionEvent {
  /** 主キー (UUIDv4) */
  id: string;
  /** コンバージョンポイントID */
  conversionPointId: string;
  /** 友だちID */
  friendId: string;
  /** 内部ユーザーUUID */
  userId: string | null;
  /** アフィリエイトコード */
  affiliateCode: string | null;
  /** メタデータ (JSON) */
  metadata: string | null;
  /** 作成日時 (ISO 8601) */
  createdAt: string;
}

// -----------------------------------------------------------------------------
// アフィリエイト (Affiliate) — アフィリエイト管理
// -----------------------------------------------------------------------------

export interface Affiliate {
  /** 主キー (UUIDv4) */
  id: string;
  /** アフィリエイト名 */
  name: string;
  /** トラッキングコード (ユニーク) */
  code: string;
  /** コミッション率 (0-100) */
  commissionRate: number;
  /** 有効/無効 */
  isActive: boolean;
  /** 連絡先。報酬の連絡に使う。null なら未登録 */
  email?: string | null;
  /** 成果が確定するまでの保留日数。null なら即確定 */
  holdDays?: number | null;
  /** 支払いサイクルの覚書。計算には使わない */
  payoutCycle?: string | null;
  /** 成果が出たときに本人へ知らせるか */
  notifyOnConversion?: boolean;
  /** 作成日時 (ISO 8601) */
  createdAt: string;
}

// -----------------------------------------------------------------------------
// アフィリエイトクリック (AffiliateClick) — クリック記録
// -----------------------------------------------------------------------------

export interface AffiliateClick {
  /** 主キー (UUIDv4) */
  id: string;
  /** アフィリエイトID */
  affiliateId: string;
  /** リファラURL */
  url: string | null;
  /** IPアドレス */
  ipAddress: string | null;
  /** 作成日時 (ISO 8601) */
  createdAt: string;
}

// -----------------------------------------------------------------------------
// 受信Webhook (IncomingWebhook)
// -----------------------------------------------------------------------------

export interface IncomingWebhook {
  id: string;
  name: string;
  sourceType: string;
  // The raw secret is never exposed on list/get/update responses. Callers can
  // only know whether one is currently configured.
  hasSecret: boolean;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

// Returned ONLY from POST /api/webhooks/incoming so the operator can copy the
// generated secret. Subsequent GETs use IncomingWebhook (no `secret`).
export interface IncomingWebhookCreated extends Omit<IncomingWebhook, 'hasSecret' | 'updatedAt'> {
  secret: string;
}

// -----------------------------------------------------------------------------
// 送信Webhook (OutgoingWebhook)
// -----------------------------------------------------------------------------

export interface OutgoingWebhook {
  id: string;
  name: string;
  url: string;
  eventTypes: string[];
  hasSecret: boolean;
  isActive: boolean;
  /** 失敗したとき何回まで送り直すか。0 なら送り直さない */
  maxRetries?: number;
  /** 連続して失敗している回数。成功すると 0 に戻る */
  consecutiveFailures?: number;
  /** 最後に失敗した時刻。成功すると null に戻る */
  lastFailedAt?: string | null;
  createdAt: string;
  updatedAt: string;
}

// Returned ONLY from POST /api/webhooks/outgoing.
export interface OutgoingWebhookCreated extends Omit<OutgoingWebhook, 'hasSecret' | 'updatedAt'> {
  secret: string;
}

export type WebhookInteractionDirection = 'outgoing' | 'incoming';
export type WebhookInteractionStatus = 'pending' | 'succeeded' | 'failed' | 'retried';

/**
 * 外部連携の1回分の安全な表示。URL、シークレット、送受信本文は含めない。
 */
export interface WebhookInteraction {
  id: string;
  direction: WebhookInteractionDirection;
  webhookName: string;
  eventType: string;
  triggerSummary: string;
  status: WebhookInteractionStatus;
  responseLabel: string;
  responseStatus: number | null;
  attemptCount: number;
  durationMs: number | null;
  failureReason: string | null;
  canRetry: boolean;
  startedAt: string;
  completedAt: string | null;
  retryOfId: string | null;
}

export interface WebhookInteractionSummary {
  total: number;
  outgoing: number;
  incoming: number;
  succeeded: number;
  failed: number;
  averageDurationMs: number | null;
}

export interface WebhookInteractionList {
  items: WebhookInteraction[];
  total: number;
  page: number;
  limit: number;
  summary: WebhookInteractionSummary;
}

// -----------------------------------------------------------------------------
// Google Calendar 連携
// -----------------------------------------------------------------------------

export interface GoogleCalendarConnection {
  id: string;
  calendarId: string;
  authType: string;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface CalendarBooking {
  id: string;
  connectionId: string;
  friendId: string | null;
  eventId: string | null;
  title: string;
  startAt: string;
  endAt: string;
  status: "confirmed" | "cancelled" | "completed";
  metadata: string | null;
  createdAt: string;
  updatedAt: string;
}

// -----------------------------------------------------------------------------
// リマインダ (Reminder)
// -----------------------------------------------------------------------------

/** リマインダを動かすきっかけ */
/**
 * リマインダのゴールを何で決めるか。
 *   friend_field … 友だち情報欄の日付（誕生日・次回お届け日・契約更新日）。154 で追加。
 */
export type ReminderTriggerType = "manual" | "booking" | "event" | "friend_field";

export interface Reminder {
  id: string;
  name: string;
  description: string | null;
  isActive: boolean;
  /** きっかけ。manual は従来どおり手で登録する */
  triggerType?: ReminderTriggerType;
  /** 起点を何分ずらすか。null ならずらさない。負の値も使える */
  triggerOffsetMinutes?: number | null;
  /** 起点の時刻を固定する JST の "HH:MM"。null なら予約時刻のまま */
  sendAtTime?: string | null;
  /** 対象を絞るタグ。null なら対象者全員 */
  targetTagId?: string | null;
  /** 153: 'time'（ゴールの○日前の●時）か 'countdown'（残り時間）。**作成後は変えられない。** */
  deliveryMode?: 'time' | 'countdown';
  /** 154: 友だち情報欄の日付を起点にするとき、見る欄。 */
  triggerFieldId?: string | null;
  /** 154: 毎年くり返すか（誕生日なら true）。 */
  repeatYearly?: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface ReminderStep {
  id: string;
  reminderId: string;
  offsetMinutes: number;
  messageType: MessageType;
  messageContent: string;
  /** 153: ゴールから何日ずらすか。配信方式が 'time' のとき使う。 */
  offsetDays?: number | null;
  /** 153: その日の何時に送るか（日本時間の "HH:MM"）。 */
  sendAtTime?: string | null;
  /** 153: 送る中身をテンプレートから選ぶ。 */
  templateId?: string | null;
  createdAt: string;
}

export interface FriendReminder {
  id: string;
  friendId: string;
  reminderId: string;
  targetDate: string;
  status: "active" | "completed" | "cancelled";
  createdAt: string;
  updatedAt: string;
}

// -----------------------------------------------------------------------------
// スコアリング (Lead Scoring)
// -----------------------------------------------------------------------------

export interface ScoringRule {
  id: string;
  name: string;
  eventType: string;
  scoreValue: number;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface FriendScore {
  id: string;
  friendId: string;
  scoringRuleId: string | null;
  scoreChange: number;
  reason: string | null;
  createdAt: string;
}

// -----------------------------------------------------------------------------
// テンプレート (Template)
// -----------------------------------------------------------------------------

export interface Template {
  id: string;
  name: string;
  category: string;
  messageType: string;
  messageContent: string;
  /** 置き場。未分類は null。 */
  folderId: string | null;
  createdAt: string;
  updatedAt: string;
}

// -----------------------------------------------------------------------------
// オペレーター (Operator)
// -----------------------------------------------------------------------------

export interface Operator {
  id: string;
  name: string;
  email: string;
  role: "admin" | "operator";
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

// -----------------------------------------------------------------------------
// チャット (Chat)
// -----------------------------------------------------------------------------

export interface Chat {
  id: string;
  friendId: string;
  operatorId: string | null;
  status: "unread" | "in_progress" | "on_hold" | "resolved";
  notes: string | null;
  revision: number;
  lastMessageAt: string | null;
  createdAt: string;
  updatedAt: string;
}

// -----------------------------------------------------------------------------
// 通知ルール (NotificationRule)
// -----------------------------------------------------------------------------

export interface NotificationRule {
  id: string;
  name: string;
  eventType: string;
  conditions: Record<string, unknown>;
  channels: string[];
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface Notification {
  id: string;
  ruleId: string | null;
  eventType: string;
  title: string;
  body: string;
  channel: string;
  status: "pending" | "sent" | "failed";
  metadata: string | null;
  createdAt: string;
}

export type NotificationCenterCategory = "error" | "update" | "info";

export interface NotificationCenterItem {
  id: string;
  eventType: string;
  category: NotificationCenterCategory;
  title: string;
  body: string;
  metadata: Record<string, unknown> | null;
  isRead: boolean;
  createdAt: string;
}

export interface NotificationCenterData {
  items: NotificationCenterItem[];
  counts: {
    all: number;
    error: number;
    update: number;
    unread: number;
  };
  unreadCount: number;
}

// -----------------------------------------------------------------------------
// Stripe イベント (StripeEvent)
// -----------------------------------------------------------------------------

export interface StripeEvent {
  id: string;
  stripeEventId: string;
  eventType: string;
  friendId: string | null;
  amount: number | null;
  currency: string | null;
  metadata: string | null;
  processedAt: string;
}

// -----------------------------------------------------------------------------
// アカウントヘルス (AccountHealth)
// -----------------------------------------------------------------------------

export interface AccountHealthLog {
  id: string;
  lineAccountId: string;
  errorCode: number | null;
  errorCount: number;
  checkPeriod: string;
  riskLevel: "normal" | "warning" | "danger";
  createdAt: string;
}

export interface AccountMigration {
  id: string;
  fromAccountId: string;
  toAccountId: string;
  status: "pending" | "in_progress" | "completed" | "failed";
  migratedCount: number;
  totalCount: number;
  createdAt: string;
  completedAt: string | null;
}

// -----------------------------------------------------------------------------
// 自動化 (Automation)
// -----------------------------------------------------------------------------

export type AutomationEventType =
  | "friend_add"
  | "tag_change"
  | "score_threshold"
  | "cv_fire"
  | "message_received"
  | "postback_received"
  | "calendar_booked"
  | "ec.order.confirmed"
  | "ec.order.shipped"
  | "ec.subscription.upcoming"
  | "ec.subscription.payment_failed"
  | "ec.subscription.cancelled";

export interface AutomationAction {
  type: "add_tag" | "remove_tag" | "start_scenario" | "send_message" | "send_webhook" | "switch_rich_menu";
  params: Record<string, unknown>;
}

export interface Automation {
  id: string;
  name: string;
  description: string | null;
  eventType: AutomationEventType;
  conditions: Record<string, unknown>;
  actions: AutomationAction[];
  isActive: boolean;
  priority: number;
  // null = global automation (fires for every account, per event-bus.ts:149).
  // UUID = bound to that line_account_id. Surfaced so account-scoped UIs can
  // distinguish a rule that affects every account from one they own.
  lineAccountId: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface AutomationLog {
  id: string;
  automationId: string;
  friendId: string | null;
  eventData: string | null;
  actionsResult: string | null;
  status: "success" | "partial" | "failed";
  createdAt: string;
}

// -----------------------------------------------------------------------------
// スタッフ (StaffMember)
// -----------------------------------------------------------------------------
export interface StaffMember {
  id: string;
  name: string;
  email: string | null;
  role: 'owner' | 'admin' | 'staff' | 'viewer';
  lineLinked: boolean;
  twoFactorEnabled: boolean;
  isActive: boolean;
  permissionKeys: string[];
  notificationPreferences: Record<string, { email: boolean; line: boolean }>;
  inviteStatus: 'pending_email' | 'pending_line' | 'active' | 'expired';
  createdAt: string;
  updatedAt: string;
  /** このログインユーザーの基準となるLINE公式アカウント。nullは従来互換の全体権限。 */
  assignedLineAccountId: string | null;
  /** 基準アカウントより下の子・孫も表示・操作できるか。 */
  canAccessDescendantAccounts: boolean;
  /** 担当範囲。accounts の場合は scopedLineAccountIds に対象店舗が入る。 */
  accountScope?: 'all' | 'accounts';
  scopedLineAccountIds?: string[];
}

export interface StaffProfile {
  id: string;
  name: string;
  role: 'owner' | 'admin' | 'staff' | 'viewer';
  email: string | null;
}

// =============================================================================
// API レスポンスラッパー型
// =============================================================================

/**
 * 汎用 API レスポンス型
 * 成功時は data を持ち、失敗時は error メッセージを持つ
 */
export type ApiResponse<T> =
  | {
      success: true;
      data: T;
    }
  | {
      success: false;
      error: string;
      /** バリデーションエラー等の詳細 (任意) */
      details?: Record<string, string[]>;
    };

/**
 * ページネーション付き API レスポンス型
 * エラーハンドリングが必要な場合は ApiResponse<PaginatedResponse<T>> として使う。
 * 例: `ApiResponse<PaginatedResponse<Friend>>`
 */
export interface PaginatedResponse<T> {
  /** データ一覧 */
  items: T[];
  /** 総件数 */
  total: number;
  /** 現在のページ番号 (1始まり) */
  page: number;
  /** 1ページあたりの件数 */
  limit: number;
  /** 次ページが存在するか */
  hasNextPage: boolean;
}

// ============================================================
// 友だち追加時の配信の振り分け（設計 V2 4-6）
// ============================================================

/**
 * 「はじめての人」をどう見分けるか。
 *
 * 設計の絵は「初回フォロー日が未記録」を既定にしているが、**この環境では
 * 使えない**。マイグレーション 065 が既存の行すべてに初回フォロー日を
 * 埋めたため、未記録の人がもう居ない。既定は `unfollow_count_zero`。
 */
export type FriendAddFirstTimeCriterion =
  | "unfollow_count_zero"
  | "first_followed_at_missing";

/** ①のシナリオをいつ流すか。 */
export type FriendAddTiming =
  /** すぐに配信（1通目が遅延0なら reply で即時に出す） */
  | "immediate"
  /** シナリオの設定どおり（1通目のタイミング指定に従う） */
  | "scenario";

/** ②で何を配信するか。 */
export type FriendAddReturningMode =
  /** 何も送らない */
  | "none"
  /** 別のシナリオを配信する */
  | "other"
  /** はじめての人と同じものを配信する */
  | "same";

/** ②をどこから流すか。 */
export type FriendAddStartPosition =
  /** 最初から */
  | "beginning"
  /** 前回読んだところから（friend_scenarios.current_step_order を引き継ぐ） */
  | "resume";

/**
 * 振り分けと同時に実行すること。
 *
 * **`row` はシナリオのアクションと同じ形。** タグ・友だち情報欄・対応マーク・
 * シナリオ操作・共通情報が、シナリオ側とまったく同じ設定と実行で動く。
 * 以前は `tag` に1つのタグIDを持つだけで、付けることしかできず、
 * フォルダ指定も外すこともできなかった。**同じことを2か所で実装すると、
 * 片方だけ育って必ずずれる**（今夜、一斉配信とシナリオのメッセージ組み立てで
 * 実際に起きた）。
 *
 * `mile` はシナリオ側に無い。友だち追加のときだけ付けたい、という
 * 使い方があるので残す。
 *
 * `tag` は古い形。**読むときに `row` へ直す。**新しく作られることはないが、
 * 既に保存されている設定があるので、消さずに読めるようにしておく。
 */
export type FriendAddAction =
  /** 古い形。読むときに row へ直す。 */
  | { kind: "tag"; tagId: string }
  | { kind: "mile"; amount: number }
  /** シナリオのアクションと同じ。`actionType` と `config` はそちらの定義。 */
  | { kind: "row"; actionType: FriendAddRowActionType; config: unknown };

/** `row` で使えるアクションの種類。シナリオ側と同じ並び。 */
export type FriendAddRowActionType =
  | "tag"
  | "friend_field"
  | "support_mark"
  | "scenario"
  | "common_var";

/** ①または②の設定。 */
export interface FriendAddBranch {
  /** 配信するシナリオ。null は「決めていない」。 */
  scenarioId: string | null;
  actions: FriendAddAction[];
}

/** 画面1枚ぶんの設定。`account_settings.friend_add_routing` に JSON で入る。 */
export interface FriendAddRouting {
  /** ① はじめて友だち追加した人 */
  firstTime: FriendAddBranch & { timing: FriendAddTiming };
  /** ② 以前からの友だち・ブロックを解除した人 */
  returning: FriendAddBranch & {
    mode: FriendAddReturningMode;
    startPosition: FriendAddStartPosition;
  };
  /** ③ 判定の基準 */
  criteria: { firstTime: FriendAddFirstTimeCriterion };
}

export type FriendAddRoutingVersionStatus = "draft" | "published" | "retired";
export type FriendAddRoutingTestStatus = "succeeded" | "failed";

/** 画面が下書き・試験・公開を同じ言葉で扱うための版情報。 */
export interface FriendAddRoutingVersion {
  accountId: string;
  versionId: string;
  versionNumber: number;
  status: FriendAddRoutingVersionStatus;
  routing: FriendAddRouting;
  lastTestStatus: FriendAddRoutingTestStatus | null;
  lastTestedAt: string | null;
  publishedAt: string | null;
}

export interface FriendAddRoutingValidationCheck {
  key: "first_time" | "returning" | "actions" | "duplicate_prevention";
  label: string;
  status: "passed" | "warning" | "failed";
  detail: string;
}

export interface FriendAddRoutingValidation {
  canPublish: boolean;
  /** 公開前に確認できた、選択中LINEアカウントの現在の有効友だち数。 */
  estimatedAudienceCount: number | null;
  checks: FriendAddRoutingValidationCheck[];
  /** 初回と再追加は同じ判定器の排他的な2分岐なので、重複候補は通常0件。 */
  conflicts: Array<{ code: string; message: string }>;
  lastTestStatus: FriendAddRoutingTestStatus | null;
}

export interface FriendAddRoutingDraftTestResult {
  versionId: string;
  displayName: string | null;
  kind: "first_time" | "returning";
  scenarioId: string | null;
  scenarioName: string | null;
  suppressed: boolean;
  actionCount: number;
  /** dry-runなので、登録・配信・タグ付け等の状態変更は常にfalse。 */
  stateChanged: false;
}

export interface FriendAddRoutingPublishResult {
  accountId: string;
  versionId: string;
  versionNumber: number;
  publishedAt: string;
  estimatedAudienceCount: number | null;
  duplicatePrevention: "webhook_event";
  /** 実行結果画面が接続済みのときだけ導線を返す。未接続を404のリンクにしない。 */
  monitoringPath: "/friend-add-settings/runs" | null;
  monitoringUnavailableReason: string | null;
}

/**
 * 既定値。**設定が無いアカウントはここに落ちる。**
 *
 * `returning.mode` を `same` にしてあるのは、**いまの挙動を変えないため**。
 * 設定を入れる前は「相手によらず friend_add シナリオが全部動く」ので、
 * 既定を `none` にすると、設定していないアカウントで配信が止まる。
 */
export const FRIEND_ADD_ROUTING_DEFAULT: FriendAddRouting = {
  firstTime: { scenarioId: null, timing: "immediate", actions: [] },
  returning: {
    scenarioId: null,
    mode: "same",
    startPosition: "beginning",
    actions: [],
  },
  criteria: { firstTime: "unfollow_count_zero" },
};

/** V6の友だち追加履歴。Pencil共通デザインはこの契約だけを見て描画する。 */
export type FriendAddEventKind = "first_time" | "returning";
export type FriendAddEventAttributionStatus = "captured" | "unavailable";
export type FriendAddEventRoutingStatus = "pending" | "completed" | "failed" | "suppressed";

export interface FriendAddEventItem {
  id: string;
  friendId: string;
  displayName: string | null;
  pictureUrl: string | null;
  kind: FriendAddEventKind;
  /** LINEの参考値。正確な初回・再追加判定には使わない。 */
  isUnblockedHint: boolean | null;
  attributionStatus: FriendAddEventAttributionStatus;
  refCode: string | null;
  entryRouteId: string | null;
  entryRouteName: string | null;
  routingStatus: FriendAddEventRoutingStatus;
  occurredAt: string;
  processedAt: string | null;
}

export interface FriendAddEventSummary {
  total: number;
  firstTime: number;
  returning: number;
  captured: number;
  unavailable: number;
  pending: number;
  failed: number;
}

export interface FriendAddEventList {
  items: FriendAddEventItem[];
  summary: FriendAddEventSummary;
  nextCursor: string | null;
}

/** 見た目から独立した画面状態。V6の共通スケルトン・空表示・エラー表示へ対応する。 */
export type FriendAddEventViewState =
  | { status: "loading" }
  | { status: "empty"; summary: FriendAddEventSummary }
  | { status: "ready"; data: FriendAddEventList }
  | { status: "error"; message: string };

/** 自動応答の公開前に固定する編集内容。保存しても本番ルールは変わらない。 */
export interface AutoReplyDraftInput {
  keyword: string;
  matchType: "exact" | "contains";
  responseType: string;
  responseContent: string;
  templateId: string | null;
  lineAccountId: string;
  activeFrom: string | null;
  activeUntil: string | null;
  cooldownMinutes: number | null;
  skipWhenOperatorActive: boolean;
  priority: number;
  messageKinds: string[] | null;
  friendConditions: Record<string, unknown> | null;
  actions: unknown[] | null;
  responseWeekdays: number[] | null;
  responseHolidayRule: "ignore" | "include" | "exclude" | null;
  oncePerFriend: boolean;
  keywords: Array<{
    keyword: string;
    matchType?: "exact" | "contains";
    minLength?: number;
    caseSensitive?: boolean;
  }> | null;
  respondToAll: boolean;
  name: string | null;
  keywordMatchMode: "any" | "all";
  folderId: string | null;
}

export interface AutoReplyDraftVersion {
  autoReplyId: string;
  versionId: string;
  versionNumber: number;
  status: "draft" | "published" | "retired";
  settings: AutoReplyDraftInput;
  lastTestStatus: "succeeded" | "failed" | null;
  lastTestedAt: string | null;
  publishedAt: string | null;
}

export type AutoReplyTestReasonCode =
  | "message_kind_not_matched"
  | "keyword_not_matched"
  | "outside_active_window"
  | "weekday_not_allowed"
  | "operator_handling"
  | "already_replied_once"
  | "cooldown_active"
  | "friend_conditions_not_met";

export interface AutoReplyConflict {
  autoReplyId: string;
  name: string;
  certainty: "certain" | "possible";
  winnerAutoReplyId: string;
  reason: string;
}

export interface AutoReplyValidationResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
  conflicts: AutoReplyConflict[];
  lastTestStatus: "succeeded" | "failed" | null;
}

export interface AutoReplyDryRunResult {
  matched: boolean;
  draftWon: boolean;
  winner: {
    autoReplyId: string;
    name: string;
    responseType: string;
    responseContent: string;
  } | null;
  candidates: Array<{
    autoReplyId: string;
    name: string;
    priority: number;
    result: "not_matched" | "skipped" | "won";
    reasonCodes: AutoReplyTestReasonCode[];
  }>;
  actions: Array<{ kind: string }>;
  stateChanged: false;
}

export interface AutoReplyPublishResult {
  autoReplyId: string;
  versionId: string;
  versionNumber: number;
  publishedAt: string;
  acknowledgedConflictIds: string[];
}

export type ReminderLifecycleStatus = "draft" | "published" | "stopped";

export interface ReminderStopConditions {
  bookingCancelled: boolean;
  supportMarkCompleted: boolean;
  daysAfterTarget: number | null;
  friendBlocked: boolean;
}

export interface ReminderDraftStep {
  stableStepId: string;
  offsetMinutes: number;
  messageType: MessageType;
  messageContent: string;
  offsetDays?: number | null;
  sendAtTime?: string | null;
  templateId?: string | null;
  targetCondition?: Record<string, unknown>;
  action?: Record<string, unknown>;
}

export interface ReminderDraftSettings {
  name: string;
  description?: string | null;
  lineAccountId: string;
  triggerType: ReminderTriggerType;
  deliveryMode: "time" | "countdown";
  triggerFieldId?: string | null;
  repeatYearly?: boolean;
  triggerOffsetMinutes?: number | null;
  sendAtTime?: string | null;
  targetTagId?: string | null;
  folderId?: string | null;
  stopConditions: ReminderStopConditions;
  steps: ReminderDraftStep[];
}

export interface ReminderDraftVersion {
  reminderId: string;
  versionId: string;
  versionNumber: number;
  status: "draft" | "published" | "superseded";
  settings: ReminderDraftSettings;
  lastTestStatus: "succeeded" | "failed" | null;
  lastTestedAt: string | null;
  publishedAt: string | null;
}

export interface ReminderValidationResult {
  valid: boolean;
  checks: Array<{
    key: string;
    label: string;
    status: "passed" | "failed" | "warning";
    message: string;
  }>;
  audience: { matched: number | null; excluded: number | null };
}

export interface ReminderPreviewResult {
  targetDate: string;
  items: Array<{
    stableStepId: string;
    stepNumber: number;
    scheduledAt: string;
    label: string;
    state: "scheduled" | "past" | "duplicate";
  }>;
  summary: {
    audience: number | null;
    next7Days: number | null;
    next30Days: number | null;
    duplicateCount: number;
  };
}

export interface ReminderPublishResult {
  reminderId: string;
  versionId: string;
  versionNumber: number;
  publishedAt: string;
  audience: number | null;
  plannedDeliveries: number | null;
  nextScheduledAt: string | null;
}

/** 7機能の実行記録画面で共通に使う所有元。書込台帳は機能ごとに安全に保つ。 */
export type ExecutionOwnerKind =
  | "broadcast"
  | "reminder"
  | "scenario"
  | "auto_reply"
  | "manual"
  | "user"
  | "automation"
  | "notification"
  | "integration";

export type ExecutionRunStatus =
  | "succeeded"
  | "failed"
  | "partial"
  | "skipped"
  | "pending"
  | "cancelled";

/** リマインダの書込台帳だけが持つ詳細状態。共通状態へ潰さず保存する。 */
export type ReminderDeliveryRunStatus =
  | "planned"
  | "claimed"
  | "succeeded"
  | "skipped"
  | "retry_wait"
  | "permanent_failed"
  | "cancelled";

export interface ExecutionRunIdentity {
  ownerKind: ExecutionOwnerKind;
  ownerId: string;
  lineAccountId: string | null;
}

/** 7機能の実行記録一覧が共通で読む9項目。 */
export interface ExecutionRunListItem extends ExecutionRunIdentity {
  occurredAt: string;
  subject: string | null;
  accountLabel: string | null;
  triggerLabel: string;
  reference: string | null;
  status: ExecutionRunStatus;
  detail: string | null;
  durationMs: number | null;
  canRetry: boolean;
}

export interface ReminderDeliveryRun extends ExecutionRunListItem {
  id: string;
  reminderId: string;
  friendReminderId: string;
  friendId: string;
  friendName: string | null;
  reminderStepId: string;
  stepNumber: number;
  scheduledAt: string;
  startedAt: string | null;
  completedAt: string | null;
  domainStatus: ReminderDeliveryRunStatus;
  attemptCount: number;
  nextRetryAt: string | null;
  lastErrorCode: string | null;
  lastErrorMessage: string | null;
  /** LINEが返した要求ID。取れなかった場合はnullのままにし、作らない。 */
  lineRequestId: string | null;
  /** 実際に送った本文へ辿るためのmessages_log ID。成功前はnull。 */
  messageLogId: string | null;
}

export interface ReminderDeliveryRunsResponse {
  reminder: {
    id: string;
    name: string;
    isActive: boolean;
  };
  summary: {
    sent: number;
    scheduled: number;
    stopped: number;
    errors: number;
    targetCount: number;
    nextScheduledAt: string | null;
  };
  steps: Array<{
    id: string;
    stepNumber: number;
    offsetMinutes: number;
    messageType: MessageType;
    messageContent: string;
    sent: number;
    /** LINE Messaging APIは友だち単位の既読を返さないため、null。 */
    openRate: number | null;
    errors: number;
  }>;
  items: ReminderDeliveryRun[];
  pagination: {
    total: number;
    limit: number;
    offset: number;
  };
}

/** 自動応答の書込台帳が持つ詳細状態。実行の途中と最終結果を混ぜない。 */
export type AutoReplyEvaluationStatus =
  | "received"
  | "evaluated"
  | "matched"
  | "skipped"
  | "reply_accepted"
  | "reply_failed"
  | "actions_running"
  | "completed"
  | "partial_failed"
  | "failed";

export interface AutoReplyRun extends ExecutionRunListItem {
  id: string;
  autoReplyId: string | null;
  autoReplyName: string | null;
  friendId: string;
  friendName: string | null;
  messageKind: string;
  inputPreview: string | null;
  matchedKeyword: string | null;
  versionNumber: number | null;
  domainStatus: AutoReplyEvaluationStatus;
  replyStatus: "not_attempted" | "accepted" | "failed";
  actionSummary: Record<string, number>;
  lineRequestId: string | null;
}

export interface AutoReplyRunsResponse {
  rule: {
    id: string | null;
    name: string;
    isActive: boolean | null;
    priorityPosition: number | null;
  };
  summary: {
    monthHits: number;
    totalHits: number;
    handovers: number;
    errors: number;
    lastRunAt: string | null;
    averageResponseMs: number | null;
  };
  handovers: {
    waiting: number;
    inProgress: number;
    completed: number;
  };
  triggerBreakdown: Array<{
    trigger: string;
    count: number;
    share: number | null;
  }>;
  items: AutoReplyRun[];
  pagination: {
    total: number;
    limit: number;
    offset: number;
  };
}
