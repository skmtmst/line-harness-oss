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
