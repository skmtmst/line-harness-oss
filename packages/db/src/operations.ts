export const OPERATION_CAPABILITIES = [
  'broadcast_dispatch',
  'scenario_dispatch',
  'reminder_dispatch',
  'automation_actions',
  'auto_reply_dispatch',
  'webhook_outgoing',
  'ad_postback',
] as const;

export type OperationCapability = typeof OPERATION_CAPABILITIES[number];
export type OperationState = 'running' | 'stopped';
export type OperationStates = Record<OperationCapability, OperationState>;

export interface OperationControlSet {
  scopeKey: string;
  lineAccountId: string | null;
  version: number;
  states: OperationStates;
  activeIncidentId: string | null;
  reason: string | null;
  actorId: string | null;
  stoppedAt: string | null;
  updatedAt: string | null;
}

export interface OperationIncident {
  id: string;
  scopeKey: string;
  lineAccountId: string | null;
  status: 'preparing' | 'stopped' | 'resolved' | 'failed';
  capabilities: OperationCapability[];
  reason: string;
  detail: string | null;
  actorId: string;
  resolvedByActorId: string | null;
  controlVersion: number | null;
  errorMessage: string | null;
  stoppedAt: string | null;
  resolvedAt: string | null;
  createdAt: string;
  updatedAt: string;
  definitionSnapshot: unknown | null;
  definitionSnapshotError: string | null;
  restoreDrift: unknown | null;
  targetCounts: {
    held: number;
    skippedDueToEmergency: number;
    inFlight: number;
    failed: number;
  };
}

function parseStoredJson(raw: string | null | undefined): unknown | null {
  if (!raw) return null;
  try { return JSON.parse(raw) as unknown; } catch { return null; }
}

export async function saveOperationDefinitionSnapshot(
  db: D1Database,
  input: { incidentId: string; snapshot: unknown | null; error?: string | null },
): Promise<void> {
  await db.prepare(
    `UPDATE operation_incidents
        SET definition_snapshot_json = ?, definition_snapshot_error = ?, updated_at = ?
      WHERE id = ? AND status = 'stopped'`,
  ).bind(
    input.snapshot === null ? null : JSON.stringify(input.snapshot),
    input.error?.slice(0, 500) ?? null,
    nowIso(),
    input.incidentId,
  ).run();
}

export async function saveOperationRestoreDrift(
  db: D1Database,
  input: { incidentId: string; drift: unknown },
): Promise<void> {
  await db.prepare(
    `UPDATE operation_incidents SET restore_drift_json = ?, updated_at = ? WHERE id = ?`,
  ).bind(JSON.stringify(input.drift), nowIso(), input.incidentId).run();
}

const ALL_ACCOUNTS_SCOPE = '*';

export function operationScopeKey(lineAccountId: string | null): string {
  return lineAccountId ?? ALL_ACCOUNTS_SCOPE;
}

export function defaultOperationStates(): OperationStates {
  return Object.fromEntries(OPERATION_CAPABILITIES.map((key) => [key, 'running'])) as OperationStates;
}

function parseStates(raw: string | null, activeIncidentId: string | null): OperationStates {
  const states = defaultOperationStates();
  if (!raw) return states;
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    for (const capability of OPERATION_CAPABILITIES) {
      if (parsed[capability] === 'stopped') states[capability] = 'stopped';
    }
  } catch {
    // 停止中の正本が壊れた場合、画面だけ「動作中」と表示すると運用者が
    // 誤って復旧判断する。送信ゲートと同じく全対象を安全側へ倒す。
    if (activeIncidentId) {
      for (const capability of OPERATION_CAPABILITIES) states[capability] = 'stopped';
    }
  }
  return states;
}

function isCapabilityStoppedFailClosed(
  raw: string | null,
  activeIncidentId: string | null,
  capability: OperationCapability,
): boolean {
  try {
    const parsed = raw ? JSON.parse(raw) as Record<string, unknown> : {};
    return parsed[capability] === 'stopped';
  } catch {
    // 停止中の正本が壊れた場合、送信を再開するより安全側へ倒す。
    return activeIncidentId !== null;
  }
}

type ControlRow = {
  scope_key: string;
  line_account_id: string | null;
  version: number;
  states_json: string;
  active_incident_id: string | null;
  reason: string | null;
  actor_id: string | null;
  stopped_at: string | null;
  updated_at: string;
};

