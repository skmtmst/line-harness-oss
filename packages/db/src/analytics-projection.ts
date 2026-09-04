export interface AnalyticsProjectionRange {
  fromDate: string;
  toDate: string;
}

export interface AnalyticsProjectionResult {
  accountId: string;
  fromDate: string;
  toDate: string;
  sourceEventCount: number;
  projectedCount: number;
  mismatchCount: number;
  status: 'matched' | 'mismatched';
}

interface ProjectionSourceRow {
  id: string;
  event_type: string;
  friend_id: string | null;
  occurred_at: string;
}

function dateInTimeZone(value: string | Date, timeZone: string): string {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) throw new Error('analytics_projection_time_invalid');
  let parts: Intl.DateTimeFormatPart[];
  try {
    parts = new Intl.DateTimeFormat('en-US', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).formatToParts(date);
  } catch {
    throw new Error('analytics_projection_timezone_invalid');
  }
  const valueOf = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((part) => part.type === type)?.value ?? '';
  return `${valueOf('year')}-${valueOf('month')}-${valueOf('day')}`;
}

function addUtcDays(date: string, days: number): string {
  const parsed = new Date(`${date}T00:00:00.000Z`);
  if (Number.isNaN(parsed.getTime())) throw new Error('analytics_projection_date_invalid');
  parsed.setUTCDate(parsed.getUTCDate() + days);
  return parsed.toISOString().slice(0, 10);
}

export function recentAnalyticsProjectionRange(
  now: Date,
  timeZone: string,
  days = 7,
): AnalyticsProjectionRange {
  if (!Number.isInteger(days) || days < 1 || days > 31) {
    throw new Error('analytics_projection_days_invalid');
  }
  const toDate = dateInTimeZone(now, timeZone);
  return { fromDate: addUtcDays(toDate, -(days - 1)), toDate };
}

async function loadProjectionEvents(
  db: D1Database,
  accountId: string,
  range: AnalyticsProjectionRange,
  timeZone: string,
): Promise<Array<ProjectionSourceRow & { metricDate: string }>> {
  // IANAタイムゾーンの境界計算をSQLiteへ任せない。対象日の前後2日を読み、
  // JavaScriptのIntlでアカウントの暦日に絞る。UTC±14時間を十分に覆う。
  const broadFrom = `${addUtcDays(range.fromDate, -2)}T00:00:00.000Z`;
  const broadTo = `${addUtcDays(range.toDate, 2)}T23:59:59.999Z`;
  const result = await db.prepare(
    `SELECT id, event_type, friend_id, occurred_at
       FROM analytics_events
      WHERE line_account_id = ? AND occurred_at >= ? AND occurred_at <= ?
      ORDER BY occurred_at, id`,
  ).bind(accountId, broadFrom, broadTo).all<ProjectionSourceRow>();
  return result.results
    .map((row) => ({ ...row, metricDate: dateInTimeZone(row.occurred_at, timeZone) }))
    .filter((row) => row.metricDate >= range.fromDate && row.metricDate <= range.toDate);
}

