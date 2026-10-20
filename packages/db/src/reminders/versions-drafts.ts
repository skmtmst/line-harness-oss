import { jstNow, nextVersionToken } from '../utils.js';
import { type ReminderVersionRow, type ReminderDraftSettings, type ReminderDraftStepInput, type ReminderRow } from './types.js';
import { getReminderById } from './definitions.js';



// =============================================================================
// 公開版・下書き（274）
// =============================================================================

export function parseReminderVersionSettings(row: ReminderVersionRow): ReminderDraftSettings {
  return JSON.parse(row.settings_snapshot) as ReminderDraftSettings;
}

export async function getReminderVersionById(
  db: D1Database,
  versionId: string,
): Promise<ReminderVersionRow | null> {
  return db.prepare(`SELECT * FROM reminder_versions WHERE id = ?`)
    .bind(versionId)
    .first<ReminderVersionRow>();
}

export async function getReminderDraftVersion(
  db: D1Database,
  reminderId: string,
): Promise<ReminderVersionRow | null> {
  return db.prepare(
    `SELECT rv.*
       FROM reminders r
       JOIN reminder_versions rv ON rv.id = r.current_draft_version_id
      WHERE r.id = ? AND r.deleted_at IS NULL AND rv.status = 'draft'`,
  ).bind(reminderId).first<ReminderVersionRow>();
}

export async function getReminderPublishedVersion(
  db: D1Database,
  reminderId: string,
): Promise<ReminderVersionRow | null> {
  return db.prepare(
    `SELECT rv.*
       FROM reminders r
       JOIN reminder_versions rv ON rv.id = r.current_published_version_id
      WHERE r.id = ? AND r.deleted_at IS NULL AND rv.status = 'published'`,
  ).bind(reminderId).first<ReminderVersionRow>();
}