function mapControl(row: ControlRow | null, lineAccountId: string | null): OperationControlSet {
  if (!row) {
    return {
      scopeKey: operationScopeKey(lineAccountId), lineAccountId, version: 0,
      states: defaultOperationStates(), activeIncidentId: null, reason: null,
      actorId: null, stoppedAt: null, updatedAt: null,
    };
  }
  return {
    scopeKey: row.scope_key,
    lineAccountId: row.line_account_id,
    version: row.version,
    states: parseStates(row.states_json, row.active_incident_id),
    activeIncidentId: row.active_incident_id,
    reason: row.reason,
    actorId: row.actor_id,
    stoppedAt: row.stopped_at,
    updatedAt: row.updated_at,
  };
}

export async function getOperationControlSet(
  db: D1Database,
  lineAccountId: string | null,
): Promise<OperationControlSet> {
  const row = await db.prepare(
    `SELECT scope_key, line_account_id, version, states_json, active_incident_id,
            reason, actor_id, stopped_at, updated_at
       FROM operation_control_sets WHERE scope_key = ?`,
  ).bind(operationScopeKey(lineAccountId)).first<ControlRow>();
  return mapControl(row ?? null, lineAccountId);
}

/** 全体停止とアカウント停止のどちらかが有効なら、送信を開始しない。 */
export async function getEffectiveOperationStates(
  db: D1Database,
  lineAccountId: string | null,
): Promise<OperationStates> {
  const scopeKeys = lineAccountId ? [ALL_ACCOUNTS_SCOPE, lineAccountId] : [ALL_ACCOUNTS_SCOPE];
  const placeholders = scopeKeys.map(() => '?').join(',');
  const rows = await db.prepare(
    `SELECT states_json, active_incident_id
       FROM operation_control_sets WHERE scope_key IN (${placeholders})`,
  ).bind(...scopeKeys).all<{ states_json: string; active_incident_id: string | null }>();
  const effective = defaultOperationStates();
  for (const row of rows.results ?? []) {
    for (const capability of OPERATION_CAPABILITIES) {
      if (isCapabilityStoppedFailClosed(row.states_json, row.active_incident_id, capability)) {
        effective[capability] = 'stopped';
      }
    }
  }
  return effective;
}

/** 全体停止とアカウント停止のどちらかが有効なら、送信を開始しない。 */
export async function isOperationCapabilityStopped(
  db: D1Database,
  lineAccountId: string | null,
  capability: OperationCapability,
  target?: {
    targetType: string;
    targetId: string;
    result: 'held' | 'skipped_due_to_emergency';
    reason?: string;
  },
): Promise<boolean> {
  const stopped = (await getEffectiveOperationStates(db, lineAccountId))[capability] === 'stopped';
  if (stopped && target) {
    await recordStoppedOperationTarget(db, { lineAccountId, capability, ...target });
  }
  return stopped;
}

