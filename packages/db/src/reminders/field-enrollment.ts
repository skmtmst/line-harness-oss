import { snapshotReminderTemplateVersions } from '../reminder-template-snapshot.js';
import { jstNow } from '../utils.js';
import { type FriendFieldReminderRow, type FriendReminderRow } from './types.js';
import { getReminderById } from './definitions.js';
import { ensureReminderPublishedVersion, getReminderVersionSteps } from './versions.js';


/** 友だち情報欄の日付を起点にする、動いているリマインダ。 */
export async function getFriendFieldReminders(
  db: D1Database,
): Promise<FriendFieldReminderRow[]> {
  const rows = await db
    .prepare(
      `SELECT r.id, r.name, r.trigger_field_id, r.repeat_yearly, r.leap_year_policy,
              r.line_account_id, s.cursor AS scan_cursor
         FROM reminders r
         LEFT JOIN friend_field_reminder_scan_states s ON s.reminder_id = r.id
        WHERE r.is_active = 1
          AND r.deleted_at IS NULL
          AND r.trigger_type = 'friend_field'
          AND r.trigger_field_id IS NOT NULL
        ORDER BY r.id ASC`,
    )
    .all<FriendFieldReminderRow>();
  return rows.results ?? [];
}

/** その欄に値を入れている友だちを、保存済みカーソルの続きから返す。 */
export async function getFriendsWithFieldValuePage(
  db: D1Database,
  fieldId: string,
  lineAccountId: string | null,
  afterFriendId: string | null,
  limit: number,
  reminderId?: string,
): Promise<Array<{ friend_id: string; value: string }>> {
  if (!Number.isInteger(limit) || limit < 1) return [];
  const rows = await db.prepare(`SELECT f.id AS friend_id, COALESCE(v.value, '') AS value
    FROM friends f LEFT JOIN friend_field_values v ON v.friend_id = f.id AND v.field_id = ?
    WHERE f.is_following = 1
      AND (? IS NULL OR f.line_account_id = ?)
      AND (? IS NULL OR f.id > ?)
      AND ((v.value IS NOT NULL AND v.value != '') OR EXISTS (
        SELECT 1 FROM friend_reminders fr WHERE fr.friend_id = f.id AND fr.reminder_id = ? AND fr.status = 'active'
      ))
    ORDER BY f.id ASC LIMIT ?`)
    .bind(fieldId, lineAccountId, lineAccountId, afterFriendId, afterFriendId, reminderId ?? null, limit)
    .all<{ friend_id: string; value: string }>();
  return rows.results ?? [];
}