export function reminderVersionStepStatements(
  db: D1Database,
  versionId: string,
  steps: ReminderDraftStepInput[],
  now: string,
): D1PreparedStatement[] {
  return steps.map((step, position) => db.prepare(
    `INSERT INTO reminder_version_steps
       (id, reminder_version_id, stable_step_id, position, offset_minutes,
        message_type, message_content, offset_days, send_at_time, template_id,
        target_condition_json, action_json, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).bind(
    crypto.randomUUID(),
    versionId,
    step.stableStepId,
    position,
    step.offsetMinutes,
    step.messageType,
    step.messageContent,
    step.offsetDays ?? null,
    step.sendAtTime ?? null,
    step.templateId ?? null,
    JSON.stringify(step.targetCondition ?? {}),
    JSON.stringify(step.action ?? {}),
    now,
  ));
}

/** 定義と初版下書きを同じD1 batchで作る。 */
export async function createReminderWithDraftVersion(
  db: D1Database,
  settings: ReminderDraftSettings,
): Promise<{ reminder: ReminderRow; version: ReminderVersionRow }> {
  const reminderId = crypto.randomUUID();
  const versionId = crypto.randomUUID();
  const now = jstNow();
  await db.batch([
    db.prepare(
      `INSERT INTO reminders
         (id, name, description, is_active, line_account_id, trigger_type,
          trigger_offset_minutes, send_at_time, target_tag_id, folder_id,
          delivery_mode, trigger_field_id, trigger_event_id, repeat_yearly, leap_year_policy,
          lifecycle_status, current_draft_version_id, created_at, updated_at)
       VALUES (?, ?, ?, 0, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'draft', ?, ?, ?)`,
    ).bind(
      reminderId,
      settings.name,
      settings.description ?? null,
      settings.lineAccountId,
      settings.triggerType,
      settings.triggerOffsetMinutes ?? null,
      settings.sendAtTime ?? null,
      settings.targetTagId ?? null,
      settings.folderId ?? null,
      settings.deliveryMode,
      settings.triggerFieldId ?? null,
      settings.triggerEventId ?? null,
      settings.repeatYearly ? 1 : 0,
      settings.leapYearPolicy ?? 'feb28',
      versionId,
      now,
      now,
    ),
    db.prepare(
      `INSERT INTO reminder_versions
         (id, reminder_id, version_number, status, settings_snapshot, created_at, updated_at)
       VALUES (?, ?, 1, 'draft', ?, ?, ?)`,
    ).bind(versionId, reminderId, JSON.stringify(settings), now, now),
    ...reminderVersionStepStatements(db, versionId, settings.steps, now),
  ]);
  const [reminder, version] = await Promise.all([
    getReminderById(db, reminderId),
    getReminderVersionById(db, versionId),
  ]);
  if (!reminder || !version) throw new Error('REMINDER_DRAFT_NOT_CREATED');
  return { reminder, version };
}

/** 公開版を触らず、編集用の版だけを作る、または置き換える。 */
export async function saveReminderDraftVersion(
  db: D1Database,
  reminderId: string,
  settings: ReminderDraftSettings,
  options: { expectedVersionId?: string | null; expectedUpdatedAt?: string | null } = {},
): Promise<ReminderVersionRow> {
  const reminder = await getReminderById(db, reminderId);
  if (!reminder) throw new Error('REMINDER_NOT_FOUND');
  const existing = await getReminderDraftVersion(db, reminderId);
  const now = nextVersionToken(existing?.updated_at ?? reminder.updated_at);
  // N-080 (#869): 開いたときの版を指定されたら照合する。別タブで先に保存・
  // 公開された下書きへ、古い画面の内容をそのまま上書きさせない。
  // R148 監査：通常保存は版IDを付け替えないため、版IDだけでは A の保存後に
  // B が古い内容で保存しても比較が通る。保存のたびに変わる updated_at も
  // 合わせて照合し、ずれていれば 409 で止める（ミリ秒精度）。
  if (options.expectedVersionId !== undefined) {
    const idMatches = (existing?.id ?? null) === options.expectedVersionId;
    const stampMatches = options.expectedUpdatedAt === undefined
      || options.expectedUpdatedAt === null
      || existing?.updated_at === options.expectedUpdatedAt;
    if (!idMatches || !stampMatches) {
      throw new Error('REMINDER_DRAFT_CONFLICT');
    }
  }
  const versionId = existing?.id ?? crypto.randomUUID();

  const guard = db.prepare(`SELECT json(CASE WHEN EXISTS (
    SELECT 1 FROM reminders r WHERE r.id = ? AND r.deleted_at IS NULL
      AND r.current_draft_version_id IS ? AND r.updated_at = ?
      ${existing ? "AND EXISTS (SELECT 1 FROM reminder_versions v WHERE v.id = r.current_draft_version_id AND v.status = 'draft' AND v.updated_at = ?)" : ''}
  ) THEN '{}' ELSE 'REMINDER_DRAFT_CONFLICT' END)`)
    .bind(reminderId, reminder.current_draft_version_id, reminder.updated_at,
      ...(existing ? [existing.updated_at] : []));
  try {
    if (existing) {
      await db.batch([
        guard,
        db.prepare(
          `UPDATE reminder_versions
              SET settings_snapshot = ?, last_test_status = NULL, last_tested_at = NULL,
                  last_tested_by_staff_id = NULL, updated_at = ?
            WHERE id = ? AND status = 'draft' AND updated_at = ?`,
        ).bind(JSON.stringify(settings), now, versionId, existing.updated_at),
        db.prepare(`DELETE FROM reminder_version_steps WHERE reminder_version_id = ?`).bind(versionId),
        ...reminderVersionStepStatements(db, versionId, settings.steps, now),
      ]);
    } else {
      const next = await db.prepare(
        `SELECT COALESCE(MAX(version_number), 0) + 1 AS version_number
           FROM reminder_versions WHERE reminder_id = ?`,
      ).bind(reminderId).first<{ version_number: number }>();
      await db.batch([
        guard,
        db.prepare(
          `INSERT INTO reminder_versions
             (id, reminder_id, version_number, status, settings_snapshot, created_at, updated_at)
           VALUES (?, ?, ?, 'draft', ?, ?, ?)`,
        ).bind(
          versionId,
          reminderId,
          Number(next?.version_number ?? 1),
          JSON.stringify(settings),
          now,
          now,
        ),
        db.prepare(
          `UPDATE reminders
              SET current_draft_version_id = ?,
                  lifecycle_status = CASE WHEN current_published_version_id IS NULL THEN 'draft' ELSE lifecycle_status END,
                  updated_at = ?
            WHERE id = ? AND deleted_at IS NULL`,
        ).bind(versionId, now, reminderId),
        ...reminderVersionStepStatements(db, versionId, settings.steps, now),
      ]);
    }
  } catch (error) {
    if (error instanceof Error && /malformed JSON/i.test(error.message)) throw new Error('REMINDER_DRAFT_CONFLICT');
    throw error;
  }
  const saved = await getReminderVersionById(db, versionId);
  if (!saved) throw new Error('REMINDER_DRAFT_NOT_SAVED');
  return saved;
}

export async function recordReminderDraftTest(
  db: D1Database,
  versionId: string,
  input: { succeeded: boolean; staffId: string | null },
): Promise<void> {
  const now = jstNow();
  await db.prepare(
    `UPDATE reminder_versions
        SET last_test_status = ?, last_tested_at = ?, last_tested_by_staff_id = ?, updated_at = ?
      WHERE id = ? AND status = 'draft'`,
  ).bind(input.succeeded ? 'succeeded' : 'failed', now, input.staffId, now, versionId).run();
}