export async function rebuildAnalyticsDailyMetrics(
  db: D1Database,
  input: {
    accountId: string;
    timeZone: string;
    range: AnalyticsProjectionRange;
    dataCutoffAt: string;
  },
): Promise<AnalyticsProjectionResult> {
  const events = await loadProjectionEvents(db, input.accountId, input.range, input.timeZone);
  const groups = new Map<string, {
    date: string;
    eventType: string;
    count: number;
    friends: Set<string>;
  }>();
  for (const event of events) {
    const key = `${event.metricDate}\u0000${event.event_type}`;
    const group = groups.get(key) ?? {
      date: event.metricDate,
      eventType: event.event_type,
      count: 0,
      friends: new Set<string>(),
    };
    group.count += 1;
    if (event.friend_id) group.friends.add(event.friend_id);
    groups.set(key, group);
  }

  // 1日ごとにDELETEとINSERTを同じbatchへ入れる。7日分を1batchへ詰めると、
  // イベント種類が増えたときにD1の1回の処理量が膨らむため。
  for (
    let metricDate = input.range.fromDate;
    metricDate <= input.range.toDate;
    metricDate = addUtcDays(metricDate, 1)
  ) {
    const statements: D1PreparedStatement[] = [
      db.prepare(
        `DELETE FROM analytics_daily_metrics
          WHERE line_account_id = ? AND metric_date = ?
            AND metric_key IN ('event_total', 'unique_friends')`,
      ).bind(input.accountId, metricDate),
    ];
    for (const group of groups.values()) {
      if (group.date !== metricDate) continue;
      statements.push(db.prepare(
        `INSERT INTO analytics_daily_metrics (
           line_account_id, metric_date, metric_key, dimension_key, dimension_value,
           numerator, denominator, value, state, data_cutoff_at, updated_at
         ) VALUES (?, ?, ?, 'event_type', ?, ?, NULL, ?, 'available', ?, datetime('now'))`,
      ).bind(
        input.accountId,
        group.date,
        'event_total',
        group.eventType,
        group.count,
        group.count,
        input.dataCutoffAt,
      ), db.prepare(
        `INSERT INTO analytics_daily_metrics (
           line_account_id, metric_date, metric_key, dimension_key, dimension_value,
           numerator, denominator, value, state, data_cutoff_at, updated_at
         ) VALUES (?, ?, ?, 'event_type', ?, ?, NULL, ?, 'available', ?, datetime('now'))`,
      ).bind(
        input.accountId,
        group.date,
        'unique_friends',
        group.eventType,
        group.friends.size,
        group.friends.size,
        input.dataCutoffAt,
      ));
    }
    await db.batch(statements);
  }

  const projected = await db.prepare(
    `SELECT COALESCE(SUM(numerator), 0) AS count
       FROM analytics_daily_metrics
      WHERE line_account_id = ? AND metric_date >= ? AND metric_date <= ?
        AND metric_key = 'event_total'`,
  ).bind(input.accountId, input.range.fromDate, input.range.toDate)
    .first<{ count: number }>();
  const projectedCount = Number(projected?.count ?? 0);
  const mismatchCount = Math.abs(events.length - projectedCount);
  const completedAt = new Date().toISOString();
  const status = mismatchCount === 0 ? 'matched' : 'mismatched';
  await db.prepare(
    `INSERT INTO analytics_reconciliation_runs (
       id, line_account_id, range_from, range_to, source_event_count,
       projected_count, mismatch_count, status, started_at, completed_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(line_account_id, range_to) DO UPDATE SET
       range_from = excluded.range_from,
       source_event_count = excluded.source_event_count,
       projected_count = excluded.projected_count,
       mismatch_count = excluded.mismatch_count,
       status = excluded.status,
       error_code = NULL,
       started_at = excluded.started_at,
       completed_at = excluded.completed_at`,
  ).bind(
    crypto.randomUUID(),
    input.accountId,
    input.range.fromDate,
    input.range.toDate,
    events.length,
    projectedCount,
    mismatchCount,
    status,
    input.dataCutoffAt,
    completedAt,
  ).run();

  return {
    accountId: input.accountId,
    fromDate: input.range.fromDate,
    toDate: input.range.toDate,
    sourceEventCount: events.length,
    projectedCount,
    mismatchCount,
    status,
  };
}

type AnalyticsProjectionProgress = {
  line_account_id: string;
  cycle_id: string;
  range_from: string;
  range_to: string;
  time_zone: string;
  data_cutoff_at: string;
  broad_from: string;
  broad_to: string;
  last_occurred_at: string;
  last_event_id: string;
  source_event_count: number;
  phase: 'scan' | 'cleanup';
};