/** 情報欄の保存と同じ原子的 batch に入れる、未送信予定の取り消しと基準日の更新。 */
export function friendFieldReminderTargetStatements(
  db: D1Database,
  changes: Array<{ friendId: string; fieldId: string; value: string | null }>,
  now: string,
): D1PreparedStatement[] {
  if (!changes.length) return [];
  const targets = changes.map(change => {
    const day = /^(\d{4}-\d{2}-\d{2})(?:$|T)/.exec(change.value?.trim() ?? '')?.[1];
    const date = day ? new Date(`${day}T00:00:00Z`) : null;
    const valid = date && Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === day;
    return { friendId: change.friendId, fieldId: change.fieldId, value: change.value, targetDate: valid ? `${day}T00:00:00+09:00` : null };
  });
  const cte = `WITH changed AS (
    SELECT DISTINCT json_extract(value,'$.friendId') AS friend_id, json_extract(value,'$.fieldId') AS field_id,
      json_extract(value,'$.targetDate') AS target_date, json_extract(value,'$.value') AS field_value FROM json_each(?)
  ), affected AS (
    SELECT fr.id, changed.target_date FROM friend_reminders fr
      JOIN reminders r ON r.id = fr.reminder_id
      JOIN friends f ON f.id = fr.friend_id AND (r.line_account_id IS NULL OR r.line_account_id = f.line_account_id)
      LEFT JOIN reminder_versions rv ON rv.id = fr.reminder_version_id
      JOIN changed ON changed.friend_id = fr.friend_id
        AND changed.field_id = COALESCE(json_extract(rv.settings_snapshot,'$.triggerFieldId'),r.trigger_field_id)
      LEFT JOIN friend_field_values actual ON actual.friend_id = fr.friend_id AND actual.field_id = changed.field_id
    WHERE COALESCE(actual.value, '') = COALESCE(changed.field_value, '') AND fr.status = 'active'
      AND COALESCE(json_extract(rv.settings_snapshot,'$.triggerType'),r.trigger_type) = 'friend_field'
      AND COALESCE(json_extract(rv.settings_snapshot,'$.repeatYearly'),r.repeat_yearly) = 0
      AND (changed.target_date IS NULL OR changed.target_date != fr.target_date)
  )`;
  const json = JSON.stringify(targets);
  return [
    // 新しい登録を作るので、A→B→A の日付変更でも旧 cancelled 行を再利用しない。
    db.prepare(`${cte} INSERT INTO friend_reminders
      (id,friend_id,reminder_id,reminder_version_id,template_version_snapshot,target_date,status,source_kind,source_id,timezone,created_at,updated_at)
      SELECT 'ffr-replan:' || lower(hex(randomblob(16))),fr.friend_id,fr.reminder_id,fr.reminder_version_id,
        fr.template_version_snapshot,a.target_date,'active','friend_field_replan',fr.id,fr.timezone,?,?
      FROM affected a JOIN friend_reminders fr ON fr.id = a.id WHERE a.target_date IS NOT NULL`)
      .bind(json,now,now),
    // 送信履歴の元行はそのまま残す。新登録にも済んだ工程の印を引き継ぎ、再送を防ぐ。
    db.prepare(`${cte} INSERT OR IGNORE INTO friend_reminder_deliveries(id,friend_reminder_id,reminder_step_id,delivered_at)
      SELECT 'ffr-carried:' || next.id || ':' || done.reminder_step_id,next.id,done.reminder_step_id,done.delivered_at
      FROM affected a JOIN friend_reminders next ON next.source_kind='friend_field_replan' AND next.source_id=a.id
        AND next.target_date=a.target_date AND next.created_at=?
      JOIN (
        SELECT friend_reminder_id,reminder_step_id,MIN(delivered_at) AS delivered_at FROM (
          SELECT friend_reminder_id,reminder_step_id,delivered_at FROM friend_reminder_deliveries
          UNION ALL SELECT run.friend_reminder_id,run.reminder_step_id,COALESCE(run.completed_at,run.updated_at)
            FROM reminder_delivery_runs run WHERE run.status='succeeded'
              AND NOT EXISTS (SELECT 1 FROM friend_reminder_deliveries prior
                WHERE prior.friend_reminder_id=run.friend_reminder_id AND prior.reminder_step_id=run.reminder_step_id)
        ) GROUP BY friend_reminder_id,reminder_step_id
      ) done ON done.friend_reminder_id=a.id`)
      .bind(json,now),
    db.prepare(`${cte} UPDATE reminder_delivery_runs
      SET status = 'cancelled', completed_at = ?, updated_at = ?, next_retry_at = NULL, lease_expires_at = NULL
      WHERE friend_reminder_id IN (SELECT id FROM affected) AND status IN ('queued','retry_wait','claimed')`)
      .bind(json,now,now),
    db.prepare(`${cte} UPDATE friend_reminders
      SET status = 'cancelled',
        cancel_reason = CASE WHEN (SELECT target_date FROM affected WHERE affected.id = friend_reminders.id) IS NULL
          THEN 'friend_field_baseline_removed_or_invalid' ELSE 'friend_field_baseline_changed' END,
        lock_version = lock_version + 1, updated_at = ?
      WHERE id IN (SELECT id FROM affected)`)
      .bind(json,now),
  ];
}

