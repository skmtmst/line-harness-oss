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

import { enrollFriendInReminder } from '@line-crm/db';

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

    await enrollFriendInReminder(db, {
      friendId: input.friendId,
      reminderId: rule.id,
      targetDate: anchor,
      sourceKind: input.triggerType,
      sourceId: input.sourceId ?? null,
      sourceEventId: input.sourceEventId ?? null,
    });
    enrolled++;
  }
  return enrolled;
}
