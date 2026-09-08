/**
 * リマインダを自動で登録する。
 *
 * これまで対象の登録は POST /api/reminders/:id/enroll/:friendId の手動だけで、
 * 「予約の前日に送る」を表すには、予約が入るたびに人が登録する必要があった。
 *
 * 送る時刻そのものは reminder_steps.offset_minutes が持っている。ここで決めるのは
 * その起点（friend_reminders.target_date）だけ。二重に時間の計算を持たせると、
 * どちらが効いているのか読めなくなる。
 */

import {
  cancelV6RemindersForSource,
  enrollFriendInReminder,
  rescheduleV6RemindersForSource,
  type CancelV6RemindersResult,
  type RescheduleV6RemindersResult,
} from '@line-crm/db';

export type ReminderTriggerType = 'manual' | 'booking' | 'event';

export interface ReminderTriggerRow {
  id: string;
  trigger_type: string;
  trigger_offset_minutes: number | null;
  send_at_time: string | null;
  target_tag_id: string | null;
  current_published_version_id: string | null;
}

const JST_OFFSET_MS = 9 * 60 * 60 * 1000;

/**
 * 起点の時刻を決める。
 *
 * 1. 予約・イベントの開始時刻を基準にする
 * 2. trigger_offset_minutes があればずらす（施術後の追客なら終了時刻へ寄せる、など）
 * 3. send_at_time があれば、その日のその時刻に合わせる
 *
 * 3 を入れているのは、「前日の18時に送る」が予約時刻に左右されないようにするため。
 * これが無いと、10時の予約は前日10時、20時の予約は前日20時に届き、
 * 送る側からは何時に届くのか読めない。
 *
 * 日付は JST で見る。UTC で日付を切ると、日本の朝9時より前が前日になる。
 */
export function resolveAnchor(rule: ReminderTriggerRow, startsAtIso: string): string | null {
  const start = new Date(startsAtIso);
  if (Number.isNaN(start.getTime())) return null;

  const shifted = new Date(start.getTime() + (rule.trigger_offset_minutes ?? 0) * 60_000);
  if (!rule.send_at_time) return shifted.toISOString();

  const match = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(rule.send_at_time);
  // 壊れた時刻はずらさずに使う。設定が読めないからといって送らない、では
  // リマインダそのものが黙って消える。
  if (!match) return shifted.toISOString();

  const jst = new Date(shifted.getTime() + JST_OFFSET_MS);
  jst.setUTCHours(Number(match[1]), Number(match[2]), 0, 0);
  return new Date(jst.getTime() - JST_OFFSET_MS).toISOString();
}

/**
 * このきっかけで動くリマインダを探して、友だちを登録する。
 *
 * 同じ friend + reminder + target_date が既に active なら何もしない。
 * 予約の状態が何度か変わっても、そのたびに登録が増えないようにするため。
 *
 * 失敗しても呼び出し側は止めない。リマインダが登録できなかったからといって
 * 予約そのものを失敗させるのは筋が違う。
 */
export async function enrollByTrigger(
  db: D1Database,
  input: {
    triggerType: Exclude<ReminderTriggerType, 'manual'>;
    friendId: string;
    startsAtIso: string;
    sourceId?: string | null;
    sourceEventId?: string | null;
    /** 追跡用の発生元区分。未指定なら triggerType (個別相談は 'meet' を渡す)。 */
    sourceKind?: string | null;
  },
): Promise<number> {
  const rules = await db
    .prepare(
      `SELECT id, trigger_type, trigger_offset_minutes, send_at_time, target_tag_id,
              current_published_version_id
         FROM reminders
        WHERE is_active = 1 AND lifecycle_status = 'published'
          AND deleted_at IS NULL AND trigger_type = ?`,
    )
    .bind(input.triggerType)
    .all<ReminderTriggerRow>();
  if (!rules.results.length) return 0;

  let enrolled = 0;
  for (const rule of rules.results) {
    if (rule.target_tag_id) {
      const tagged = await db
        .prepare(`SELECT 1 FROM friend_tags WHERE friend_id = ? AND tag_id = ? LIMIT 1`)
        .bind(input.friendId, rule.target_tag_id)
        .first<{ 1: number }>();
      if (!tagged) continue;
    }

    const anchor = resolveAnchor(rule, input.startsAtIso);
    if (!anchor) continue;

    const existing = await db
      .prepare(
        `SELECT 1 FROM friend_reminders
          WHERE friend_id = ? AND reminder_id = ? AND target_date = ? AND status = 'active'
          LIMIT 1`,
      )
      .bind(input.friendId, rule.id, anchor)
      .first<{ 1: number }>();
    if (existing) continue;

    try {
      await enrollFriendInReminder(db, {
        friendId: input.friendId,
        reminderId: rule.id,
        targetDate: anchor,
        sourceKind: input.sourceKind ?? input.triggerType,
        sourceId: input.sourceId ?? null,
        sourceEventId: input.sourceEventId ?? null,
      });
    } catch (error) {
      // 取消後に同じ発生元で作り直したとき、cancelled の行が一意鍵
      // (reminder_id, friend_id, source_event_id) を塞いでいる。
      // その行を起こして新しい起点へ移す。再送の重なりでも1行のまま。
      if (!isUniqueViolation(error) || input.sourceEventId == null) throw error;
      const revived = await db
        .prepare(
          `UPDATE friend_reminders
              SET status = 'active', target_date = ?, cancel_reason = NULL,
                  completed_at = NULL, updated_at = ?
            WHERE reminder_id = ? AND friend_id = ? AND source_event_id = ?
              AND status = 'cancelled'`,
        )
        .bind(anchor, new Date().toISOString(), rule.id, input.friendId, input.sourceEventId)
        .run();
      if ((revived.meta?.changes ?? 0) === 0) throw error;
    }
    enrolled++;
  }
  return enrolled;
}

