export type OperationHealthCheckKey = 'quota' | 'api' | 'webhook' | 'delivery' | 'friends';
export type OperationHealthSeverity = 'normal' | 'warning' | 'danger' | 'unknown';

export interface OperationHealthResult {
  checkKey: OperationHealthCheckKey;
  severity: OperationHealthSeverity;
  detail: string;
  metrics: Record<string, unknown>;
  checkedAt: string;
}

export interface OperationHealthSnapshot {
  runId: string;
  status: 'completed' | 'failed';
  checkedAt: string;
  results: OperationHealthResult[];
}

export interface OperationHealthAlert {
  id: string;
  checkKey: OperationHealthCheckKey;
  status: 'open' | 'acknowledged' | 'resolved';
  severity: 'warning' | 'danger';
  detail: string;
  firstDetectedAt: string;
  lastDetectedAt: string;
  acknowledgedBy: string | null;
  acknowledgedAt: string | null;
  resolvedAt: string | null;
  updatedAt: string;
}

interface HealthAlertRow {
  id: string;
  check_key: OperationHealthCheckKey;
  status: OperationHealthAlert['status'];
  severity: OperationHealthAlert['severity'];
  detail: string;
  first_detected_at: string;
  last_detected_at: string;
  acknowledged_by: string | null;
  acknowledged_at: string | null;
  resolved_at: string | null;
  updated_at: string;
}

interface HealthResultRow {
  check_key: OperationHealthCheckKey;
  severity: OperationHealthSeverity;
  detail: string;
  metrics_json: string;
  checked_at: string;
}

function readMetrics(value: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(value) as unknown;
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : {};
  } catch {
    return {};
  }
}

function mapAlert(row: HealthAlertRow): OperationHealthAlert {
  return {
    id: row.id,
    checkKey: row.check_key,
    status: row.status,
    severity: row.severity,
    detail: row.detail,
    firstDetectedAt: row.first_detected_at,
    lastDetectedAt: row.last_detected_at,
    acknowledgedBy: row.acknowledged_by,
    acknowledgedAt: row.acknowledged_at,
    resolvedAt: row.resolved_at,
    updatedAt: row.updated_at,
  };
}

export async function claimOperationHealthRun(
  db: D1Database,
  input: { bucketKey: string; startedAt: string },
): Promise<string | null> {
  const id = crypto.randomUUID();
  const result = await db.prepare(
    `INSERT OR IGNORE INTO operation_health_runs
       (id, bucket_key, status, started_at)
     VALUES (?, ?, 'running', ?)`,
  ).bind(id, input.bucketKey, input.startedAt).run();
  return Number(result.meta.changes ?? 0) === 1 ? id : null;
}

