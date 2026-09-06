export const ANALYTICS_REPORT_SECTIONS = [
  'friends', 'reactions', 'routes', 'usage', 'mileage',
] as const;
export type AnalyticsReportSection = (typeof ANALYTICS_REPORT_SECTIONS)[number];
export type AnalyticsReportCadence = 'weekly' | 'monthly';
export type AnalyticsReportChannel = 'dashboard' | 'email' | 'line';
export type AnalyticsReportRecipient = {
  kind: 'staff' | 'email';
  staffId?: string;
  email?: string;
  label: string;
};
export type AnalyticsReportAlertRule = {
  metric: 'block_rate' | 'friend_adds' | 'conversions';
  operator: 'greater_than' | 'decrease_percent' | 'zero_streak_days';
  threshold: number;
  minimumSample: number;
};

export interface AnalyticsReportSchedule {
  id: string;
  lineAccountId: string;
  name: string;
  sections: AnalyticsReportSection[];
  savedAnalysisIds: string[];
  cadence: AnalyticsReportCadence;
  weekday: number | null;
  monthDay: number | null;
  sendTime: string;
  timeZone: string;
  periodDays: number;
  recipients: AnalyticsReportRecipient[];
  channels: AnalyticsReportChannel[];
  alertRules: AnalyticsReportAlertRule[];
  status: 'active' | 'paused' | 'archived';
  isOneTime: boolean;
  nextRunAt: string;
  createdBy: string | null;
  createdAt: string;
  updatedAt: string;
}

type ScheduleRow = {
  id: string; line_account_id: string; name: string; sections_json: string;
  saved_analysis_ids_json: string; cadence: AnalyticsReportCadence; weekday: number | null;
  month_day: number | null; send_time: string; time_zone: string; period_days: number;
  recipients_json: string; channels_json: string; alert_rules_json: string;
  status: AnalyticsReportSchedule['status']; is_one_time: number; next_run_at: string; created_by: string | null;
  created_at: string; updated_at: string;
};

function parseJson<T>(value: string): T { return JSON.parse(value) as T; }
function serialize(row: ScheduleRow): AnalyticsReportSchedule {
  return {
    id: row.id, lineAccountId: row.line_account_id, name: row.name,
    sections: parseJson(row.sections_json), savedAnalysisIds: parseJson(row.saved_analysis_ids_json),
    cadence: row.cadence, weekday: row.weekday, monthDay: row.month_day,
    sendTime: row.send_time, timeZone: row.time_zone, periodDays: row.period_days,
    recipients: parseJson(row.recipients_json), channels: parseJson(row.channels_json),
    alertRules: parseJson(row.alert_rules_json), status: row.status,
    isOneTime: Boolean(row.is_one_time), nextRunAt: row.next_run_at,
    createdBy: row.created_by, createdAt: row.created_at, updatedAt: row.updated_at,
  };
}

export async function getAnalyticsReportSchedules(db: D1Database, lineAccountId: string) {
  const result = await db.prepare(
    `SELECT * FROM analytics_report_schedules
      WHERE line_account_id = ? AND status != 'archived'
      ORDER BY created_at DESC, id DESC`,
  ).bind(lineAccountId).all<ScheduleRow>();
  return result.results.map(serialize);
}

export async function createAnalyticsReportSchedule(db: D1Database, input: {
  lineAccountId: string; name: string; sections: AnalyticsReportSection[];
  savedAnalysisIds: string[]; cadence: AnalyticsReportCadence; weekday: number | null;
  monthDay: number | null; sendTime: string; timeZone: string; periodDays: number;
  recipients: AnalyticsReportRecipient[]; channels: AnalyticsReportChannel[];
  alertRules: AnalyticsReportAlertRule[]; nextRunAt: string; createdBy: string; now: string;
  isOneTime?: boolean;
}) {
  const id = crypto.randomUUID();
  await db.prepare(
    `INSERT INTO analytics_report_schedules (
       id, line_account_id, name, sections_json, saved_analysis_ids_json, cadence,
       weekday, month_day, send_time, time_zone, period_days, recipients_json,
       channels_json, alert_rules_json, status, is_one_time, next_run_at, created_by, created_at, updated_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'active', ?, ?, ?, ?, ?)`,
  ).bind(
    id, input.lineAccountId, input.name, JSON.stringify(input.sections),
    JSON.stringify(input.savedAnalysisIds), input.cadence, input.weekday, input.monthDay,
    input.sendTime, input.timeZone, input.periodDays, JSON.stringify(input.recipients),
    JSON.stringify(input.channels), JSON.stringify(input.alertRules), input.isOneTime ? 1 : 0, input.nextRunAt,
    input.createdBy, input.now, input.now,
  ).run();
  const row = await db.prepare('SELECT * FROM analytics_report_schedules WHERE id = ?')
    .bind(id).first<ScheduleRow>();
  return serialize(row!);
}

export async function claimDueAnalyticsReportSchedules(db: D1Database, now: string, limit = 10) {
  const rows = await db.prepare(
    `SELECT * FROM analytics_report_schedules
      WHERE status = 'active' AND next_run_at <= ?
      ORDER BY next_run_at ASC LIMIT ?`,
  ).bind(now, limit).all<ScheduleRow>();
  return rows.results.map(serialize);
}

export async function beginAnalyticsReportRun(db: D1Database, input: {
  scheduleId: string; lineAccountId: string; scheduledFor: string; periodFrom: string;
  periodTo: string; timeZone: string; dataCutoffAt: string;
}) {
  const id = crypto.randomUUID();
  const result = await db.prepare(
    `INSERT OR IGNORE INTO analytics_report_runs (
       id, schedule_id, line_account_id, scheduled_for, period_from, period_to,
       time_zone, data_cutoff_at, state, result_json, started_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'running', '{}', ?)`,
  ).bind(id, input.scheduleId, input.lineAccountId, input.scheduledFor, input.periodFrom,
    input.periodTo, input.timeZone, input.dataCutoffAt, input.dataCutoffAt).run();
  return Number(result.meta.changes ?? 0) ? id : null;
}

export async function finishAnalyticsReportRun(db: D1Database, input: {
  id: string; state: 'available' | 'partial' | 'unavailable' | 'failed'; result: unknown;
  deliveryResults: unknown[]; errorCode?: string | null; completedAt: string;
}) {
  await db.prepare(
    `UPDATE analytics_report_runs SET state = ?, result_json = ?, delivery_results_json = ?,
       error_code = ?, completed_at = ? WHERE id = ? AND state = 'running'`,
  ).bind(input.state, JSON.stringify(input.result), JSON.stringify(input.deliveryResults),
    input.errorCode ?? null, input.completedAt, input.id).run();
}

export async function advanceAnalyticsReportSchedule(
  db: D1Database, id: string, previousNextRunAt: string, nextRunAt: string, now: string,
) {
  await db.prepare(
    `UPDATE analytics_report_schedules SET next_run_at = ?, updated_at = ?
      WHERE id = ? AND next_run_at = ?`,
  ).bind(nextRunAt, now, id, previousNextRunAt).run();
}

export async function archiveAnalyticsReportSchedule(db: D1Database, id: string, now: string) {
  await db.prepare(
    `UPDATE analytics_report_schedules SET status = 'archived', updated_at = ?
      WHERE id = ? AND is_one_time = 1`,
  ).bind(now, id).run();
}

export async function purgeExpiredAnalyticsReportRuns(db: D1Database, cutoff: string) {
  const result = await db.prepare('DELETE FROM analytics_report_runs WHERE scheduled_for < ?')
    .bind(cutoff).run();
  return Number(result.meta.changes ?? 0);
}
