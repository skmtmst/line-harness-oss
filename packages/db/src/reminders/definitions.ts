import { sqlIdSet } from '../id-queries.js';
import { jstNow } from '../utils.js';
import { type ReminderRowScope, type ReminderRow, type ReminderTriggerInput } from './types.js';


/**
 * 送信元アカウントの列に対する絞り込み条件を作る。見える範囲が空なら
 * 何も通さない（`1 = 0`）。未所属の行は見てよい人だけに残す。
 */
export function reminderRowScopePredicate(
  column: string,
  scope: ReminderRowScope | undefined,
  bindings: unknown[],
): string | null {
  if (!scope) return null;
  const parts: string[] = [];
  if (scope.allowedAccountIds.length > 0) {
    parts.push(`${column} IN (${sqlIdSet(scope.allowedAccountIds).sql})`);
    bindings.push(...(scope.allowedAccountIds.length ? sqlIdSet(scope.allowedAccountIds).binds : []));
  }
  if (scope.canSeeUnassigned) parts.push(`${column} IS NULL`);
  return parts.length > 0 ? `(${parts.join(' OR ')})` : '1 = 0';
}

// --- リマインダCRUD ---

export async function getReminders(db: D1Database, scope?: ReminderRowScope): Promise<ReminderRow[]> {
  const bindings: unknown[] = [];
  const predicate = reminderRowScopePredicate('line_account_id', scope, bindings);
  // 161: 並べ替えたものが先。まだ並べ替えていないものは全部 0 なので、
  // created_at の新しい順で割る（これまでの並びが変わらない）。
  const result = await db
    .prepare(`SELECT * FROM reminders WHERE deleted_at IS NULL
      ${predicate ? `AND ${predicate}` : ''}
      ORDER BY display_order ASC, created_at DESC, id ASC`)
    .bind(...bindings)
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

/**
 * 並び替え前の所属確認用。idとLINEアカウントだけを返す。
 *
 * 削除済みは対象外。渡されたidが1件でも欠けたら、呼び出し側で404にする。
 */
export async function getRemindersByIds(
  db: D1Database,
  ids: string[],
): Promise<Array<{ id: string; line_account_id: string | null }>> {
  if (ids.length === 0) return [];
  const unique = [...new Set(ids)];
  const placeholders = sqlIdSet(unique).sql;
  const result = await db
    .prepare(
      `SELECT id, line_account_id FROM reminders WHERE id IN (${placeholders}) AND deleted_at IS NULL`,
    )
    .bind(...(unique.length ? sqlIdSet(unique).binds : []))
    .all<{ id: string; line_account_id: string | null }>();
  return result.results;
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
        trigger_field_id, trigger_event_id, repeat_yearly, leap_year_policy, folder_id, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
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
      input.triggerEventId ?? null,
      input.repeatYearly ? 1 : 0,
      input.leapYearPolicy ?? 'feb28',
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
  if (updates.isActive === true) {
    /*
     * R146 監査：公開版の無い下書きを「再開」させない。通すと公開版IDが
     * null のまま is_active=1・lifecycle_status=published になり、公開して
     * いない設定が稼働中に見える。止める方（false）は従来どおり通す。
     */
    const current = await getReminderById(db, id);
    if (current && current.current_published_version_id == null) {
      throw new Error('REMINDER_NOT_PUBLISHED');
    }
  }
  if (updates.isActive !== undefined) {
    sets.push('is_active = ?');
    values.push(updates.isActive ? 1 : 0);
    sets.push('lifecycle_status = ?');
    values.push(updates.isActive ? 'published' : 'stopped');
  }
  if (updates.triggerType !== undefined) { sets.push('trigger_type = ?'); values.push(updates.triggerType); }
  if (updates.triggerFieldId !== undefined) { sets.push('trigger_field_id = ?'); values.push(updates.triggerFieldId); }
  if (updates.triggerEventId !== undefined) { sets.push('trigger_event_id = ?'); values.push(updates.triggerEventId); }
  if (updates.repeatYearly !== undefined) { sets.push('repeat_yearly = ?'); values.push(updates.repeatYearly ? 1 : 0); }
  if (updates.leapYearPolicy !== undefined) { sets.push('leap_year_policy = ?'); values.push(updates.leapYearPolicy); }
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
          SET is_active = 0, lifecycle_status = 'stopped', deleted_at = ?, updated_at = ?
        WHERE id = ? AND deleted_at IS NULL`,
    ).bind(now, now, id),
    db.prepare(
      `UPDATE friend_reminders
          SET status = 'cancelled', updated_at = ?
        WHERE reminder_id = ? AND status = 'active'`,
    ).bind(now, id),
    db.prepare(
      `UPDATE reminder_delivery_runs
          SET status = 'cancelled', next_retry_at = NULL, lease_expires_at = NULL,
              completed_at = COALESCE(completed_at, ?), updated_at = ?
        WHERE reminder_id = ?
          AND status IN ('queued', 'claimed', 'retry_wait')`,
    ).bind(now, now, id),
  ]);
}

/*
 * 削除の取り消し（B 元に戻す）。定義の deleted_at を空に戻すだけ。
 * 戻した直後は止めたまま（is_active = 0、lifecycle は stopped のまま）。
 * 削除時に取り消した登録・配信予定は戻さない。消えている間に日時が
 * 過ぎた相手へいきなり送らないため。送り直しは画面で登録し直す。
 */
export async function restoreReminder(
  db: D1Database,
  id: string,
): Promise<ReminderRow | null> {
  const now = jstNow();
  const result = await db
    .prepare(
      `UPDATE reminders
          SET deleted_at = NULL, is_active = 0, updated_at = ?
        WHERE id = ? AND deleted_at IS NOT NULL`,
    )
    .bind(now, id)
    .run();
  if ((result.meta.changes ?? 0) !== 1) return null;
  return db
    .prepare(`SELECT * FROM reminders WHERE id = ?`)
    .bind(id)
    .first<ReminderRow>();
}