export async function completeOperationHealthRun(
  db: D1Database,
  input: { runId: string; completedAt: string; results: OperationHealthResult[] },
): Promise<void> {
  for (const result of input.results) {
    await db.prepare(
      `INSERT INTO operation_health_results
         (run_id, check_key, severity, detail, metrics_json, checked_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
    ).bind(
      input.runId,
      result.checkKey,
      result.severity,
      result.detail,
      JSON.stringify(result.metrics),
      result.checkedAt,
    ).run();
  }
  await db.prepare(
    `UPDATE operation_health_runs
        SET status = 'completed', completed_at = ?, error_message = NULL
      WHERE id = ? AND status = 'running'`,
  ).bind(input.completedAt, input.runId).run();
}

export async function failOperationHealthRun(
  db: D1Database,
  input: { runId: string; completedAt: string; errorMessage: string },
): Promise<void> {
  await db.prepare(
    `UPDATE operation_health_runs
        SET status = 'failed', completed_at = ?, error_message = ?
      WHERE id = ? AND status = 'running'`,
  ).bind(input.completedAt, input.errorMessage.slice(0, 500), input.runId).run();
}

export async function getLatestOperationHealthSnapshot(
  db: D1Database,
): Promise<OperationHealthSnapshot | null> {
  const run = await db.prepare(
    `SELECT id, status, completed_at
       FROM operation_health_runs
      WHERE status IN ('completed', 'failed')
      ORDER BY completed_at DESC
      LIMIT 1`,
  ).first<{ id: string; status: 'completed' | 'failed'; completed_at: string }>();
  if (!run) return null;
  const rows = await db.prepare(
    `SELECT check_key, severity, detail, metrics_json, checked_at
       FROM operation_health_results
      WHERE run_id = ?
      ORDER BY CASE check_key
        WHEN 'quota' THEN 1 WHEN 'api' THEN 2 WHEN 'webhook' THEN 3
        WHEN 'delivery' THEN 4 ELSE 5 END`,
  ).bind(run.id).all<HealthResultRow>();
  return {
    runId: run.id,
    status: run.status,
    checkedAt: run.completed_at,
    results: rows.results.map((row) => ({
      checkKey: row.check_key,
      severity: row.severity,
      detail: row.detail,
      metrics: readMetrics(row.metrics_json),
      checkedAt: row.checked_at,
    })),
  };
}

export async function reconcileOperationHealthAlerts(
  db: D1Database,
  results: OperationHealthResult[],
  now: string,
): Promise<void> {
  for (const health of results) {
    if (health.severity === 'warning' || health.severity === 'danger') {
      const active = await db.prepare(
        `SELECT id FROM operation_health_alerts
          WHERE check_key = ? AND status IN ('open', 'acknowledged') LIMIT 1`,
      ).bind(health.checkKey).first<{ id: string }>();
      if (active) {
        await db.prepare(
          `UPDATE operation_health_alerts
              SET severity = ?, detail = ?, last_detected_at = ?, updated_at = ?
            WHERE id = ?`,
        ).bind(health.severity, health.detail, now, now, active.id).run();
      } else {
        await db.prepare(
          `INSERT INTO operation_health_alerts
             (id, check_key, status, severity, detail, first_detected_at, last_detected_at, updated_at)
           VALUES (?, ?, 'open', ?, ?, ?, ?, ?)`,
        ).bind(crypto.randomUUID(), health.checkKey, health.severity, health.detail, now, now, now).run();
      }
    } else if (health.severity === 'normal') {
      await db.prepare(
        `UPDATE operation_health_alerts
            SET status = 'resolved', resolved_at = ?, updated_at = ?
          WHERE check_key = ? AND status IN ('open', 'acknowledged')`,
      ).bind(now, now, health.checkKey).run();
    }
    // unknownは「正常に戻った」証拠ではないため、既存アラートを解決しない。
  }
}

export async function listOperationHealthAlerts(
  db: D1Database,
  options: { includeResolved?: boolean; limit?: number } = {},
): Promise<OperationHealthAlert[]> {
  const limit = Math.max(1, Math.min(200, Math.floor(options.limit ?? 100)));
  const where = options.includeResolved ? '' : `WHERE status IN ('open', 'acknowledged')`;
  const rows = await db.prepare(
    `SELECT * FROM operation_health_alerts ${where} ORDER BY updated_at DESC LIMIT ?`,
  ).bind(limit).all<HealthAlertRow>();
  return rows.results.map(mapAlert);
}

export async function acknowledgeOperationHealthAlert(
  db: D1Database,
  input: { alertId: string; actorId: string; now: string },
): Promise<OperationHealthAlert | null> {
  await db.prepare(
    `UPDATE operation_health_alerts
        SET status = 'acknowledged', acknowledged_by = ?, acknowledged_at = ?, updated_at = ?
      WHERE id = ? AND status = 'open'`,
  ).bind(input.actorId, input.now, input.now, input.alertId).run();
  const row = await db.prepare(`SELECT * FROM operation_health_alerts WHERE id = ?`)
    .bind(input.alertId).first<HealthAlertRow>();
  return row ? mapAlert(row) : null;
}
