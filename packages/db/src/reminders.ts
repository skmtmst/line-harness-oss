import { jstNow } from './utils.js';
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
  created_at: string;
  updated_at: string;
  /** 153: 'time'（○日前の●時）か 'countdown'（何分ずらすか）。作成後は変えない。 */
  delivery_mode: string;
  /** 154: 友だち情報欄の日付を起点にするとき、見る欄。 */
  trigger_field_id: string | null;
  /** 154: 毎年くり返すか。 */
  repeat_yearly: number;
  /** 156: フォルダ。null は未分類。消しても未分類に戻るだけ。 */
  folder_id: string | null;
  /** 161: 並び順。同じ値のときは created_at の新しい順。 */
  display_order: number;
  /** 199: 削除後も送信履歴を残す。値がある行は通常画面・実行対象から外す。 */
  deleted_at: string | null;
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
}

// --- リマインダCRUD ---

export async function getReminders(db: D1Database): Promise<ReminderRow[]> {
  // 161: 並べ替えたものが先。まだ並べ替えていないものは全部 0 なので、
  // created_at の新しい順で割る（これまでの並びが変わらない）。
  const result = await db
    .prepare(`SELECT * FROM reminders WHERE deleted_at IS NULL ORDER BY display_order ASC, created_at DESC`)
    .all<ReminderRow>();
  return result.results;
}

/**
 * 並び順をまとめて書く。渡された順に 0,1,2… を入れる。
 *
 * 送られてこなかったものは触らない。絞り込みで隠れているリマインダの順番を
 * 勝手に動かすと、戻すすべがない（タグ・シナリオと同じ考え方）。
 */
export async function reorderReminders(db: D1Database, ids: string[]): Promise<void> {
  if (ids.length === 0) return;
  await db.batch(
    ids.map((id, i) =>
      db.prepare(`UPDATE reminders SET display_order = ? WHERE id = ? AND deleted_at IS NULL`).bind(i, id),
    ),
  );
}

export async function getReminderById(db: D1Database, id: string): Promise<ReminderRow | null> {
  return db.prepare(`SELECT * FROM reminders WHERE id = ? AND deleted_at IS NULL`).bind(id).first<ReminderRow>();
}

export interface ReminderTriggerInput {
  triggerType?: 'manual' | 'booking' | 'event' | 'friend_field';
  /** 153: 'time'（ゴールの○日前の●時）か 'countdown'（何分ずらすか）。作成後は変えない。 */
  deliveryMode?: 'time' | 'countdown';
  /** 154: 友だち情報欄の日付を起点にするとき、どの欄を見るか。 */
  triggerFieldId?: string | null;
  /** 154: 毎年くり返すか（誕生日なら true）。 */
  repeatYearly?: boolean;
  triggerOffsetMinutes?: number | null;
  sendAtTime?: string | null;
  targetTagId?: string | null;
  /** 156: フォルダ。null は未分類。 */
  folderId?: string | null;
}

