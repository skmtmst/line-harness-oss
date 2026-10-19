

// リマインダ配信クエリヘルパー

export interface ReminderRow {
  id: string;
  name: string;
  description: string | null;
  is_active: number;
  /** manual / booking / event。manual は従来どおり手で登録する */
  trigger_type: string;
  /** 起点を何分ずらすか。null ならずらさない */
  trigger_offset_minutes: number | null;
  /** 起点の時刻を固定する JST の HH:MM。null なら予約時刻のまま */
  send_at_time: string | null;
  /** 対象を絞るタグ。null なら対象者全員 */
  target_tag_id: string | null;
  line_account_id: string | null;
  created_at: string;
  updated_at: string;
  /** 153: 'time'（○日前の●時）か 'countdown'（何分ずらすか）。作成後は変えない。 */
  delivery_mode: string;
  /** 154: 友だち情報欄の日付を起点にするとき、見る欄。 */
  trigger_field_id: string | null;
  /** 418: イベント起点のとき絞るイベント。null は全イベントが起点。 */
  trigger_event_id: string | null;
  /** 154: 毎年くり返すか。 */
  repeat_yearly: number;
  /** 419: 2月29日が基準日のとき、平年にいつ扱うか。 */
  leap_year_policy: 'feb28' | 'mar1' | 'skip';
  /** 156: フォルダ。null は未分類。消しても未分類に戻るだけ。 */
  folder_id: string | null;
  /** 161: 並び順。同じ値のときは created_at の新しい順。 */
  display_order: number;
  /** 268: 削除後も送信履歴を残す。値がある行は通常画面・実行対象から外す。 */
  deleted_at: string | null;
  lifecycle_status: 'draft' | 'published' | 'stopped';
  current_draft_version_id: string | null;
  current_published_version_id: string | null;
}

export interface ReminderStepRow {
  id: string;
  reminder_id: string;
  offset_minutes: number;
  message_type: string;
  message_content: string;
  created_at: string;
  /** 153: ゴールから何日前（負）／何日後（正）。delivery_mode='time' のとき見る。 */
  offset_days: number | null;
  /** 153: その日の何時（日本時間の "HH:MM"）。 */
  send_at_time: string | null;
  /** 153: 送る中身をテンプレートから選ぶ。 */
  template_id: string | null;
}

export interface FriendReminderRow {
  id: string;
  friend_id: string;
  reminder_id: string;
  target_date: string;
  status: string;
  created_at: string;
  updated_at: string;
  reminder_version_id: string | null;
  /**
   * R346: 登録時に使っていたテンプレートの公開版。
   * {"テンプレートID": 公開版番号} の JSON。NULL は今までどおり最新の版を読む。
   */
  template_version_snapshot: string | null;
  source_kind: string;
  source_id: string | null;
  source_event_id: string | null;
  timezone: string;
  cancel_reason: string | null;
  completed_at: string | null;
  lock_version: number;
}

/**
 * リマインダ側から見る登録者の行。friend_reminders だけでは一覧に表示する
 * 名前が分からないため、friends と同じアカウントで結合して返す。
 */
export interface ReminderRegistrantRow extends FriendReminderRow {
  friend_name: string | null;
  friend_line_account_id: string | null;
}

export type ReminderRegistrantMutation =
  | { state: 'updated' | 'replayed'; row: FriendReminderRow }
  | { state: 'conflict' | 'not_found' };

/**
 * R348/R349: 行ごとの送信元アカウントで絞るための担当範囲。
 * getVisibleLineAccountScope と同じ形。未指定なら従来の条件のまま
 * （親ルールと友だちの所属一致）。経路側は必ず渡す。
 */
export interface ReminderRowScope {
  allowedAccountIds: string[];
  canSeeUnassigned: boolean;
}

export interface ReminderDraftStepInput {
  stableStepId: string;
  offsetMinutes: number;
  messageType: string;
  messageContent: string;
  offsetDays?: number | null;
  sendAtTime?: string | null;
  templateId?: string | null;
  targetCondition?: Record<string, unknown>;
  action?: Record<string, unknown>;
}

