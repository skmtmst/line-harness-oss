import type { ReminderRunReadOptions, ReminderScheduleMetrics } from '@line-crm/shared';
import { type ReminderDeliveryRunStatus, type ReminderRowScope, type ReminderDeliveryRunListRow, type ReminderDeliveryStepSummaryRow } from './types.js';
import { reminderRowScopePredicate } from './definitions.js';


export async function listReminderDeliveryRuns(
  db: D1Database,
  input: {
    order?: ReminderRunReadOptions['order'];
    executedOnly?: boolean;
    reminderId: string;
    status?: ReminderDeliveryRunStatus;
    search?: string;
    limit: number;
    offset: number;
    /** R349: 実行行の送信元アカウントで絞る。未指定なら従来どおり全行。 */
    scope?: ReminderRowScope;
  },
): Promise<{ items: ReminderDeliveryRunListRow[]; total: number }> {
  const where = ['rdr.reminder_id = ?'];
  const bindings: unknown[] = [input.reminderId];
  if (input.executedOnly) where.push("rdr.status NOT IN ('queued', 'claimed')");
  if (input.status) {
    where.push('rdr.status = ?');
    bindings.push(input.status);
  }
  if (input.search) {
    where.push(`COALESCE(f.display_name, '') LIKE ? ESCAPE '\\'`);
    bindings.push(`%${input.search.replace(/[\\%_]/g, '\\$&')}%`);
  }
  const scopePredicate = reminderRowScopePredicate('rdr.line_account_id', input.scope, bindings);
  if (scopePredicate) where.push(scopePredicate);
  const predicate = where.join(' AND ');
  const total = await db.prepare(
    `SELECT COUNT(*) AS count
       FROM reminder_delivery_runs rdr
       LEFT JOIN friends f ON f.id = rdr.friend_id
      WHERE ${predicate}`,
  ).bind(...bindings).first<{ count: number }>();
  const rows = await db.prepare(
    `SELECT rdr.*,
            f.display_name AS friend_name,
            la.name AS account_label,
            1 + (
              SELECT COUNT(*)
                FROM reminder_steps earlier
               WHERE earlier.reminder_id = rdr.reminder_id
                 AND (
                   earlier.offset_minutes < current_step.offset_minutes
                   OR (earlier.offset_minutes = current_step.offset_minutes AND earlier.id < current_step.id)
                 )
            ) AS step_number
       FROM reminder_delivery_runs rdr
       LEFT JOIN friends f ON f.id = rdr.friend_id
       LEFT JOIN line_accounts la ON la.id = rdr.line_account_id
       INNER JOIN reminder_steps current_step ON current_step.id = rdr.reminder_step_id
      WHERE ${predicate}
      ORDER BY ${input.order === 'scheduled_asc'
        ? "julianday(CASE WHEN rdr.status = 'retry_wait' THEN COALESCE(rdr.next_retry_at, rdr.scheduled_at) ELSE rdr.scheduled_at END) ASC, rdr.id ASC"
        : "julianday(COALESCE(rdr.completed_at, rdr.started_at, rdr.scheduled_at)) DESC, rdr.id DESC"}
      LIMIT ? OFFSET ?`,
  ).bind(...bindings, input.limit, input.offset).all<ReminderDeliveryRunListRow>();
  return { items: rows.results, total: Number(total?.count ?? 0) };
}

