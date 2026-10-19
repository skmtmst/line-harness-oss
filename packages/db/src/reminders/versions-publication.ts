import { jstNow } from '../utils.js';
import { type ReminderVersionRow, type ReminderStepRow } from './types.js';
import { getReminderDraftVersion, parseReminderVersionSettings, getReminderVersionById } from './versions-drafts.js';


/** 公開版を固定し、既存登録の reminder_version_id は変更しない。 */
export async function publishReminderDraftVersion(
  db: D1Database,
  reminderId: string,
  staffId: string | null,
): Promise<ReminderVersionRow> {
  const draft = await getReminderDraftVersion(db, reminderId);
  if (!draft) throw new Error('REMINDER_DRAFT_NOT_FOUND');
  if (draft.last_test_status !== 'succeeded') throw new Error('REMINDER_DRAFT_NOT_TESTED');
  const settings = parseReminderVersionSettings(draft);
  const now = jstNow();
  const versionSteps = await db.prepare(
    `SELECT stable_step_id, offset_minutes, message_type, message_content,
            offset_days, send_at_time, template_id
       FROM reminder_version_steps
      WHERE reminder_version_id = ? ORDER BY position, stable_step_id`,
  ).bind(draft.id).all<{
    stable_step_id: string;
    offset_minutes: number;
    message_type: string;
    message_content: string;
    offset_days: number | null;
    send_at_time: string | null;
    template_id: string | null;
  }>();

  const statements: D1PreparedStatement[] = [
    db.prepare(
      `UPDATE reminder_versions SET status = 'superseded', updated_at = ?
        WHERE reminder_id = ? AND status = 'published'`,
    ).bind(now, reminderId),
    db.prepare(
      `UPDATE reminder_versions
          SET status = 'published', published_at = ?, published_by_staff_id = ?, updated_at = ?
        WHERE id = ? AND status = 'draft'`,
    ).bind(now, staffId, now, draft.id),
    db.prepare(
      `UPDATE reminders
          SET name = ?, description = ?, line_account_id = ?, trigger_type = ?,
              delivery_mode = ?, trigger_field_id = ?, trigger_event_id = ?, repeat_yearly = ?,
              leap_year_policy = ?, trigger_offset_minutes = ?, send_at_time = ?, target_tag_id = ?, folder_id = ?,
              is_active = 1, lifecycle_status = 'published',
              current_published_version_id = ?, current_draft_version_id = NULL, updated_at = ?
        WHERE id = ? AND deleted_at IS NULL`,
    ).bind(
      settings.name,
      settings.description ?? null,
      settings.lineAccountId,
      settings.triggerType,
      settings.deliveryMode,
      settings.triggerFieldId ?? null,
      settings.triggerEventId ?? null,
      settings.repeatYearly ? 1 : 0,
      settings.leapYearPolicy ?? 'mar1',
      settings.triggerOffsetMinutes ?? null,
      settings.sendAtTime ?? null,
      settings.targetTagId ?? null,
      settings.folderId ?? null,
      draft.id,
      now,
      reminderId,
    ),
  ];
  for (const step of versionSteps.results) {
    statements.push(db.prepare(
      `INSERT INTO reminder_steps
         (id, reminder_id, offset_minutes, message_type, message_content,
          offset_days, send_at_time, template_id, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET
         offset_minutes = excluded.offset_minutes,
         message_type = excluded.message_type,
         message_content = excluded.message_content,
         offset_days = excluded.offset_days,
         send_at_time = excluded.send_at_time,
         template_id = excluded.template_id`,
    ).bind(
      step.stable_step_id,
      reminderId,
      step.offset_minutes,
      step.message_type,
      step.message_content,
      step.offset_days,
      step.send_at_time,
      step.template_id,
      now,
    ));
  }
  await db.batch(statements);
  const published = await getReminderVersionById(db, draft.id);
  if (!published || published.status !== 'published') throw new Error('REMINDER_DRAFT_NOT_PUBLISHED');
  return published;
}

export async function getReminderVersionSteps(
  db: D1Database,
  versionId: string,
): Promise<ReminderStepRow[]> {
  const result = await db.prepare(
    `SELECT rvs.stable_step_id AS id, rv.reminder_id, rvs.offset_minutes,
            rvs.message_type, rvs.message_content, rvs.created_at,
            rvs.offset_days, rvs.send_at_time, rvs.template_id
       FROM reminder_version_steps rvs
       JOIN reminder_versions rv ON rv.id = rvs.reminder_version_id
      WHERE rvs.reminder_version_id = ?
      ORDER BY rvs.position, rvs.stable_step_id`,
  ).bind(versionId).all<ReminderStepRow>();
  return result.results;
}