export type AnalyticsProjectionChunkResult = AnalyticsProjectionResult & {
  completed: boolean;
  readRows: number;
  cursor: { occurredAt: string; eventId: string } | null;
};

export async function getAnalyticsProjectionSchedulerCursor(
  db: D1Database,
  now: string,
): Promise<string> {
  await db.prepare(
    `INSERT OR IGNORE INTO analytics_projection_scheduler_state (id, last_account_id, updated_at)
     VALUES (1, '', ?)`,
  ).bind(now).run();
  const row = await db.prepare(
    `SELECT last_account_id FROM analytics_projection_scheduler_state WHERE id = 1`,
  ).bind().first<{ last_account_id: string }>();
  return row?.last_account_id ?? '';
}

export async function saveAnalyticsProjectionSchedulerCursor(
  db: D1Database,
  accountId: string,
  now: string,
): Promise<void> {
  await db.prepare(
    `UPDATE analytics_projection_scheduler_state SET last_account_id = ?, updated_at = ? WHERE id = 1`,
  ).bind(accountId, now).run();
}

async function loadOrCreateProjectionProgress(
  db: D1Database,
  input: {
    accountId: string;
    timeZone: string;
    range: AnalyticsProjectionRange;
    dataCutoffAt: string;
  },
): Promise<AnalyticsProjectionProgress> {
  let state = await db.prepare(
    `SELECT * FROM analytics_projection_progress WHERE line_account_id = ?`,
  ).bind(input.accountId).first<AnalyticsProjectionProgress>();
  if (state) return state;

  const cycleId = crypto.randomUUID();
  const broadFrom = `${addUtcDays(input.range.fromDate, -2)}T00:00:00.000Z`;
  const broadTo = `${addUtcDays(input.range.toDate, 2)}T23:59:59.999Z`;
  await db.prepare(
    `INSERT INTO analytics_projection_progress (
       line_account_id, cycle_id, range_from, range_to, time_zone, data_cutoff_at,
       broad_from, broad_to, last_occurred_at, last_event_id, source_event_count, updated_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, '', '', 0, ?)`,
  ).bind(
    input.accountId,
    cycleId,
    input.range.fromDate,
    input.range.toDate,
    input.timeZone,
    input.dataCutoffAt,
    broadFrom,
    broadTo,
    input.dataCutoffAt,
  ).run();
  state = await db.prepare(
    `SELECT * FROM analytics_projection_progress WHERE line_account_id = ?`,
  ).bind(input.accountId).first<AnalyticsProjectionProgress>();
  if (!state) throw new Error('analytics_projection_progress_unavailable');
  return state;
}

function jsonInsertStatements(
  db: D1Database,
  sql: string,
  fixedBindings: unknown[],
  rows: Array<Record<string, unknown>>,
): D1PreparedStatement[] {
  const statements: D1PreparedStatement[] = [];
  for (let index = 0; index < rows.length; index += 500) {
    statements.push(db.prepare(sql).bind(
      ...fixedBindings,
      JSON.stringify(rows.slice(index, index + 500)),
    ));
  }
  return statements;
}