export async function createReminder(
  db: D1Database,
  input: { name: string; description?: string } & ReminderTriggerInput,
): Promise<ReminderRow> {
  const id = crypto.randomUUID();
  const now = jstNow();
  await db.prepare(
    `INSERT INTO reminders
       (id, name, description, trigger_type, trigger_offset_minutes,
        send_at_time, target_tag_id, delivery_mode,
        trigger_field_id, repeat_yearly, folder_id, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  )
    .bind(
      id,
      input.name,
      input.description ?? null,
      input.triggerType ?? 'manual',
      input.triggerOffsetMinutes ?? null,
      input.sendAtTime ?? null,
      input.targetTagId ?? null,
      // 配信方式は作成時にだけ決める。あとから変えると、登録済みの配信予定が
      // すべて変わってしまう（153）。
      input.deliveryMode ?? 'countdown',
      input.triggerFieldId ?? null,
      input.repeatYearly ? 1 : 0,
      input.folderId ?? null,
      now,
      now,
    )
    .run();
  return (await getReminderById(db, id))!;
}

export async function updateReminder(
  db: D1Database,
  id: string,
  updates: Partial<{ name: string; description: string; isActive: boolean }> & ReminderTriggerInput,
): Promise<void> {
  const sets: string[] = [];
  const values: unknown[] = [];
  if (updates.name !== undefined) { sets.push('name = ?'); values.push(updates.name); }
  if (updates.description !== undefined) { sets.push('description = ?'); values.push(updates.description); }
  if (updates.isActive !== undefined) { sets.push('is_active = ?'); values.push(updates.isActive ? 1 : 0); }
  if (updates.triggerType !== undefined) { sets.push('trigger_type = ?'); values.push(updates.triggerType); }
  if (updates.triggerFieldId !== undefined) { sets.push('trigger_field_id = ?'); values.push(updates.triggerFieldId); }
  if (updates.repeatYearly !== undefined) { sets.push('repeat_yearly = ?'); values.push(updates.repeatYearly ? 1 : 0); }
  // delivery_mode はここで変えない。作成時に決めたものを守る（153）。
  // 途中で変えると、すでに登録済みの友だちの配信予定がすべて変わる。
  if ('triggerOffsetMinutes' in updates) { sets.push('trigger_offset_minutes = ?'); values.push(updates.triggerOffsetMinutes ?? null); }
  if ('sendAtTime' in updates) { sets.push('send_at_time = ?'); values.push(updates.sendAtTime ?? null); }
  if ('targetTagId' in updates) { sets.push('target_tag_id = ?'); values.push(updates.targetTagId ?? null); }
  if ('folderId' in updates) { sets.push('folder_id = ?'); values.push(updates.folderId ?? null); }
  if (sets.length === 0) return;
  sets.push('updated_at = ?');
  values.push(jstNow());
  values.push(id);
  await db.prepare(`UPDATE reminders SET ${sets.join(', ')} WHERE id = ? AND deleted_at IS NULL`).bind(...values).run();
}

export async function deleteReminder(db: D1Database, id: string): Promise<void> {
  const now = jstNow();
  // D1 の batch は一括で成功・失敗する。定義だけ隠れて登録が動き続ける、または
  // 登録だけ止まって定義が残る、という半端な削除状態を作らない。
  await db.batch([
    db.prepare(
      `UPDATE reminders
          SET is_active = 0, deleted_at = ?, updated_at = ?
        WHERE id = ? AND deleted_at IS NULL`,
    ).bind(now, now, id),
    db.prepare(
      `UPDATE friend_reminders
          SET status = 'cancelled', updated_at = ?
        WHERE reminder_id = ? AND status = 'active'`,
    ).bind(now, id),
  ]);
}

// --- リマインダステップ ---

export async function getReminderSteps(db: D1Database, reminderId: string): Promise<ReminderStepRow[]> {
  const result = await db.prepare(`SELECT * FROM reminder_steps WHERE reminder_id = ? ORDER BY offset_minutes ASC`)
    .bind(reminderId).all<ReminderStepRow>();
  return result.results;
}

export async function createReminderStep(
  db: D1Database,
  input: {
    reminderId: string;
    offsetMinutes: number;
    messageType: string;
    messageContent: string;
    /** 153: ゴールから何日ずらすか。配信方式が 'time' のとき使う。 */
    offsetDays?: number | null;
    /** 153: その日の何時に送るか（日本時間の "HH:MM"）。 */
    sendAtTime?: string | null;
    /** 153: 送る中身をテンプレートから選ぶ。 */
    templateId?: string | null;
  },
): Promise<ReminderStepRow> {
  const id = crypto.randomUUID();
  const now = jstNow();
  await db
    .prepare(
      `INSERT INTO reminder_steps
         (id, reminder_id, offset_minutes, message_type, message_content,
          offset_days, send_at_time, template_id, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(
      id,
      input.reminderId,
      input.offsetMinutes,
      input.messageType,
      input.messageContent,
      input.offsetDays ?? null,
      input.sendAtTime ?? null,
      input.templateId ?? null,
      now,
    )
    .run();
  return (await db.prepare(`SELECT * FROM reminder_steps WHERE id = ?`).bind(id).first<ReminderStepRow>())!;
}

export async function deleteReminderStep(db: D1Database, id: string): Promise<void> {
  await db.prepare(`DELETE FROM reminder_steps WHERE id = ?`).bind(id).run();
}

// --- 友だちリマインダ ---

export async function enrollFriendInReminder(
  db: D1Database,
  input: { friendId: string; reminderId: string; targetDate: string },
): Promise<FriendReminderRow> {
  const id = crypto.randomUUID();
  const now = jstNow();
  await db.prepare(`INSERT INTO friend_reminders (id, friend_id, reminder_id, target_date, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)`)
    .bind(id, input.friendId, input.reminderId, input.targetDate, now, now).run();
  return (await db.prepare(`SELECT * FROM friend_reminders WHERE id = ?`).bind(id).first<FriendReminderRow>())!;
}

export async function getFriendReminders(db: D1Database, friendId: string): Promise<FriendReminderRow[]> {
  const result = await db.prepare(`SELECT * FROM friend_reminders WHERE friend_id = ? ORDER BY target_date ASC`)
    .bind(friendId).all<FriendReminderRow>();
  return result.results;
}

export async function cancelFriendReminder(db: D1Database, id: string): Promise<void> {
  await db.prepare(`UPDATE friend_reminders SET status = 'cancelled', updated_at = ? WHERE id = ?`)
    .bind(jstNow(), id).run();
}

/** リマインダ配信処理用: 配信が必要な友だちリマインダを取得 */
/**
 * まだ配信していない通を、登録ごとに返す。
 *
 * **「配信時刻が来たか」はここでは見ない。** 時刻の決め方（153 の配信方式）は
 * 日本時間の暦の計算が要り、そのための部品は packages/shared にある。
 * db パッケージは shared に依存していないので、絞り込みは呼び出し側で行う。
 *
 * 以前はここで `target_date + offset_minutes` を計算していたが、方式が
 * 2つになった時点で、この場所では決められなくなった。
 */
export async function getPendingReminderDeliveries(
  db: D1Database,
): Promise<Array<FriendReminderRow & { delivery_mode: string; steps: ReminderStepRow[] }>> {
  // activeなリマインダ登録を取得
  // 配信方式（153）も一緒に引く。通ごとに引き直すと、通の数だけ問い合わせが増える。
  const activeReminders = await db
    .prepare(`SELECT fr.*, r.delivery_mode AS delivery_mode
                FROM friend_reminders fr
                INNER JOIN reminders r ON r.id = fr.reminder_id
               WHERE fr.status = 'active' AND r.is_active = 1 AND r.deleted_at IS NULL`)
    .all<FriendReminderRow & { delivery_mode: string }>();

  const results: Array<
    FriendReminderRow & { delivery_mode: string; steps: ReminderStepRow[] }
  > = [];
  for (const fr of activeReminders.results) {
    const steps = await getReminderSteps(db, fr.reminder_id);
    // 配信済みステップを取得
    const delivered = await db
      .prepare(`SELECT reminder_step_id FROM friend_reminder_deliveries WHERE friend_reminder_id = ?`)
      .bind(fr.id)
      .all<{ reminder_step_id: string }>();
    const deliveredIds = new Set(delivered.results.map((d) => d.reminder_step_id));

    // 未配信で配信時刻が到来しているステップをフィルタ
    const pending = steps.filter((step) => !deliveredIds.has(step.id));
    if (pending.length > 0) {
      results.push({ ...fr, steps: pending });
    }
  }
  return results;
}

/** 配信済みを記録 */
export async function markReminderStepDelivered(db: D1Database, friendReminderId: string, reminderStepId: string): Promise<void> {
  const id = crypto.randomUUID();
  await db.prepare(`INSERT OR IGNORE INTO friend_reminder_deliveries (id, friend_reminder_id, reminder_step_id) VALUES (?, ?, ?)`)
    .bind(id, friendReminderId, reminderStepId).run();
}

/** 全ステップ配信済みならcompletedにする */
export async function completeReminderIfDone(db: D1Database, friendReminderId: string, reminderId: string): Promise<void> {
  const totalSteps = await db.prepare(`SELECT COUNT(*) as count FROM reminder_steps WHERE reminder_id = ?`)
    .bind(reminderId).first<{ count: number }>();
  const deliveredSteps = await db.prepare(`SELECT COUNT(*) as count FROM friend_reminder_deliveries WHERE friend_reminder_id = ?`)
    .bind(friendReminderId).first<{ count: number }>();

  if (totalSteps && deliveredSteps && deliveredSteps.count >= totalSteps.count) {
    await db.prepare(`UPDATE friend_reminders SET status = 'completed', updated_at = ? WHERE id = ?`)
      .bind(jstNow(), friendReminderId).run();
  }
}

// =============================================================================
// 友だち情報欄の日付を起点にする（154）
// =============================================================================

export interface FriendFieldReminderRow {
  id: string;
  name: string;
  trigger_field_id: string | null;
  repeat_yearly: number;
  line_account_id: string | null;
}

/** 友だち情報欄の日付を起点にする、動いているリマインダ。 */
export async function getFriendFieldReminders(
  db: D1Database,
): Promise<FriendFieldReminderRow[]> {
  const rows = await db
    .prepare(
      `SELECT id, name, trigger_field_id, repeat_yearly, line_account_id
         FROM reminders
        WHERE is_active = 1
          AND deleted_at IS NULL
          AND trigger_type = 'friend_field'
          AND trigger_field_id IS NOT NULL`,
    )
    .all<FriendFieldReminderRow>();
  return rows.results ?? [];
}

/** その欄に値を入れている友だちを、値と一緒に返す。 */
export async function getFriendsWithFieldValue(
  db: D1Database,
  fieldId: string,
): Promise<Array<{ friend_id: string; value: string }>> {
  const rows = await db
    .prepare(
      `SELECT v.friend_id AS friend_id, v.value AS value
         FROM friend_field_values v
         JOIN friends f ON f.id = v.friend_id
        WHERE v.field_id = ?
          AND v.value IS NOT NULL AND v.value != ''
          AND f.is_following = 1`,
    )
    .bind(fieldId)
    .all<{ friend_id: string; value: string }>();
  return rows.results ?? [];
}

/**
 * その人・そのリマインダ・そのゴール日での登録が、もうあるか。
 *
 * 毎年くり返すリマインダは、年ごとに別のゴール日になる。だから
 * 「去年立てたから今年は立てない」にはならない。同じ年に二重に立つのだけを防ぐ。
 */
/**
 * このリマインダに、いま入っている「友だち＋ゴール日」の組を全部返す。
 *
 * 毎日の処理で1人ずつ `hasReminderEnrollment` を呼ぶと、**友だちの数だけ
 * 問い合わせが飛ぶ。** 誕生日リマインダは「誕生日が入っている人」を全員
 * 見るので、5,000人いれば毎日5,000回になる。Cloudflare Workers の
 * 1回の実行で出せる問い合わせ数には上限があり、そこに当たると
 * **その日のぶんが途中で止まる**（しかも例外にならず、途中まで動いたように見える）。
 *
 * 1回で引いて、あとは手元で照合する。
 */
export async function getReminderEnrollmentKeys(
  db: D1Database,
  reminderId: string,
): Promise<Set<string>> {
  const rows = await db
    .prepare(`SELECT friend_id, target_date FROM friend_reminders WHERE reminder_id = ?`)
    .bind(reminderId)
    .all<{ friend_id: string; target_date: string }>();
  return new Set((rows.results ?? []).map((r) => `${r.friend_id}\u0000${r.target_date}`));
}

export async function hasReminderEnrollment(
  db: D1Database,
  friendId: string,
  reminderId: string,
  targetDate: string,
): Promise<boolean> {
  const row = await db
    .prepare(
      `SELECT 1 AS hit FROM friend_reminders
        WHERE friend_id = ? AND reminder_id = ? AND target_date = ? LIMIT 1`,
    )
    .bind(friendId, reminderId, targetDate)
    .first<{ hit: number }>();
  return row != null;
}
