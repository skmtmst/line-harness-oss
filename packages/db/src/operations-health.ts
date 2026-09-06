export const OPERATION_HEALTH_CHECK_KEYS = [
  'line_connection',
  'message_quota',
  'external_integrations',
  'webhook',
  'dispatch_jobs',
  'friend_change',
] as const;

export type OperationHealthCheckKey = (typeof OPERATION_HEALTH_CHECK_KEYS)[number];
export type OperationHealthStatus = 'normal' | 'warning' | 'danger' | 'unknown';

export type OperationHealthResultInput = {
  checkKey: OperationHealthCheckKey;
  status: OperationHealthStatus;
  summary: string;
  value?: Record<string, unknown> | null;
  threshold?: Record<string, unknown> | null;
  source: string;
  observedAt: string;
};

export type OperationHealthResult = OperationHealthResultInput & { id: string; runId: string };

export type OperationHealthRun = {
  id: string;
  scopeKey: string;
  lineAccountId: string | null;
  windowStartedAt: string;
  source: 'scheduled' | 'manual';
  status: 'running' | 'completed' | 'failed';
  overallStatus: OperationHealthStatus;
  actorId: string | null;
  startedAt: string;
  completedAt: string | null;
  errorMessage: string | null;
  results: OperationHealthResult[];
};

type HealthRunRow = {
  id: string;
  scope_key: string;
  line_account_id: string | null;
  window_started_at: string;
  source: 'scheduled' | 'manual';
  status: 'running' | 'completed' | 'failed';
  overall_status: OperationHealthStatus;
  actor_id: string | null;
  started_at: string;
  completed_at: string | null;
  error_message: string | null;
};

type HealthResultRow = {
  id: string;
  run_id: string;
  check_key: OperationHealthCheckKey;
  status: OperationHealthStatus;
  summary: string;
  value_json: string | null;
  threshold_json: string | null;
  source: string;
  observed_at: string;
};

function parseObject(raw: string | null): Record<string, unknown> | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as unknown;
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : null;
  } catch {
    return null;
  }
}

function mapHealthResult(row: HealthResultRow): OperationHealthResult {
  return {
    id: row.id,
    runId: row.run_id,
    checkKey: row.check_key,
    status: row.status,
    summary: row.summary,
    value: parseObject(row.value_json),
    threshold: parseObject(row.threshold_json),
    source: row.source,
    observedAt: row.observed_at,
  };
}

async function mapHealthRun(db: D1Database, row: HealthRunRow): Promise<OperationHealthRun> {
  const resultRows = await db.prepare(
    'SELECT * FROM operation_health_results WHERE run_id = ? ORDER BY check_key',
  ).bind(row.id).all<HealthResultRow>();
  return {
    id: row.id,
    scopeKey: row.scope_key,
    lineAccountId: row.line_account_id,
    windowStartedAt: row.window_started_at,
    source: row.source,
    status: row.status,
    overallStatus: row.overall_status,
    actorId: row.actor_id,
    startedAt: row.started_at,
    completedAt: row.completed_at,
    errorMessage: row.error_message,
    results: (resultRows.results ?? []).map(mapHealthResult),
  };
}

export function operationHealthWindow(now = new Date()): string {
  const windowMs = Math.floor(now.getTime() / 300_000) * 300_000;
  return new Date(windowMs).toISOString();
}

export async function startOperationHealthRun(
  db: D1Database,
  input: { lineAccountId: string; source: 'scheduled' | 'manual'; actorId?: string | null; now?: string },
): Promise<{ created: boolean; run: OperationHealthRun }> {
  const now = input.now ?? new Date().toISOString();
  const windowStartedAt = operationHealthWindow(new Date(now));
  const id = crypto.randomUUID();
  const inserted = await db.prepare(
    `INSERT OR IGNORE INTO operation_health_runs
       (id, scope_key, line_account_id, window_started_at, source, status,
        overall_status, actor_id, started_at)
     VALUES (?, ?, ?, ?, ?, 'running', 'unknown', ?, ?)`,
  ).bind(id, input.lineAccountId, input.lineAccountId, windowStartedAt,
    input.source, input.actorId ?? null, now).run();
  const row = Number(inserted.meta?.changes ?? 0) === 1
    ? await db.prepare('SELECT * FROM operation_health_runs WHERE id = ?').bind(id).first<HealthRunRow>()
    : await db.prepare(
      'SELECT * FROM operation_health_runs WHERE scope_key = ? AND window_started_at = ?',
    ).bind(input.lineAccountId, windowStartedAt).first<HealthRunRow>();
  if (!row) throw new Error('operation_health_run_missing');
  return { created: Number(inserted.meta?.changes ?? 0) === 1, run: await mapHealthRun(db, row) };
}