/** cron向け。最大3,000イベントだけを読み、確定後の中間行整理も分割する。 */
export async function rebuildAnalyticsDailyMetricsChunk(
  db: D1Database,
  input: {
    accountId: string;
    timeZone: string;
    range: AnalyticsProjectionRange;
    dataCutoffAt: string;
    limit?: number;
  },
): Promise<AnalyticsProjectionChunkResult> {
  const state = await loadOrCreateProjectionProgress(db, input);
  const limit = Math.max(1, Math.min(input.limit ?? 3_000, 3_000));
  if (state.phase === 'cleanup') {
    const reconciliation = await db.prepare(
      `SELECT projected_count, mismatch_count, status
         FROM analytics_reconciliation_runs
        WHERE line_account_id = ? AND range_to = ?`,
    ).bind(state.line_account_id, state.range_to).first<{
      projected_count: number;
      mismatch_count: number;
      status: 'matched' | 'mismatched';
    }>();
    if (!reconciliation) throw new Error('analytics_projection_reconciliation_unavailable');
    const deletedFriends = await db.prepare(
      `DELETE FROM analytics_projection_friend_stage
        WHERE rowid IN (
          SELECT rowid FROM analytics_projection_friend_stage
           WHERE line_account_id = ? AND cycle_id = ?
           LIMIT ?
        )`,
    ).bind(state.line_account_id, state.cycle_id, limit).run();
    const deletedFriendRows = Number(deletedFriends.meta?.changes ?? 0);
    const remaining = limit - deletedFriendRows;
    let deletedMetricRows = 0;
    if (remaining > 0) {
      const deletedMetrics = await db.prepare(
        `DELETE FROM analytics_projection_metric_stage
          WHERE rowid IN (
            SELECT rowid FROM analytics_projection_metric_stage
             WHERE line_account_id = ? AND cycle_id = ?
             LIMIT ?
          )`,
      ).bind(state.line_account_id, state.cycle_id, remaining).run();
      deletedMetricRows = Number(deletedMetrics.meta?.changes ?? 0);
    }
    const readRows = deletedFriendRows + deletedMetricRows;
    const completed = readRows < limit;
    if (completed) {
      await db.prepare(
        `DELETE FROM analytics_projection_progress
          WHERE line_account_id = ? AND cycle_id = ?`,
      ).bind(state.line_account_id, state.cycle_id).run();
    }
    return {
      accountId: state.line_account_id,
      fromDate: state.range_from,
      toDate: state.range_to,
      sourceEventCount: Number(state.source_event_count),
      projectedCount: Number(reconciliation.projected_count),
      mismatchCount: Number(reconciliation.mismatch_count),
      status: reconciliation.status,
      completed,
      readRows,
      cursor: null,
    };
  }
  const page = await db.prepare(
    `SELECT id, event_type, friend_id, occurred_at
       FROM analytics_events
      WHERE line_account_id = ? AND occurred_at >= ? AND occurred_at <= ?
        AND occurred_at <= ?
        AND (occurred_at > ? OR (occurred_at = ? AND id > ?))
      ORDER BY occurred_at ASC, id ASC LIMIT ?`,
  ).bind(
    state.line_account_id,
    state.broad_from,
    state.broad_to,
    state.data_cutoff_at,
    state.last_occurred_at,
    state.last_occurred_at,
    state.last_event_id,
    limit,
  ).all<ProjectionSourceRow>();
  const events = page.results
    .map((row) => ({ ...row, metricDate: dateInTimeZone(row.occurred_at, state.time_zone) }))
    .filter((row) => row.metricDate >= state.range_from && row.metricDate <= state.range_to);
  const metrics = new Map<string, { metricDate: string; eventType: string; count: number }>();
  const friends = new Map<string, { metricDate: string; eventType: string; friendId: string }>();
  for (const event of events) {
    const key = `${event.metricDate}\u0000${event.event_type}`;
    const metric = metrics.get(key) ?? {
      metricDate: event.metricDate,
      eventType: event.event_type,
      count: 0,
    };
    metric.count += 1;
    metrics.set(key, metric);
    if (event.friend_id) {
      friends.set(`${key}\u0000${event.friend_id}`, {
        metricDate: event.metricDate,
        eventType: event.event_type,
        friendId: event.friend_id,
      });
    }
  }

  const last = page.results.at(-1);
  const nextOccurredAt = last?.occurred_at ?? state.last_occurred_at;
  const nextEventId = last?.id ?? state.last_event_id;
  const statements = [
    ...jsonInsertStatements(db, `
      INSERT INTO analytics_projection_metric_stage
        (line_account_id, cycle_id, metric_date, event_type, event_count)
      SELECT ?, ?,
             json_extract(value, '$.metricDate'),
             json_extract(value, '$.eventType'),
             CAST(json_extract(value, '$.count') AS INTEGER)
        FROM json_each(?) WHERE 1
      ON CONFLICT(line_account_id, cycle_id, metric_date, event_type)
      DO UPDATE SET event_count = event_count + excluded.event_count`,
    [state.line_account_id, state.cycle_id], [...metrics.values()]),
    ...jsonInsertStatements(db, `
      INSERT OR IGNORE INTO analytics_projection_friend_stage
        (line_account_id, cycle_id, metric_date, event_type, friend_id)
      SELECT ?, ?,
             json_extract(value, '$.metricDate'),
             json_extract(value, '$.eventType'),
             json_extract(value, '$.friendId')
        FROM json_each(?)`,
    [state.line_account_id, state.cycle_id], [...friends.values()]),
    db.prepare(
      `UPDATE analytics_projection_progress
          SET last_occurred_at = ?, last_event_id = ?,
              source_event_count = source_event_count + ?, updated_at = ?
        WHERE line_account_id = ? AND cycle_id = ?`,
    ).bind(
      nextOccurredAt,
      nextEventId,
      events.length,
      input.dataCutoffAt,
      state.line_account_id,
      state.cycle_id,
    ),
  ];
  await db.batch(statements);

  const sourceEventCount = Number(state.source_event_count) + events.length;
  const completed = page.results.length < limit;
  if (!completed) {
    return {
      accountId: state.line_account_id,
      fromDate: state.range_from,
      toDate: state.range_to,
      sourceEventCount,
      projectedCount: 0,
      mismatchCount: 0,
      status: 'matched',
      completed: false,
      readRows: page.results.length,
      cursor: { occurredAt: nextOccurredAt, eventId: nextEventId },
    };
  }

  await db.batch([
    db.prepare(
      `DELETE FROM analytics_daily_metrics
        WHERE line_account_id = ? AND metric_date >= ? AND metric_date <= ?
          AND metric_key IN ('event_total', 'unique_friends')`,
    ).bind(state.line_account_id, state.range_from, state.range_to),
    db.prepare(
      `INSERT INTO analytics_daily_metrics (
         line_account_id, metric_date, metric_key, dimension_key, dimension_value,
         numerator, denominator, value, state, data_cutoff_at, updated_at
       )
       SELECT line_account_id, metric_date, 'event_total', 'event_type', event_type,
              event_count, NULL, event_count, 'available', ?, datetime('now')
         FROM analytics_projection_metric_stage
        WHERE line_account_id = ? AND cycle_id = ?`,
    ).bind(state.data_cutoff_at, state.line_account_id, state.cycle_id),
    db.prepare(
      `INSERT INTO analytics_daily_metrics (
         line_account_id, metric_date, metric_key, dimension_key, dimension_value,
         numerator, denominator, value, state, data_cutoff_at, updated_at
       )
       SELECT line_account_id, metric_date, 'unique_friends', 'event_type', event_type,
              unique_friend_count, NULL, unique_friend_count, 'available', ?, datetime('now')
         FROM analytics_projection_metric_stage
        WHERE line_account_id = ? AND cycle_id = ?
      `,
    ).bind(state.data_cutoff_at, state.line_account_id, state.cycle_id),
  ]);
  const projected = await db.prepare(
    `SELECT COALESCE(SUM(numerator), 0) count FROM analytics_daily_metrics
      WHERE line_account_id = ? AND metric_date >= ? AND metric_date <= ?
        AND metric_key = 'event_total'`,
  ).bind(state.line_account_id, state.range_from, state.range_to).first<{ count: number }>();
  const projectedCount = Number(projected?.count ?? 0);
  const mismatchCount = Math.abs(sourceEventCount - projectedCount);
  const status = mismatchCount === 0 ? 'matched' : 'mismatched';
  const completedAt = new Date().toISOString();
  await db.batch([
    db.prepare(
      `INSERT INTO analytics_reconciliation_runs (
         id, line_account_id, range_from, range_to, source_event_count,
         projected_count, mismatch_count, status, started_at, completed_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(line_account_id, range_to) DO UPDATE SET
         range_from=excluded.range_from, source_event_count=excluded.source_event_count,
         projected_count=excluded.projected_count, mismatch_count=excluded.mismatch_count,
         status=excluded.status, error_code=NULL, started_at=excluded.started_at,
         completed_at=excluded.completed_at`,
    ).bind(
      crypto.randomUUID(), state.line_account_id, state.range_from, state.range_to,
      sourceEventCount, projectedCount, mismatchCount, status,
      state.data_cutoff_at, completedAt,
    ),
    db.prepare(
      `UPDATE analytics_projection_progress
          SET phase = 'cleanup', updated_at = ?
        WHERE line_account_id = ? AND cycle_id = ?`,
    ).bind(completedAt, state.line_account_id, state.cycle_id),
  ]);
  return {
    accountId: state.line_account_id,
    fromDate: state.range_from,
    toDate: state.range_to,
    sourceEventCount,
    projectedCount,
    mismatchCount,
    status,
    completed: false,
    readRows: page.results.length,
    cursor: null,
  };
}

