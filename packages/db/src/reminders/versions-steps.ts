import { jstNow } from '../utils.js';
import { type ReminderDraftSettings, type ReminderRow, type ReminderStepRow } from './types.js';
import { getReminderById } from './definitions.js';
import { getReminderVersionSteps } from './versions-publication.js';


// --- リマインダステップ ---

export async function getReminderSteps(db: D1Database, reminderId: string): Promise<ReminderStepRow[]> {
  const reminder = await getReminderById(db, reminderId);
  if (reminder?.current_published_version_id) {
    return getReminderVersionSteps(db, reminder.current_published_version_id);
  }
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

export async function deleteReminderStep(
  db: D1Database,
  reminderId: string,
  stepId: string,
): Promise<boolean> {
  const result = await db
    .prepare(`DELETE FROM reminder_steps WHERE id = ? AND reminder_id = ?`)
    .bind(stepId, reminderId)
    .run();
  return (result.meta?.changes ?? 0) === 1;
}

// --- 友だちリマインダ ---

/** 旧APIで作られた定義も、最初の登録時に公開版へ固定して互換性を保つ。 */
export async function ensureReminderPublishedVersion(
  db: D1Database,
  reminder: ReminderRow,
): Promise<string> {
  if (reminder.current_published_version_id) return reminder.current_published_version_id;
  const steps = await db.prepare(
    `SELECT * FROM reminder_steps WHERE reminder_id = ? ORDER BY offset_minutes, created_at, id`,
  ).bind(reminder.id).all<ReminderStepRow>();
  const versionId = `reminder-version-legacy-${reminder.id}`;
  const now = jstNow();
  const settings: ReminderDraftSettings = {
    name: reminder.name,
    description: reminder.description,
    lineAccountId: reminder.line_account_id ?? '',
    triggerType: reminder.trigger_type as ReminderDraftSettings['triggerType'],
    deliveryMode: reminder.delivery_mode === 'time' ? 'time' : 'countdown',
    triggerFieldId: reminder.trigger_field_id,
    triggerEventId: reminder.trigger_event_id,
    repeatYearly: reminder.repeat_yearly === 1,
    leapYearPolicy: reminder.leap_year_policy,
    triggerOffsetMinutes: reminder.trigger_offset_minutes,
    sendAtTime: reminder.send_at_time,
    targetTagId: reminder.target_tag_id,
    folderId: reminder.folder_id,
    stopConditions: {
      bookingCancelled: true,
      supportMarkCompleted: false,
      daysAfterTarget: 7,
      friendBlocked: true,
    },
    steps: steps.results.map((step) => ({
      stableStepId: step.id,
      offsetMinutes: step.offset_minutes,
      messageType: step.message_type,
      messageContent: step.message_content,
      offsetDays: step.offset_days,
      sendAtTime: step.send_at_time,
      templateId: step.template_id,
    })),
  };
  await db.batch([
    db.prepare(
      `INSERT OR IGNORE INTO reminder_versions
         (id, reminder_id, version_number, status, settings_snapshot,
          published_at, created_at, updated_at)
       VALUES (?, ?, 1, 'draft', ?, NULL, ?, ?)`,
    ).bind(versionId, reminder.id, JSON.stringify(settings), now, now),
    ...steps.results.map((step, position) => db.prepare(
      `INSERT OR IGNORE INTO reminder_version_steps
         (id, reminder_version_id, stable_step_id, position, offset_minutes,
          message_type, message_content, offset_days, send_at_time, template_id, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).bind(
      `${versionId}-step-${step.id}`,
      versionId,
      step.id,
      position,
      step.offset_minutes,
      step.message_type,
      step.message_content,
      step.offset_days,
      step.send_at_time,
      step.template_id,
      now,
    )),
    db.prepare(
      `UPDATE reminder_versions
          SET status = 'published', published_at = ?, updated_at = ?
        WHERE id = ? AND status = 'draft'`,
    ).bind(now, now, versionId),
    db.prepare(
      `UPDATE reminders
          SET current_published_version_id = ?, lifecycle_status = 'published', updated_at = ?
        WHERE id = ? AND current_published_version_id IS NULL`,
    ).bind(versionId, now, reminder.id),
  ]);
  const current = await getReminderById(db, reminder.id);
  if (!current?.current_published_version_id) throw new Error('REMINDER_PUBLISHED_VERSION_NOT_CREATED');
  return current.current_published_version_id;
}