/** 対象の絞り込み条件。SegmentCondition と同じ形 (operator/rules/groups)。 */
export interface ReminderTargetCondition {
  operator: 'AND' | 'OR';
  rules: Array<{ type: string; value: unknown }>;
  groups?: ReminderTargetCondition[];
}

export interface ReminderDraftSettings {
  name: string;
  description?: string | null;
  lineAccountId: string;
  triggerType: 'manual' | 'booking' | 'event' | 'friend_field';
  deliveryMode: 'time' | 'countdown';
  triggerFieldId?: string | null;
  /** 418: イベント起点のとき絞るイベント。null/未指定は全イベント。 */
  triggerEventId?: string | null;
  repeatYearly?: boolean;
  /** 419: 2月29日が基準日のときの平年の扱い。 */
  leapYearPolicy?: 'feb28' | 'mar1' | 'skip';
  triggerOffsetMinutes?: number | null;
  sendAtTime?: string | null;
  targetTagId?: string | null;
  /**
   * 対象の絞り込み条件 (SegmentCondition と同じ形)。あるときは
   * targetTagId よりこちらが勝つ。settings_snapshot の JSON にだけ持つ。
   */
  targetCondition?: ReminderTargetCondition | null;
  folderId?: string | null;
  stopConditions: {
    bookingCancelled: boolean;
    supportMarkCompleted: boolean;
    daysAfterTarget: number | null;
    friendBlocked: boolean;
  };
  steps: ReminderDraftStepInput[];
}

export interface ReminderVersionRow {
  id: string;
  reminder_id: string;
  version_number: number;
  status: 'draft' | 'published' | 'superseded';
  settings_snapshot: string;
  last_test_status: 'succeeded' | 'failed' | null;
  last_tested_at: string | null;
  last_tested_by_staff_id: string | null;
  published_at: string | null;
  published_by_staff_id: string | null;
  created_at: string;
  updated_at: string;
}

export type ReminderDeliveryRunStatus =
  | 'queued'
  | 'claimed'
  | 'succeeded'
  | 'skipped'
  | 'retry_wait'
  | 'permanent_failed'
  | 'cancelled';

