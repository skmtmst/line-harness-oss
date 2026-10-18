import type { ReminderDraftSettings } from '@line-crm/db';
import type { StarterItem } from './style-starter-definition.js';
import { StyleError } from './style-setup-core.js';
/** Always create a new draft so a shop's published schedule and its history remain intact. */
export async function reminderReplacement(
  db: D1Database,
  account: string,
  id: string,
  item: StarterItem,
  now: string,
) {
  const current = await db
    .prepare(
      `SELECT v.settings_snapshot FROM reminders r JOIN reminder_versions v ON v.id=COALESCE(r.current_draft_version_id,r.current_published_version_id) WHERE r.id=? AND r.line_account_id=?`,
    )
    .bind(id, account)
    .first<{ settings_snapshot: string }>();
  if (!current) throw new StyleError('not_found', 404);
  const settings = JSON.parse(
    current.settings_snapshot,
  ) as ReminderDraftSettings;
  const versionId = crypto.randomUUID(),
    step = crypto.randomUUID();
  settings.name = '【見本】' + item.name;
  settings.steps = [
    {
      stableStepId: step,
      offsetMinutes: item.offsetMinutes ?? -1440,
      offsetDays: item.offsetDays ?? null,
      sendAtTime: item.sendAtTime ?? null,
      messageType: 'text',
      messageContent: JSON.stringify({ text: item.text ?? item.name }),
    },
  ];
  return [
    db
      .prepare(
        `UPDATE reminder_versions SET status='superseded',updated_at=? WHERE id=(SELECT current_draft_version_id FROM reminders WHERE id=? AND line_account_id=?)`,
      )
      .bind(now, id, account),
    db
      .prepare(
        `INSERT INTO reminder_versions(id,reminder_id,version_number,status,settings_snapshot,created_at,updated_at) SELECT ?,?,COALESCE(MAX(version_number),0)+1,'draft',?,?,? FROM reminder_versions WHERE reminder_id=?`,
      )
      .bind(versionId, id, JSON.stringify(settings), now, now, id),
    db
      .prepare(
        `INSERT INTO reminder_version_steps(id,reminder_version_id,stable_step_id,position,offset_minutes,offset_days,send_at_time,message_type,message_content,created_at) VALUES(?,?,?,0,?,?,?,'text',?,?)`,
      )
      .bind(
        crypto.randomUUID(),
        versionId,
        step,
        item.offsetMinutes ?? -1440,
        item.offsetDays ?? null,
        item.sendAtTime ?? null,
        JSON.stringify({ text: item.text ?? item.name }),
        now,
      ),
    db
      .prepare(
        `UPDATE reminders SET name=?,is_active=0,lifecycle_status='draft',current_draft_version_id=?,updated_at=? WHERE id=? AND line_account_id=?`,
      )
      .bind(settings.name, versionId, now, id, account),
  ];
}