export async function getReminderDeliveryRunSummary(
  db: D1Database,
  reminderId: string,
  /** R349: 集計も実行行の送信元アカウントで絞る。未指定なら従来どおり全行。 */
  scope?: ReminderRowScope,
): Promise<{
  sent: number;
  scheduled: number;
  stopped: number;
  errors: number;
  targetCount: number;
  nextScheduledAt: string | null;
  /** 画面の「今月送った」。月の区切りは利用者の日本時間で数える。 */
  sentThisMonth: number;
  /** 画面の「これから送る（今後7日）」。期限切れの未送分行も残っているので含める。 */
  scheduledNext7Days: number;
} & ReminderScheduleMetrics> {
  const bindings: unknown[] = [reminderId];
  const scopePredicate = reminderRowScopePredicate('line_account_id', scope, bindings);
  const row = await db.prepare(
    `SELECT
       SUM(CASE WHEN status = 'succeeded' THEN 1 ELSE 0 END) AS sent,
       SUM(CASE WHEN status IN ('queued', 'claimed', 'retry_wait') THEN 1 ELSE 0 END) AS scheduled,
       SUM(CASE WHEN status IN ('skipped', 'cancelled') THEN 1 ELSE 0 END) AS stopped,
       SUM(CASE WHEN status = 'permanent_failed' THEN 1 ELSE 0 END) AS errors,
       SUM(CASE
         WHEN status = 'succeeded'
           AND strftime('%Y-%m', completed_at, '+9 hours') = strftime('%Y-%m', 'now', '+9 hours')
         THEN 1 ELSE 0 END) AS sent_this_month,
       SUM(CASE
         WHEN status IN ('queued', 'claimed') AND julianday(scheduled_at) <= julianday('now', '+7 days') THEN 1
         WHEN status = 'retry_wait' AND julianday(next_retry_at) <= julianday('now', '+7 days') THEN 1
         ELSE 0 END) AS scheduled_next7_days,
       SUM(CASE
         WHEN status IN ('queued', 'claimed') AND julianday(scheduled_at) <= julianday('now', '+1 day') THEN 1
         WHEN status = 'retry_wait' AND julianday(next_retry_at) <= julianday('now', '+1 day') THEN 1
         ELSE 0 END) AS scheduled_next24_hours,
       COUNT(DISTINCT friend_reminder_id) AS target_count,
       MIN(CASE
         WHEN status = 'retry_wait' THEN next_retry_at
         WHEN status IN ('queued', 'claimed') THEN scheduled_at
       END) AS next_scheduled_at
     FROM reminder_delivery_runs WHERE reminder_id = ?${scopePredicate ? ` AND ${scopePredicate}` : ''}`,
  ).bind(...bindings).first<{
    sent: number | null;
    scheduled: number | null;
    stopped: number | null;
    errors: number | null;
    sent_this_month: number | null;
    scheduled_next7_days: number | null;
    scheduled_next24_hours: number | null;
    target_count: number | null;
    next_scheduled_at: string | null;
  }>();
  return {
    sent: Number(row?.sent ?? 0),
    scheduled: Number(row?.scheduled ?? 0),
    stopped: Number(row?.stopped ?? 0),
    errors: Number(row?.errors ?? 0),
    sentThisMonth: Number(row?.sent_this_month ?? 0),
    scheduledNext7Days: Number(row?.scheduled_next7_days ?? 0),
    scheduledNext24Hours: Number(row?.scheduled_next24_hours ?? 0),
    targetCount: Number(row?.target_count ?? 0),
    nextScheduledAt: row?.next_scheduled_at ?? null,
  };
}

export async function getReminderDeliveryStepSummaries(
  db: D1Database,
  reminderId: string,
  /** R349: 通ごとの集計も実行行の送信元アカウントで絞る。未指定なら従来どおり全行。 */
  scope?: ReminderRowScope,
): Promise<ReminderDeliveryStepSummaryRow[]> {
  // 結合条件の `?` が WHERE より前にあるため、束ねる順序も合わせる。
  const scopeBindings: unknown[] = [];
  const scopePredicate = reminderRowScopePredicate('rdr.line_account_id', scope, scopeBindings);
  const bindings: unknown[] = [...scopeBindings, reminderId];
  const rows = await db.prepare(
    `SELECT rs.id, rs.offset_minutes, rs.message_type, rs.message_content,
            SUM(CASE WHEN rdr.status = 'succeeded' THEN 1 ELSE 0 END) AS sent,
            SUM(CASE WHEN rdr.status = 'permanent_failed' THEN 1 ELSE 0 END) AS errors
       FROM reminder_steps rs
       LEFT JOIN reminder_delivery_runs rdr
         ON rdr.reminder_step_id = rs.id${scopePredicate ? ` AND ${scopePredicate}` : ''}
      WHERE rs.reminder_id = ?
      GROUP BY rs.id, rs.offset_minutes, rs.message_type, rs.message_content
      ORDER BY rs.offset_minutes ASC, rs.id ASC`,
  ).bind(...bindings).all<ReminderDeliveryStepSummaryRow>();
  return rows.results.map((row) => ({
    ...row,
    sent: Number(row.sent ?? 0),
    errors: Number(row.errors ?? 0),
  }));
}
