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

export interface EcIdentityCandidateSummary {
  unmatched: number;
  candidates: number;
  candidateExternalCustomers: number;
  withoutCandidates?: number;
  duplicateSuspicions: number;
  linked: number;
  /** pending候補の全件合計。同一EC会員は1回、金額未取得はnull。 */
  potentialRevenue: number | null;
}

/** 有効友だちの比較。記録が欠けている場合は推定せずnull。 */
export interface FriendActiveMonthComparison {
  activeLastMonth: number | null;
  activeMonthDelta: number | null;
  activeComparisonDate: string;
}

/** 友だちに進行中の配信・処理。日時未確定と件数不明は null。 */
export interface FriendUpcomingItem {
  kind: 'scenario' | 'reminder' | 'broadcast' | 'automation';
  id: string;
  name: string;
  scheduledAt: string | null;
  sentCount: number | null;
  totalCount: number | null;
  href: string;
  /** 一斉配信の対象条件を評価した日時。送信時には再判定される。 */
  audienceEvaluatedAt?: string;
}

/** 直近90日の友だち集計。率は0〜1、分母0はnull。金額は通貨の最小単位。 */
export interface FriendSummary {
  periodDays: 90;
  from: string;
  to: string;
  deliveryOpenRate90Days: number | null;
  deliveryOpenMeasuredCount90Days: number;
  purchases90Days: {
    count: number;
    /** 複数通貨・金額不明はnull。購入なしは0。取消・全額返金を除き、部分返金を引く。 */
    totalAmountMinor: number | null;
    currency: string | null;
    byCurrency: Array<{ currency: string; count: number; totalAmountMinor: number | null }>;
  } | null;
}
