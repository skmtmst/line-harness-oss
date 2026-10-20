import type { MessageType } from './messages.js';
import type { ExecutionRunListItem } from './execution-runs.js';

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
  /** 受信経路。空は許さず、既存版は LINE として読む。 */
  receiveSources: Array<"line" | "email">;
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
  /** true（既定）: 全角半角・大小文字・前後空白をそろえる。false: そのまま当てる。 */
  normalizeKeywords?: boolean;
  folderId: string | null;
  /** 管理者だけが読む補足。友だちへ送る本文には含めない。 */
  internalMemo: string | null;
  /** 受信してから返信するまで待つ秒数。null は即時。 */
  replyDelaySeconds: number | null;
  /** 条件に一致しなかったときの後続処理。 */
  unmatchedAction: Record<string, unknown> | null;
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
  /** 過去28日の実測一致数。集計できなかったときは null。 */
  matchedLast28Days?: number | null;
}

export type AutoReplyTestReasonCode =
  | "message_kind_not_matched"
  | "keyword_not_matched"
  | "outside_active_window"
  | "weekday_not_allowed"
  | "operator_handling"
  | "already_replied_once"
  | "cooldown_active"
  | "friend_conditions_not_met"
  /** 同じ検証文に当たったが、先に動くルールがあるため実行されない。 */
  | "higher_priority_won";

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
  /**
   * 試した友だちのトークが「対応中」か。
   * 有人対応の抑止が効く状態かを画面で説明するために返す。
   */
  operatorActive: boolean;
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
    /** 「担当者が対応中のトークでは返さない」設定のルールか。抑止対象の明示に使う。 */
    suppressWhenOperatorActive: boolean;
  }>;
  actions: Array<{ kind: string }>;
  stateChanged: false;
  /**
   * m26c R552: 試験の記録直前に下書きが編集されていたら true。
   * この結果は古い内容のものなので、公開条件に使わず再試験を求める。
   */
  staleTest?: boolean;
}

export interface AutoReplyPublishResult {
  autoReplyId: string;
  versionId: string;
  versionNumber: number;
  publishedAt: string;
  acknowledgedConflictIds: string[];
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
  /** 送達不明を通常の失敗と区別する台帳の理由。 */
  errorCode?: string | null;
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

export interface AutoReplyOperatorNotificationConfig { notificationRuleId: string; notificationRuleVersion: number; message: string }