/** 日付が消えた登録も読む。開始時に固定した公開版の欄・繰り返し方を使用する。 */
export async function getOneTimeFriendFieldReminderRegistrants(
  db: D1Database,
  reminderId: string,
  friendIds: string[],
): Promise<Array<FriendReminderRow & { field_id: string; field_value: string | null }>> {
  if (!friendIds.length) return [];
  const rows = await db.prepare(`SELECT fr.*, v.value AS field_value, COALESCE(json_extract(rv.settings_snapshot, '$.triggerFieldId'), r.trigger_field_id) AS field_id
    FROM friend_reminders fr
    JOIN reminders r ON r.id = fr.reminder_id
    JOIN friends f ON f.id = fr.friend_id AND (r.line_account_id IS NULL OR f.line_account_id = r.line_account_id)
    LEFT JOIN reminder_versions rv ON rv.id = fr.reminder_version_id
    LEFT JOIN friend_field_values v ON v.friend_id = fr.friend_id
      AND v.field_id = COALESCE(json_extract(rv.settings_snapshot, '$.triggerFieldId'), r.trigger_field_id)
    WHERE fr.reminder_id = ?
      AND fr.friend_id IN (SELECT value FROM json_each(?))
      AND COALESCE(json_extract(rv.settings_snapshot, '$.triggerType'), r.trigger_type) = 'friend_field'
      AND COALESCE(json_extract(rv.settings_snapshot, '$.repeatYearly'), r.repeat_yearly) = 0
    ORDER BY fr.id`).bind(reminderId, JSON.stringify(friendIds)).all<FriendReminderRow & { field_id: string; field_value: string | null }>();
  return rows.results ?? [];
}

/**
 * 次回走査の開始位置を保存する。末尾まで読んだときは null に戻し、次の周期を
 * 先頭から始める。
 */
export async function setFriendFieldReminderScanCursor(
  db: D1Database,
  reminderId: string,
  cursor: string | null,
): Promise<void> {
  await db.prepare(
    `INSERT INTO friend_field_reminder_scan_states (reminder_id, cursor, updated_at)
     VALUES (?, ?, ?)
     ON CONFLICT(reminder_id) DO UPDATE SET cursor = excluded.cursor, updated_at = excluded.updated_at`,
  ).bind(reminderId, cursor, jstNow()).run();
}

export const FRIEND_REMINDER_INSERT_CHUNK = 30;

/**
 * 友だち情報欄の走査で見つけた登録候補を、100 bind 未満の塊で登録する。
 *
 * NOT EXISTS で過去のランダムIDの登録を除外し、決定的なIDと INSERT OR IGNORE で
 * 中断後の再実行や同時実行でも二重登録しない。
 */
export async function enrollFriendsInReminderOnce(
  db: D1Database,
  reminderId: string,
  candidates: Array<{ friendId: string; targetDate: string }>,
): Promise<number> {
  if (candidates.length === 0) return 0;
  const reminder = await getReminderById(db, reminderId);
  if (!reminder || reminder.lifecycle_status !== 'published') {
    throw new Error('REMINDER_NOT_PUBLISHED');
  }
  const versionId = await ensureReminderPublishedVersion(db, reminder);
  const versionSteps = await getReminderVersionSteps(db, versionId);
  let enrolled = 0;
  const now = jstNow();
  // R346: まとめ登録も1件ずつと同じ版で送る。この束が使うテンプレートの
  // 公開版を1度だけ写し、新しい行に付ける（ある行は触らない）。
  const bulkTemplateSnapshot = await snapshotReminderTemplateVersions(
    db,
    versionSteps.map((step) => step.template_id),
  );

  for (let offset = 0; offset < candidates.length; offset += FRIEND_REMINDER_INSERT_CHUNK) {
    const chunk = candidates.slice(offset, offset + FRIEND_REMINDER_INSERT_CHUNK);
    const values = chunk.map(() => '(?, ?, ?)').join(', ');
    const bindings: unknown[] = [];
    for (const candidate of chunk) {
      bindings.push(
        `ffr:${encodeURIComponent(reminderId)}:${encodeURIComponent(candidate.friendId)}:${encodeURIComponent(candidate.targetDate)}`,
        candidate.friendId,
        candidate.targetDate,
      );
    }
    bindings.push(reminderId, versionId, bulkTemplateSnapshot, now, now);

    const result = await db.prepare(
      `WITH candidates(id, friend_id, target_date) AS (VALUES ${values})
       INSERT OR IGNORE INTO friend_reminders
         (id, friend_id, reminder_id, reminder_version_id, target_date, template_version_snapshot, created_at, updated_at)
       SELECT c.id, c.friend_id, ?, ?, c.target_date, ?, ?, ?
         FROM candidates c
        WHERE NOT EXISTS (
          SELECT 1
            FROM friend_reminders existing
           WHERE existing.friend_id = c.friend_id
             AND existing.reminder_id = ?
             AND existing.target_date = c.target_date
        )`,
    ).bind(...bindings, reminderId).run();
    enrolled += Number(result.meta?.changes ?? 0);
  }

  return enrolled;
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
