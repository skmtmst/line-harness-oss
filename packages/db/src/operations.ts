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
): Promise<boolean> {
  return (await getEffectiveOperationStates(db, lineAccountId))[capability] === 'stopped';
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
  };
}

export async function getOperationIncident(db: D1Database, id: string): Promise<OperationIncident | null> {
  const row = await db.prepare('SELECT * FROM operation_incidents WHERE id = ?')
    .bind(id).first<IncidentRow>();
  return row ? mapIncident(row) : null;
}

export async function listOperationIncidents(
  db: D1Database,
  options: { accountIds: string[]; includeGlobal: boolean; limit?: number },
): Promise<OperationIncident[]> {
  const clauses: string[] = [];
  const binds: unknown[] = [];
  if (options.includeGlobal) clauses.push("scope_key = '*'");
  if (options.accountIds.length > 0) {
    clauses.push(`line_account_id IN (${options.accountIds.map(() => '?').join(',')})`);
    binds.push(...options.accountIds);
  }
  if (clauses.length === 0) return [];
  const limit = Math.max(1, Math.min(options.limit ?? 100, 500));
  const rows = await db.prepare(
    `SELECT * FROM operation_incidents
      WHERE ${clauses.map((clause) => `(${clause})`).join(' OR ')}
      ORDER BY created_at DESC LIMIT ?`,
  ).bind(...binds, limit).all<IncidentRow>();
  return (rows.results ?? []).map(mapIncident);
}
