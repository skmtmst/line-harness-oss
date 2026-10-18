import type { Folder } from './folders.js';

// -----------------------------------------------------------------------------
// LINE アカウント (LineAccount) — マルチアカウント管理
// -----------------------------------------------------------------------------

export interface LineAccountTagSummary {
  id: string; name: string; color: string | null; displayOrder?: number
}

export interface LineAccountTagInput {
  name: string; color?: string | null; displayOrder?: number
}

export interface LineAccountFolderList { folders: Folder[]; total: number; unclassifiedCount: number }

export type LineAccountFolderInput = Pick<Folder,'name'> & Partial<Pick<Folder,'color'|'displayOrder'>>;

export interface LineAccount {
  folderId?: string | null;
  folder?: Folder | null;
  /** 統括内での分類。友だちタグとは別。 */
  tags?: LineAccountTagSummary[];
  /** 表示と新しい日時入力に使う IANAタイムゾーン。 */
  timezone?: string;
  /** 主キー (UUIDv4) */
  id: string;
  /** LINE Channel ID (Messaging API) */
  channelId: string;
  /** アカウント名 */
  name: string;
  /** LINE公式アカウントに設定された表示名。未同期時は運用名。 */
  displayName?: string;
  /** LINE公式アカウントの公開画像。 */
  pictureUrl?: string | null;
  /** LINE公式アカウントのベーシックID。 */
  basicId?: string | null;
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
  channelAccessTokenLast4: string | null;
  channelAccessTokenUpdatedAt: string | null;
  channelSecretLast4: string | null;
  channelSecretUpdatedAt: string | null;
  loginChannelSecretLast4: string | null;
  loginChannelSecretUpdatedAt: string | null;
  /** 統括内で最初に選ぶ既定アカウントか。 */
  isDefault: boolean;
  /** アーカイブ日時。null なら通常利用中。 */
  archivedAt: string | null;
  /** 止めた理由の区分（manual | ban_detected | credential_invalid）。動いていれば null。 */
  inactiveReason?: string | null;
  /** 止めた理由の本文。動いていれば null。 */
  inactiveReasonDetail?: string | null;
  /** 止めた日時。 */
  inactivatedAt?: string | null;
  /** 最後にWebhookを受け取った日時。届かない警告の判定に使う。 */
  lastWebhookReceivedAt?: string | null;
  /** Webhook届かない警告を出さないアカウントか。 */
  webhookSilenceExempt?: boolean;
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
  stats?: {
    friendCount: number;
    activeScenarios: number;
    messagesThisMonth: number;
    staffCount: number;
  };
  connection?: {
    /** 一覧APIの最新接続判定。 */
    status?: 'ok' | 'warn' | 'unknown';
    checkedAt?: string | null;
    /** 詳細APIのWebhook試験・受信履歴。 */
    lastTestAt?: string | null;
    lastTestStatus?: 'succeeded' | 'failed' | null;
    lastReceivedAt?: string | null;
  };
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

export interface LineAccountConnectInput {
  style?: import('../style-api.js').AccountStyle;
 name?: string; channelId: string; channelSecret: string; loginChannelId: string; loginChannelSecret: string
 tagIds?: string[]; parentLineAccountId?: string | null; staffIds?: string[]; liffId?: string
}

export interface LineAccountRegistrationTags { tagIds?: string[] }

export interface LineAccountRegistrationTag { id: string; name: string; color: string | null }