/** 停止を発生させた全体・アカウント別incidentへ、同じ対象を1回だけ記録する。 */
export async function recordStoppedOperationTarget(
  db: D1Database,
  input: {
    lineAccountId: string | null;
    capability: OperationCapability;
    targetType: string;
    targetId: string;
    result: 'held' | 'skipped_due_to_emergency';
    reason?: string;
  },
): Promise<number> {
  const scopeKeys = input.lineAccountId ? [ALL_ACCOUNTS_SCOPE, input.lineAccountId] : [ALL_ACCOUNTS_SCOPE];
  const placeholders = scopeKeys.map(() => '?').join(',');
  const rows = await db.prepare(
    `SELECT states_json, active_incident_id
       FROM operation_control_sets
      WHERE scope_key IN (${placeholders}) AND active_incident_id IS NOT NULL`,
  ).bind(...scopeKeys).all<{ states_json: string; active_incident_id: string }>();
  let recorded = 0;
  const occurredAt = nowIso();
  for (const row of rows.results ?? []) {
    if (!isCapabilityStoppedFailClosed(row.states_json, row.active_incident_id, input.capability)) continue;
    const inserted = await db.prepare(
      `INSERT OR IGNORE INTO operation_target_results
         (id, incident_id, line_account_id, capability, target_type, target_id, result, reason, occurred_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).bind(
      crypto.randomUUID(), row.active_incident_id, input.lineAccountId, input.capability,
      input.targetType, input.targetId, input.result, input.reason ?? null, occurredAt,
    ).run();
    recorded += Number(inserted.meta.changes ?? 0);
  }
  return recorded;
}

/**
 * 外部送信を始めたあとで緊急停止が入った場合、その結果を停止履歴へ残す。
 *
 * 呼び出し開始時刻より後、完了時刻以前に停止された incident だけを対象にする。
 * 復旧が送信完了より先でも、resolved の履歴へ追記して事実を失わない。
 */
export async function recordOperationTargetOutcomeAcrossStop(
  db: D1Database,
  input: {
    lineAccountId: string | null;
    capability: OperationCapability;
    targetType: string;
    targetId: string;
    result: 'in_flight' | 'failed';
    startedAt: string;
    completedAt?: string;
    reason?: string;
  },
): Promise<number> {
  const completedAt = input.completedAt ?? nowIso();
  const scopeKeys = input.lineAccountId ? [ALL_ACCOUNTS_SCOPE, input.lineAccountId] : [ALL_ACCOUNTS_SCOPE];
  const placeholders = scopeKeys.map(() => '?').join(',');
  const rows = await db.prepare(
    `SELECT id, line_account_id, capabilities_json
       FROM operation_incidents
      WHERE scope_key IN (${placeholders})
        AND status IN ('stopped', 'resolved')
        AND stopped_at IS NOT NULL
        AND stopped_at > ?
        AND stopped_at <= ?
      ORDER BY stopped_at DESC`,
  ).bind(...scopeKeys, input.startedAt, completedAt).all<{
    id: string;
    line_account_id: string | null;
    capabilities_json: string;
  }>();

  let recorded = 0;
  for (const row of rows.results ?? []) {
    let capabilities: unknown = null;
    try { capabilities = JSON.parse(row.capabilities_json); } catch { capabilities = null; }
    if (!Array.isArray(capabilities) || !capabilities.includes(input.capability)) continue;
    const inserted = await db.prepare(
      `INSERT OR IGNORE INTO operation_target_results
         (id, incident_id, line_account_id, capability, target_type, target_id, result, reason, occurred_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).bind(
      crypto.randomUUID(), row.id, input.lineAccountId, input.capability,
      input.targetType, input.targetId, input.result, input.reason ?? null, completedAt,
    ).run();
    recorded += Number(inserted.meta.changes ?? 0);
  }
  return recorded;
}

export interface OperationTargetResult {
  id: string;
  incidentId: string;
  lineAccountId: string | null;
  capability: OperationCapability;
  targetType: string;
  targetId: string;
  result: 'held' | 'skipped_due_to_emergency' | 'in_flight' | 'failed';
  reason: string | null;
  occurredAt: string;
}

export async function listOperationTargetResults(
  db: D1Database,
  incidentId: string,
  limit = 200,
): Promise<OperationTargetResult[]> {
  const rows = await db.prepare(
    `SELECT id, incident_id, line_account_id, capability, target_type, target_id, result, reason, occurred_at
       FROM operation_target_results WHERE incident_id = ? ORDER BY occurred_at DESC LIMIT ?`,
  ).bind(incidentId, Math.max(1, Math.min(500, Math.floor(limit)))).all<{
    id: string; incident_id: string; line_account_id: string | null; capability: OperationCapability;
    target_type: string; target_id: string; result: OperationTargetResult['result']; reason: string | null; occurred_at: string;
  }>();
  return rows.results.map((row) => ({
    id: row.id, incidentId: row.incident_id, lineAccountId: row.line_account_id,
    capability: row.capability, targetType: row.target_type, targetId: row.target_id,
    result: row.result, reason: row.reason, occurredAt: row.occurred_at,
  }));
}

function nowIso(): string {
  return new Date().toISOString();
}

async function markIncidentFailed(db: D1Database, id: string, message: string): Promise<void> {
  await db.prepare(
    `UPDATE operation_incidents
        SET status = 'failed', error_message = ?, updated_at = ?
      WHERE id = ?`,
  ).bind(message, nowIso(), id).run();
}

export type ChangeOperationControlResult =
  | { status: 'changed'; control: OperationControlSet; incident: OperationIncident }
  | { status: 'conflict'; control: OperationControlSet };

export async function stopOperationCapabilities(
  db: D1Database,
  input: {
    lineAccountId: string | null;
    capabilities: OperationCapability[];
    expectedVersion: number;
    actorId: string;
    reason: string;
    detail?: string | null;
  },
): Promise<ChangeOperationControlResult> {
  const scopeKey = operationScopeKey(input.lineAccountId);
  const incidentId = crypto.randomUUID();
  const now = nowIso();
  await db.prepare(
    `INSERT INTO operation_incidents
       (id, scope_key, line_account_id, status, capabilities_json, reason, detail,
        actor_id, created_at, updated_at)
     VALUES (?, ?, ?, 'preparing', ?, ?, ?, ?, ?, ?)`,
  ).bind(
    incidentId, scopeKey, input.lineAccountId, JSON.stringify(input.capabilities),
    input.reason, input.detail ?? null, input.actorId, now, now,
  ).run();

  const current = await getOperationControlSet(db, input.lineAccountId);
  if (current.version !== input.expectedVersion || current.activeIncidentId) {
    await markIncidentFailed(db, incidentId, '別の管理者による停止・復旧が先に反映されました');
    return { status: 'conflict', control: current };
  }
  const states = { ...current.states };
  for (const capability of input.capabilities) states[capability] = 'stopped';
  const nextVersion = current.version + 1;
  let changed = 0;
  if (current.version === 0) {
    const result = await db.prepare(
      `INSERT OR IGNORE INTO operation_control_sets
         (scope_key, line_account_id, version, states_json, active_incident_id,
          reason, actor_id, stopped_at, updated_at)
       VALUES (?, ?, 1, ?, ?, ?, ?, ?, ?)`,
    ).bind(
      scopeKey, input.lineAccountId, JSON.stringify(states), incidentId,
      input.reason, input.actorId, now, now,
    ).run();
    changed = result.meta?.changes ?? 0;
  } else {
    const result = await db.prepare(
      `UPDATE operation_control_sets
          SET version = ?, states_json = ?, active_incident_id = ?, reason = ?,
              actor_id = ?, stopped_at = ?, updated_at = ?
        WHERE scope_key = ? AND version = ? AND active_incident_id IS NULL`,
    ).bind(
      nextVersion, JSON.stringify(states), incidentId, input.reason,
      input.actorId, now, now, scopeKey, input.expectedVersion,
    ).run();
    changed = result.meta?.changes ?? 0;
  }
  if (changed !== 1) {
    await markIncidentFailed(db, incidentId, '別の管理者による停止・復旧が先に反映されました');
    return { status: 'conflict', control: await getOperationControlSet(db, input.lineAccountId) };
  }

  await db.prepare(
    `UPDATE operation_incidents
        SET status = 'stopped', control_version = ?, stopped_at = ?, updated_at = ?
      WHERE id = ?`,
  ).bind(nextVersion, now, now, incidentId).run();
  return {
    status: 'changed',
    control: await getOperationControlSet(db, input.lineAccountId),
    incident: (await getOperationIncident(db, incidentId))!,
  };
}

export async function restoreOperationIncident(
  db: D1Database,
  input: { incidentId: string; expectedVersion: number; actorId: string },
): Promise<ChangeOperationControlResult | { status: 'not_found' }> {
  const incident = await getOperationIncident(db, input.incidentId);
  if (!incident || incident.status !== 'stopped') return { status: 'not_found' };
  const current = await getOperationControlSet(db, incident.lineAccountId);
  if (current.version !== input.expectedVersion || current.activeIncidentId !== incident.id) {
    return { status: 'conflict', control: current };
  }
  const states = { ...current.states };
  for (const capability of incident.capabilities) states[capability] = 'running';
  const now = nowIso();
  const nextVersion = current.version + 1;
  const result = await db.prepare(
    `UPDATE operation_control_sets
        SET version = ?, states_json = ?, active_incident_id = NULL, reason = NULL,
            actor_id = ?, stopped_at = NULL, updated_at = ?
      WHERE scope_key = ? AND version = ? AND active_incident_id = ?`,
  ).bind(
    nextVersion, JSON.stringify(states), input.actorId, now,
    current.scopeKey, input.expectedVersion, incident.id,
  ).run();
  if ((result.meta?.changes ?? 0) !== 1) {
    return { status: 'conflict', control: await getOperationControlSet(db, incident.lineAccountId) };
  }
  await db.prepare(
    `UPDATE operation_incidents
        SET status = 'resolved', control_version = ?, resolved_by_actor_id = ?,
            resolved_at = ?, updated_at = ?
      WHERE id = ? AND status = 'stopped'`,
  ).bind(nextVersion, input.actorId, now, now, incident.id).run();
  return {
    status: 'changed',
    control: await getOperationControlSet(db, incident.lineAccountId),
    incident: (await getOperationIncident(db, incident.id))!,
  };
}

type IncidentRow = {
  id: string; scope_key: string; line_account_id: string | null;
  status: OperationIncident['status']; capabilities_json: string; reason: string;
  detail: string | null; actor_id: string; control_version: number | null;
  resolved_by_actor_id: string | null;
  error_message: string | null; stopped_at: string | null; resolved_at: string | null;
  created_at: string; updated_at: string;
  definition_snapshot_json: string | null; definition_snapshot_error: string | null;
  restore_drift_json: string | null;
  held_count?: number | null; skipped_count?: number | null;
  in_flight_count?: number | null; failed_count?: number | null;
};

function mapIncident(row: IncidentRow): OperationIncident {
  let capabilities: OperationCapability[] = [];
  try {
    const raw = JSON.parse(row.capabilities_json) as unknown;
    if (Array.isArray(raw)) capabilities = raw.filter((value): value is OperationCapability =>
      typeof value === 'string' && OPERATION_CAPABILITIES.includes(value as OperationCapability));
  } catch { capabilities = []; }
  return {
    id: row.id, scopeKey: row.scope_key, lineAccountId: row.line_account_id,
    status: row.status, capabilities, reason: row.reason, detail: row.detail,
    actorId: row.actor_id, resolvedByActorId: row.resolved_by_actor_id,
    controlVersion: row.control_version,
    errorMessage: row.error_message, stoppedAt: row.stopped_at,
    resolvedAt: row.resolved_at, createdAt: row.created_at, updatedAt: row.updated_at,
    definitionSnapshot: parseStoredJson(row.definition_snapshot_json),
    definitionSnapshotError: row.definition_snapshot_error,
    restoreDrift: parseStoredJson(row.restore_drift_json),
    targetCounts: {
      held: Number(row.held_count ?? 0),
      skippedDueToEmergency: Number(row.skipped_count ?? 0),
      inFlight: Number(row.in_flight_count ?? 0),
      failed: Number(row.failed_count ?? 0),
    },
  };
}

export async function getOperationIncident(db: D1Database, id: string): Promise<OperationIncident | null> {
  const row = await db.prepare(`SELECT oi.*,
      SUM(CASE WHEN otr.result = 'held' THEN 1 ELSE 0 END) AS held_count,
      SUM(CASE WHEN otr.result = 'skipped_due_to_emergency' THEN 1 ELSE 0 END) AS skipped_count,
      SUM(CASE WHEN otr.result = 'in_flight' THEN 1 ELSE 0 END) AS in_flight_count,
      SUM(CASE WHEN otr.result = 'failed' THEN 1 ELSE 0 END) AS failed_count
    FROM operation_incidents oi
    LEFT JOIN operation_target_results otr ON otr.incident_id = oi.id
    WHERE oi.id = ?
    GROUP BY oi.id`)
    .bind(id).first<IncidentRow>();
  return row ? mapIncident(row) : null;
}

export async function listOperationIncidents(
  db: D1Database,
  options: { accountIds: string[]; includeGlobal: boolean; limit?: number },
): Promise<OperationIncident[]> {
  const clauses: string[] = [];
  const binds: unknown[] = [];
  if (options.includeGlobal) clauses.push("oi.scope_key = '*'");
  if (options.accountIds.length > 0) {
    clauses.push(`oi.line_account_id IN (${options.accountIds.map(() => '?').join(',')})`);
    binds.push(...options.accountIds);
  }
  if (clauses.length === 0) return [];
  const limit = Math.max(1, Math.min(options.limit ?? 100, 500));
  const rows = await db.prepare(
    `SELECT oi.*,
      SUM(CASE WHEN otr.result = 'held' THEN 1 ELSE 0 END) AS held_count,
      SUM(CASE WHEN otr.result = 'skipped_due_to_emergency' THEN 1 ELSE 0 END) AS skipped_count,
      SUM(CASE WHEN otr.result = 'in_flight' THEN 1 ELSE 0 END) AS in_flight_count,
      SUM(CASE WHEN otr.result = 'failed' THEN 1 ELSE 0 END) AS failed_count
      FROM operation_incidents oi
      LEFT JOIN operation_target_results otr ON otr.incident_id = oi.id
      WHERE ${clauses.map((clause) => `(${clause})`).join(' OR ')}
      GROUP BY oi.id
      ORDER BY oi.created_at DESC LIMIT ?`,
  ).bind(...binds, limit).all<IncidentRow>();
  return (rows.results ?? []).map(mapIncident);
}