export interface ReminderDeliveryRunRow {
  id: string;
  line_account_id: string | null;
  reminder_id: string;
  friend_reminder_id: string;
  friend_id: string;
  reminder_step_id: string;
  scheduled_at: string;
  idempotency_key: string;
  line_retry_key: string;
  status: ReminderDeliveryRunStatus;
  attempt_count: number;
  retry_cycle_attempt_count: number;
  next_retry_at: string | null;
  lease_expires_at: string | null;
  last_error_code: string | null;
  last_error_message: string | null;
  line_request_id: string | null;
  message_log_id: string | null;
  /**
   * R345: 初回に送った本文（差し込み済み）と使った版。
   * 同じ再試行キーの再送はここから送り、履歴もここから残す。
   * NULL は「まだ送っていない」→今までどおり最新の内容で作る。
   */
  sent_message_type: string | null;
  sent_message_content: string | null;
  sent_template_id: string | null;
  sent_template_version: number | null;
  manual_retry_key: string | null;
  started_at: string | null;
  completed_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface ReminderTriggerInput {
  triggerType?: 'manual' | 'booking' | 'event' | 'friend_field';
  /** 153: 'time'（ゴールの○日前の●時）か 'countdown'（何分ずらすか）。作成後は変えない。 */
  deliveryMode?: 'time' | 'countdown';
  /** 154: 友だち情報欄の日付を起点にするとき、どの欄を見るか。 */
  triggerFieldId?: string | null;
  /** 418: イベント起点のとき絞るイベント。null/未指定は全イベント。 */
  triggerEventId?: string | null;
  /** 154: 毎年くり返すか（誕生日なら true）。 */
  repeatYearly?: boolean;
  /** 419: 2月29日が基準日のときの平年の扱い。 */
  leapYearPolicy?: 'feb28' | 'mar1' | 'skip';
  triggerOffsetMinutes?: number | null;
  sendAtTime?: string | null;
  targetTagId?: string | null;
  /** 156: フォルダ。null は未分類。 */
  folderId?: string | null;
}

export interface ResumeExpectedRun {
  reminderStepId: string;
  scheduledAt: string;
}

// =============================================================================
// N-065: 予約・イベント・Meet の取消/日程変更を リマインダへ同期
// =============================================================================
//
// 予約時には enrollByTrigger が friend_reminders を作るが、取消・日程変更は
// 旧表 (booking_reminders / event_booking_reminders / meet_consultation_reminders)
// だけを止めていた。の未送信予定が残り、取消客へ旧日程の通知が届き得る。
//
// 約束:
// - 未送信 (active な登録と queued / retry_wait の実行行) だけを止める。
//   送信済み履歴 (succeeded / friend_reminder_deliveries) は残す。
//   claimed は送信中だが、取消後に送らないよう止める。送信直前にも登録の
//   active を再確認し (reminder-delivery 側)、取消済みなら送らない。
// - 取消理由・元イベントID・実行者を cancel_reason に残す (移行なしで追跡するため)。
// - 同じ取消・変更通知の再送は何も変えない (active が無ければ 0 件で返す)。
//   ただし failOnSendInFlight 指定では、書換え後に最初に選んだ全 ID が
//   非 active か確かめ、1件でも残れば投げる (部分割込みの 0 件成功にしない。
//   呼び出し側は状態を巻き戻して再試行させる)。
// - lineAccountId を渡したときは、そのアカウントの友だちの登録だけを見る。
// - 移行前の行 (source 未記録) を探すときは、同時刻の別予約・手動登録を
//   巻き込まないよう source 未記録かつ同じきっかけ種別の行だけを見る。

export interface V6SourceMatcher {
  sourceKind?: string | null;
  sourceId?: string | null;
  sourceEventId?: string | null;
  /** 移行前の行 (source 未記録) 用の予備鍵。source 連動が1件も無いときだけ使う。 */
  friendId?: string | null;
  /** 移行前の行用の起点候補 (呼び出し側がルールから計算した target_date)。 */
  targetDates?: string[];
  lineAccountId?: string | null;
  /**
   * false のとき移行前の行を探さない。個別相談のように、
   * 移行前に行を作っていなかった発生元が同時刻の別予約へ触れないため。
   */
  allowLegacyFallback?: boolean;
}

export interface CancelV6RemindersResult {
  cancelledEnrollments: number;
  cancelledRuns: number;
}

/**
 * 共有 書込みの版ガード。呼び出し側が所有権の EXISTS 述語を渡し、
 * 各書込み文に AND で結び付ける。親が動いていたらその文は 0 件になる。
 * 省略時は従来どおり無条件。
 */
export interface V6WriteGuard {
  sql: string;
  binds: unknown[];
}

export interface V6TargetDateMove {
  reminderId?: string;
  fromTargetDate: string;
  toTargetDate: string;
}

export interface RescheduleV6RemindersResult {
  movedEnrollments: number;
  cancelledRuns: number;
}

export interface ReminderDeliveryRunSentPayload {
  messageType: string;
  messageContent: string;
  templateId: string | null;
  templateVersion: number | null;
}

export type RetryReminderDeliveryRunResult =
  | { kind: 'scheduled'; run: ReminderDeliveryRunRow }
  | { kind: 'replay'; run: ReminderDeliveryRunRow }
  | { kind: 'conflict'; run: ReminderDeliveryRunRow };

export interface ReminderDeliveryRunListRow extends ReminderDeliveryRunRow {
  friend_name: string | null;
  account_label: string | null;
  step_number: number;
}

export interface ReminderDeliveryStepSummaryRow {
  id: string;
  offset_minutes: number;
  message_type: string;
  message_content: string;
  sent: number;
  errors: number;
}

// =============================================================================
// 友だち情報欄の日付を起点にする（154）
// =============================================================================

export interface FriendFieldReminderRow {
  id: string;
  name: string;
  trigger_field_id: string | null;
  repeat_yearly: number;
  leap_year_policy: 'feb28' | 'mar1' | 'skip';
  line_account_id: string | null;
  scan_cursor: string | null;
}
