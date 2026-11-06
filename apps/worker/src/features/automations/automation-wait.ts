import { nextDayWaitAt, parseAutomationWait } from '@line-crm/shared';
import { AutomationActionError } from './automation-action-error.js';
import type { RunRow, StepRow } from './run-types.js';

export function addMinutes(value: string, minutes: number): string {
  const date = new Date(value);
  date.setMinutes(date.getMinutes() + minutes);
  return date.toISOString();
}


export async function scheduleAutomationWait(
  db: D1Database,
  run: RunRow,
  step: StepRow,
  params: Record<string, unknown>,
  now: string,
  inputEvent: Record<string, unknown>,
): Promise<void> {
  const wait = parseAutomationWait(params, Number.POSITIVE_INFINITY);
  if (!wait) throw new AutomationActionError('invalid_wait_duration', '待つ時間か翌日の時刻を指定してください', false);
  let resumeAt: string;
  if ('mode' in wait) {
    let occurredAt = run.created_at;
    let timeZone = 'Asia/Tokyo';
    const eventType = inputEvent.type;
    if (typeof eventType === 'string' && eventType.startsWith('restaurant.')) {
      const origin = await db.prepare(`SELECT e.occurred_at,s.timezone FROM rt_reservation_events e
        JOIN rt_stores s ON s.id=e.store_id AND s.line_account_id=e.line_account_id
        WHERE e.id=? AND e.line_account_id=? AND e.friend_id=? AND e.event_type=?`)
        .bind(run.source_event_id,run.line_account_id,run.friend_id,eventType).first<{occurred_at:string;timezone:string}>();
      if (!origin) throw new AutomationActionError('wait_origin_not_found', '元の出来事を確認できません', false);
      occurredAt = origin.occurred_at;
      timeZone = origin.timezone;
    }
    resumeAt = nextDayWaitAt(occurredAt,wait.sendAtTime,timeZone);
  } else {
    resumeAt = addMinutes(now,wait.durationMinutes);
  }
  await db.batch([db.prepare(
    `UPDATE automation_run_steps
        SET status = 'waiting', output_json = ?, retry_at = NULL, lease_expires_at = NULL
      WHERE id = ? AND status = 'running'
        AND EXISTS (SELECT 1 FROM automation_runs WHERE id = ? AND status = 'running')`,
  ).bind(JSON.stringify({ resumeAt }), step.id, run.id), db.prepare(
    `UPDATE automation_runs
        SET status = 'waiting', resume_at = ?, lease_expires_at = NULL
      WHERE id = ? AND status = 'running'`,
  ).bind(resumeAt, run.id)]);
}

/** 翌日の待機は予定日の日本時間24時を過ぎたら、後続も実行せず記録に残す。 */
export async function expireNextDayWait(db: D1Database, runId: string, now: string): Promise<boolean> {
  const waits = await db.prepare(`SELECT output_json FROM automation_run_steps
    WHERE automation_run_id=? AND action_type='wait' AND status IN ('waiting','success')
      AND json_extract(input_json,'$.mode')='next_day'`).bind(runId).all<{ output_json: string | null }>();
  const jstDay = (value: string) => Math.floor((Date.parse(value) + 9 * 60 * 60 * 1000) / 86400000);
  const expired = waits.results.some(step => {
    const resumeAt: unknown = JSON.parse(step.output_json ?? '{}').resumeAt;
    return typeof resumeAt === 'string' && jstDay(now) > jstDay(resumeAt);
  });
  if (!expired) return false;
  const result = await db.batch([db.prepare(`UPDATE automation_run_steps
    SET status='cancelled', error_code='wait_expired', error_message='期限切れで送らなかった',
        completed_at=?, retry_at=NULL, lease_expires_at=NULL
    WHERE automation_run_id=? AND status IN ('queued','running','waiting')
      AND EXISTS (SELECT 1 FROM automation_runs WHERE id=? AND status IN ('running','waiting'))`)
    .bind(now,runId,runId), db.prepare(`UPDATE automation_runs
    SET status='cancelled', completed_at=?, resume_at=NULL, lease_expires_at=NULL
    WHERE id=? AND status IN ('running','waiting')`).bind(now,runId)]);
  return (result[1].meta?.changes ?? 0) === 1;
}