function monthsBefore(now: Date, months: number): string {
  const value = new Date(now);
  value.setUTCMonth(value.getUTCMonth() - months);
  return value.toISOString();
}

export async function purgeExpiredAnalyticsReadData(
  db: D1Database,
  now: Date,
): Promise<{
  events: number;
  dailyMetrics: number;
  reconciliationRuns: number;
  funnelRuns: number;
  crossRuns: number;
  savedSnapshots: number;
  audiences: number;
  urlExposures: number;
  urlExposureQueue: number;
}> {
  const eventCutoff = monthsBefore(now, 13);
  const dailyCutoff = monthsBefore(now, 25).slice(0, 10);
  const results = await db.batch([
    db.prepare(`DELETE FROM analytics_events WHERE occurred_at < ?`).bind(eventCutoff),
    db.prepare(`DELETE FROM analytics_daily_metrics WHERE metric_date < ?`).bind(dailyCutoff),
    db.prepare(`DELETE FROM analytics_reconciliation_runs WHERE completed_at < ?`).bind(eventCutoff),
    db.prepare(`DELETE FROM analytics_result_audiences WHERE expires_at <= ?`).bind(now.toISOString()),
    db.prepare(`DELETE FROM analytics_funnel_runs WHERE created_at < ?`).bind(eventCutoff),
    db.prepare(`DELETE FROM analytics_cross_runs WHERE created_at < ?`).bind(eventCutoff),
    db.prepare(`DELETE FROM analytics_saved_analysis_snapshots WHERE created_at < ?`).bind(eventCutoff),
    db.prepare(`DELETE FROM analytics_url_exposures WHERE sent_at < ?`).bind(eventCutoff),
    db.prepare(
      `DELETE FROM analytics_url_exposure_queue
        WHERE created_at < ? AND status IN ('processed','failed')`,
    ).bind(eventCutoff),
  ]);
  return {
    events: Number(results[0]?.meta?.changes ?? 0),
    dailyMetrics: Number(results[1]?.meta?.changes ?? 0),
    reconciliationRuns: Number(results[2]?.meta?.changes ?? 0),
    audiences: Number(results[3]?.meta?.changes ?? 0),
    funnelRuns: Number(results[4]?.meta?.changes ?? 0),
    crossRuns: Number(results[5]?.meta?.changes ?? 0),
    savedSnapshots: Number(results[6]?.meta?.changes ?? 0),
    urlExposures: Number(results[7]?.meta?.changes ?? 0),
    urlExposureQueue: Number(results[8]?.meta?.changes ?? 0),
  };
}