function overallHealthStatus(results: OperationHealthResultInput[]): OperationHealthStatus {
  for (const status of ['danger', 'warning', 'unknown'] as const) {
    if (results.some((result) => result.status === status)) return status;
  }
  return 'normal';
}

export async function completeOperationHealthRun(
  db: D1Database,
  runId: string,
  results: OperationHealthResultInput[],
  completedAt = new Date().toISOString(),
): Promise<OperationHealthRun> {
  const statements = results.map((result) => db.prepare(
    `INSERT OR REPLACE INTO operation_health_results
       (id, run_id, check_key, status, summary, value_json, threshold_json, source, observed_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).bind(
    crypto.randomUUID(), runId, result.checkKey, result.status, result.summary,
    result.value ? JSON.stringify(result.value) : null,
    result.threshold ? JSON.stringify(result.threshold) : null,
    result.source, result.observedAt,
  ));
  statements.push(db.prepare(
    `UPDATE operation_health_runs
        SET status = 'completed', overall_status = ?, completed_at = ?, error_message = NULL
      WHERE id = ?`,
  ).bind(overallHealthStatus(results), completedAt, runId));
  await db.batch(statements);
  const row = await db.prepare('SELECT * FROM operation_health_runs WHERE id = ?')
    .bind(runId).first<HealthRunRow>();
  if (!row) throw new Error('operation_health_run_missing');
  return mapHealthRun(db, row);
}

export async function failOperationHealthRun(
  db: D1Database,
  runId: string,
  errorMessage: string,
  completedAt = new Date().toISOString(),
): Promise<void> {
  await db.prepare(
    `UPDATE operation_health_runs
        SET status = 'failed', overall_status = 'unknown', error_message = ?, completed_at = ?
      WHERE id = ?`,
  ).bind(errorMessage.slice(0, 500), completedAt, runId).run();
}

export async function getLatestOperationHealthRun(
  db: D1Database,
  lineAccountId: string,
): Promise<OperationHealthRun | null> {
  const row = await db.prepare(
    `SELECT * FROM operation_health_runs
      WHERE scope_key = ? ORDER BY started_at DESC, id DESC LIMIT 1`,
  ).bind(lineAccountId).first<HealthRunRow>();
  return row ? mapHealthRun(db, row) : null;
}

export async function createStepUpGrant(
  db: D1Database,
  input: { tokenHash: string; staffId: string; purpose: string; expiresAt: string; now?: string },
): Promise<void> {
  await db.prepare(
    `INSERT INTO auth_step_up_grants
       (token_hash, staff_id, purpose, expires_at, created_at) VALUES (?, ?, ?, ?, ?)`,
  ).bind(input.tokenHash, input.staffId, input.purpose, input.expiresAt,
    input.now ?? new Date().toISOString()).run();
}

export async function consumeStepUpGrant(
  db: D1Database,
  input: { tokenHash: string; staffId: string; purpose: string; now?: string },
): Promise<boolean> {
  const now = input.now ?? new Date().toISOString();
  const result = await db.prepare(
    `UPDATE auth_step_up_grants SET consumed_at = ?
      WHERE token_hash = ? AND staff_id = ? AND purpose = ?
        AND consumed_at IS NULL AND expires_at > ?`,
  ).bind(now, input.tokenHash, input.staffId, input.purpose, now).run();
  return Number(result.meta?.changes ?? 0) === 1;
}

export type OperationRequestReceipt = {
  action: string;
  actorId: string;
  idempotencyKey: string;
  requestHash: string;
  resourceId: string;
  createdAt: string;
};

type ReceiptRow = {
  action: string; actor_id: string; idempotency_key: string;
  request_hash: string; resource_id: string; created_at: string;
};

function mapReceipt(row: ReceiptRow): OperationRequestReceipt {
  return {
    action: row.action, actorId: row.actor_id, idempotencyKey: row.idempotency_key,
    requestHash: row.request_hash, resourceId: row.resource_id, createdAt: row.created_at,
  };
}

export async function getOperationRequestReceipt(
  db: D1Database,
  action: string,
  actorId: string,
  idempotencyKey: string,
): Promise<OperationRequestReceipt | null> {
  const row = await db.prepare(
    `SELECT * FROM operation_request_receipts
      WHERE action = ? AND actor_id = ? AND idempotency_key = ?`,
  ).bind(action, actorId, idempotencyKey).first<ReceiptRow>();
  return row ? mapReceipt(row) : null;
}

export async function saveOperationRequestReceipt(
  db: D1Database,
  input: Omit<OperationRequestReceipt, 'createdAt'> & { createdAt?: string },
): Promise<boolean> {
  const result = await db.prepare(
    `INSERT OR IGNORE INTO operation_request_receipts
       (action, actor_id, idempotency_key, request_hash, resource_id, created_at)
     VALUES (?, ?, ?, ?, ?, ?)`,
  ).bind(input.action, input.actorId, input.idempotencyKey, input.requestHash,
    input.resourceId, input.createdAt ?? new Date().toISOString()).run();
  return Number(result.meta?.changes ?? 0) === 1;
}

export type OperationDeploymentEventInput = {
  deploymentId: string;
  phase: 'queued' | 'deploying' | 'verifying' | 'succeeded' | 'failed' | 'rolled_back';
  environment: string;
  fromCommit?: string | null;
  toCommit?: string | null;
  version?: string | null;
  migrations?: string[];
  rollbackAvailable?: boolean;
  downtimeSeconds?: number | null;
  pullRequest?: number | null;
  releaseSummary?: string | null;
  actor: string;
  smokeCheck?: Record<string, unknown> | null;
  occurredAt: string;
};

export type OperationDeploymentEvent = OperationDeploymentEventInput & { id: string; receivedAt: string };

type DeploymentRow = {
  id: string; deployment_id: string; phase: OperationDeploymentEventInput['phase']; environment: string;
  from_commit: string | null; to_commit: string | null; version: string | null; migration_json: string;
  rollback_available: number; downtime_seconds: number | null; pull_request: number | null;
  release_summary: string | null; actor: string; smoke_check_json: string | null;
  occurred_at: string; received_at: string;
};

function mapDeployment(row: DeploymentRow): OperationDeploymentEvent {
  return {
    id: row.id, deploymentId: row.deployment_id, phase: row.phase, environment: row.environment,
    fromCommit: row.from_commit, toCommit: row.to_commit, version: row.version,
    migrations: JSON.parse(row.migration_json) as string[], rollbackAvailable: row.rollback_available === 1,
    downtimeSeconds: row.downtime_seconds, pullRequest: row.pull_request,
    releaseSummary: row.release_summary, actor: row.actor,
    smokeCheck: parseObject(row.smoke_check_json), occurredAt: row.occurred_at, receivedAt: row.received_at,
  };
}

export async function recordOperationDeploymentEvent(
  db: D1Database,
  input: OperationDeploymentEventInput,
): Promise<{ created: boolean; event: OperationDeploymentEvent }> {
  const id = crypto.randomUUID();
  const receivedAt = new Date().toISOString();
  const result = await db.prepare(
    `INSERT OR IGNORE INTO operation_deployment_events
       (id, deployment_id, phase, environment, from_commit, to_commit, version,
        migration_json, rollback_available, downtime_seconds, pull_request,
        release_summary, actor, smoke_check_json, occurred_at, received_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).bind(
    id, input.deploymentId, input.phase, input.environment, input.fromCommit ?? null,
    input.toCommit ?? null, input.version ?? null, JSON.stringify(input.migrations ?? []),
    input.rollbackAvailable ? 1 : 0, input.downtimeSeconds ?? null, input.pullRequest ?? null,
    input.releaseSummary ?? null, input.actor, input.smokeCheck ? JSON.stringify(input.smokeCheck) : null,
    input.occurredAt, receivedAt,
  ).run();
  const row = await db.prepare(
    'SELECT * FROM operation_deployment_events WHERE deployment_id = ? AND phase = ?',
  ).bind(input.deploymentId, input.phase).first<DeploymentRow>();
  if (!row) throw new Error('operation_deployment_event_missing');
  return { created: Number(result.meta?.changes ?? 0) === 1, event: mapDeployment(row) };
}

export async function listOperationDeploymentEvents(
  db: D1Database,
  limit = 100,
): Promise<OperationDeploymentEvent[]> {
  const rows = await db.prepare(
    `SELECT * FROM operation_deployment_events
      ORDER BY occurred_at DESC, id DESC LIMIT ?`,
  ).bind(Math.max(1, Math.min(Math.floor(limit), 200))).all<DeploymentRow>();
  return (rows.results ?? []).map(mapDeployment);
}

export async function enqueueOperationNotifications(
  db: D1Database,
  input: { incidentId: string; eventKind: 'stopped' | 'restored'; payload: Record<string, unknown>; now?: string },
): Promise<Array<{ channel: 'line' | 'email'; status: 'queued' }>> {
  const now = input.now ?? new Date().toISOString();
  await db.batch((['line', 'email'] as const).map((channel) => db.prepare(
    `INSERT OR IGNORE INTO operation_notification_outbox
       (id, incident_id, event_kind, channel, status, payload_json,
        next_attempt_at, created_at, updated_at)
     VALUES (?, ?, ?, ?, 'queued', ?, ?, ?, ?)`,
  ).bind(crypto.randomUUID(), input.incidentId, input.eventKind, channel,
    JSON.stringify(input.payload), now, now, now)));
  return [{ channel: 'line', status: 'queued' }, { channel: 'email', status: 'queued' }];
}