function isUniqueViolation(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /unique constraint failed/i.test(message);
}

export interface CancelByTriggerInput {
  triggerType: Exclude<ReminderTriggerType, 'manual'>;
  /** 追跡用の発生元区分。未指定なら triggerType。 */
  sourceKind?: string | null;
  sourceId?: string | null;
  sourceEventId?: string | null;
  friendId?: string | null;
  /** 移行前の行を探すための旧開始時刻。source 連動が無いときの予備鍵。 */
  startsAtIso?: string | null;
  lineAccountId?: string | null;
  /** 取消理由・元イベントID・実行者を残す (例: booking_cancel:bk-1:by:staff-9)。 */
  cancelReason: string;
  allowLegacyFallback?: boolean;
  now?: Date;
}

/**
 * 取消を V6 へ連動する。未送信だけを止め、送信済み履歴は残す。
 *
 * 同じ取消通知の再送は active が無いため 0 件で返す。
 * 失敗は呼び出し側へ投げる。黙って握ると取消漏れ (N-065 そのもの) になる。
 */
export async function cancelByTrigger(
  db: D1Database,
  input: CancelByTriggerInput,
): Promise<CancelV6RemindersResult> {
  const targetDates = await anchorsForStartsAt(db, input.triggerType, input.friendId, input.startsAtIso);
  return cancelV6RemindersForSource(db, {
    sourceKind: input.sourceKind ?? input.triggerType,
    sourceId: input.sourceId,
    sourceEventId: input.sourceEventId,
    friendId: input.friendId,
    targetDates,
    lineAccountId: input.lineAccountId,
    cancelReason: input.cancelReason,
    allowLegacyFallback: input.allowLegacyFallback,
    now: input.now?.toISOString(),
  });
}

export interface RescheduleByTriggerInput {
  triggerType: Exclude<ReminderTriggerType, 'manual'>;
  /** 追跡用の発生元区分。未指定なら triggerType。 */
  sourceKind?: string | null;
  sourceId?: string | null;
  sourceEventId?: string | null;
  friendId?: string | null;
  oldStartsAtIso: string;
  newStartsAtIso: string;
  lineAccountId?: string | null;
  allowLegacyFallback?: boolean;
  now?: Date;
}

/**
 * 日程変更を V6 へ連動する。送信済みを残し、未来予定だけ新基準日へ移す。
 *
 * 同じ変更通知の再送は from の起点が既に無いため 0 件で返す。
 */
export async function rescheduleByTrigger(
  db: D1Database,
  input: RescheduleByTriggerInput,
): Promise<RescheduleV6RemindersResult> {
  const rules = await db
    .prepare(
      `SELECT id, trigger_type, trigger_offset_minutes, send_at_time, target_tag_id,
              current_published_version_id
         FROM reminders
        WHERE is_active = 1 AND lifecycle_status = 'published'
          AND deleted_at IS NULL AND trigger_type = ?`,
    )
    .bind(input.triggerType)
    .all<ReminderTriggerRow>();
  if (!rules.results.length) return { movedEnrollments: 0, cancelledRuns: 0 };

  const moves: Array<{ reminderId: string; fromTargetDate: string; toTargetDate: string }> = [];
  for (const rule of rules.results) {
    if (rule.target_tag_id && input.friendId) {
      const tagged = await db
        .prepare(`SELECT 1 FROM friend_tags WHERE friend_id = ? AND tag_id = ? LIMIT 1`)
        .bind(input.friendId, rule.target_tag_id)
        .first<{ 1: number }>();
      if (!tagged) continue;
    }
    const from = resolveAnchor(rule, input.oldStartsAtIso);
    const to = resolveAnchor(rule, input.newStartsAtIso);
    if (!from || !to || from === to) continue;
    moves.push({ reminderId: rule.id, fromTargetDate: from, toTargetDate: to });
  }
  if (!moves.length) return { movedEnrollments: 0, cancelledRuns: 0 };
  return rescheduleV6RemindersForSource(db, {
    sourceKind: input.sourceKind ?? input.triggerType,
    sourceId: input.sourceId,
    sourceEventId: input.sourceEventId,
    friendId: input.friendId,
    targetDates: undefined,
    lineAccountId: input.lineAccountId,
    allowLegacyFallback: input.allowLegacyFallback,
    moves,
    now: input.now?.toISOString(),
  });
}

/** 移行前の行を探すため、全ルールの起点候補を列挙する (タグ絞り込みなし)。 */
async function anchorsForStartsAt(
  db: D1Database,
  triggerType: Exclude<ReminderTriggerType, 'manual'>,
  friendId: string | null | undefined,
  startsAtIso: string | null | undefined,
): Promise<string[]> {
  if (!friendId || !startsAtIso) return [];
  const rules = await db
    .prepare(
      `SELECT id, trigger_type, trigger_offset_minutes, send_at_time, target_tag_id,
              current_published_version_id
         FROM reminders
        WHERE is_active = 1 AND lifecycle_status = 'published'
          AND deleted_at IS NULL AND trigger_type = ?`,
    )
    .bind(triggerType)
    .all<ReminderTriggerRow>();
  const anchors: string[] = [];
  for (const rule of rules.results ?? []) {
    const anchor = resolveAnchor(rule, startsAtIso);
    if (anchor && !anchors.includes(anchor)) anchors.push(anchor);
  }
  return anchors;
}
