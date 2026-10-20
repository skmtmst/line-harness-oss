


export type AutoReplyEvaluationStatus =
  | 'received'
  | 'evaluated'
  | 'matched'
  | 'skipped'
  | 'reply_accepted'
  | 'reply_failed'
  | 'actions_running'
  | 'completed'
  | 'partial_failed'
  | 'failed';

export interface AutoReplyVersionRow {
  id: string;
  auto_reply_id: string;
  version_number: number;
  line_account_id: string | null;
  definition_snapshot: string;
  status: 'draft' | 'published' | 'retired';
  published_at: string | null;
  published_by_staff_id: string | null;
  last_test_status: 'succeeded' | 'failed' | null;
  last_tested_at: string | null;
  last_tested_by_staff_id: string | null;
  publish_idempotency_key: string | null;
  created_at: string;
  updated_at: string | null;
}

/**
 * 編集中の定義。JSON文字列の列は解釈せず、そのまま版へ固定する。
 * 公開時にだけ auto_replies の実行中定義へ反映する。
 */
export interface AutoReplyDraftSettings {
  keyword: string;
  matchType: 'exact' | 'contains';
  responseType: string;
  responseContent: string;
  templateId: string | null;
  lineAccountId: string | null;
  activeFrom: string | null;
  activeUntil: string | null;
  cooldownMinutes: number | null;
  skipWhenOperatorActive: boolean;
  priority: number;
  messageKinds: string | null;
  /** 受信経路。版スナップショットだけに保存し、既存版は LINE として読む。 */
  receiveSources: Array<'line' | 'email'>;
  friendConditions: string | null;
  actions: string | null;
  responseWeekdays: string | null;
  responseHolidayRule: string | null;
  oncePerFriend: boolean;
  keywords: string | null;
  respondToAll: boolean;
  name: string | null;
  keywordMatchMode: string;
  normalizeKeywords?: boolean;
  folderId: string | null;
  /** 運用者だけが読むメモ。友だちへ送る本文には使わない。 */
  internalMemo?: string | null;
  /** 将来の遅延実行に渡す設定値。この保存口だけでは実行しない。 */
  replyDelaySeconds?: number | null;
  /** 条件不一致時に行う別動作。この保存口だけでは実行しない。 */
  unmatchedAction?: string | null;
}

export interface AutoReplyEvaluationRow {
  id: string;
  incoming_event_id: string;
  incoming_message_log_id: string | null;
  line_account_id: string | null;
  friend_id: string;
  message_kind: string;
  normalized_text_hash: string;
  input_preview_masked: string | null;
  evaluated_at: string;
  completed_at: string | null;
  winning_auto_reply_id: string | null;
  winning_version_id: string | null;
  status: AutoReplyEvaluationStatus;
  skip_reason: string | null;
  matched_keyword: string | null;
  reply_status: 'not_attempted' | 'accepted' | 'failed';
  line_request_id: string | null;
  message_log_id: string | null;
  action_summary: string | null;
  error_code: string | null;
  duration_ms: number | null;
  created_at: string;
  updated_at: string;
}

/**
 * m26c R556/R570: 作成・複製の要求キー台帳（migration 543）。
 * 直接作成（'rule'）と下書き付き作成（'draft'）を同じ表で受け、同じ
 * Idempotency-Key の再送は保存済みを返し、異なる内容・別操作の使い回しは
 * 作らず止める。共通ルールの所属は NULL でも重複を防げるよう、
 * キーは表全体で一意にする。
 */
export type AutoReplyCreateOperation = 'rule' | 'draft';

export interface AutoReplyCreateIdempotency {
  key: string;
  fingerprint: string;
}

export interface AutoReplyCreateClaim {
  operation: string;
  request_fingerprint: string;
  auto_reply_id: string;
  version_id: string | null;
}

export type AutoReplyActionRunStatus =
  | 'queued'
  | 'claimed'
  | 'succeeded'
  | 'skipped'
  | 'retry_wait'
  | 'permanent_failed'
  | 'cancelled';

export interface AutoReplyActionRunRow {
  id: string;
  evaluation_id: string;
  action_stable_id: string;
  action_version: number;
  action_type: string;
  action_snapshot: string;
  idempotency_key: string;
  status: AutoReplyActionRunStatus;
  attempt_count: number;
  last_error_code: string | null;
  result_json: string | null;
  started_at: string | null;
  completed_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface RecomputedAutoReplyOutcome {
  status: AutoReplyEvaluationStatus;
  actionSummary: Record<string, number>;
}

export interface AutoReplyRunListRow extends AutoReplyEvaluationRow {
  friend_name: string | null;
  account_label: string | null;
  rule_name: string | null;
  rule_keyword: string | null;
  rule_priority: number | null;
  version_number: number | null;
  candidate_result: 'not_matched' | 'skipped' | 'won' | null;
  candidate_reason_codes: string | null;
  /** 再実行できる失敗済みの処理行が残っているか（0/1）。 */
  has_failed_action_run: number;
  /** 確保済み・待機中の処理行が残っているか（0/1）。生きている再実行の目印。 */
  has_inflight_action_run: number;
}

export interface AutoReplyRunSummary {
  monthHits: number;
  totalHits: number;
  handovers: number;
  errors: number;
  lastRunAt: string | null;
  averageResponseMs: number | null;
  handoverWaiting: number;
  handoverInProgress: number;
  handoverCompleted: number;
}
