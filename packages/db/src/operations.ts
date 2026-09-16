import {
  captureStoppedDefinitions,
  holdExpiredBroadcasts,
  inspectIncidentRestoreDrift,
  type OperationRestoreDrift,
} from './operation-restore-guard.js';

export const OPERATION_CAPABILITIES = [
  'broadcast_dispatch',
  'scenario_dispatch',
  'reminder_dispatch',
  'automation_actions',
  'auto_reply_dispatch',
  'webhook_outgoing',
  'ad_postback',
] as const;

export type OperationCapability = (typeof OPERATION_CAPABILITIES)[number];
export type OperationState = 'running' | 'stopped';
export type OperationStates = Record<OperationCapability, OperationState>;
export type OperationIncidentStatus = 'preparing' | 'stopped' | 'resolved' | 'failed';

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

export interface OperationControlSnapshot {
  version: number;
  states: OperationStates;
  activeIncidentId: string | null;
  reason: string | null;
  actorId: string | null;
  stoppedAt: string | null;
  capturedAt: string;
}

export interface OperationIncident {
  id: string;
  scopeKey: string;
  lineAccountId: string | null;
  status: OperationIncidentStatus;
  capabilities: OperationCapability[];
  reason: string;
  detail: string | null;
  actorId: string;
  resolvedByActorId: string | null;
  controlVersion: number | null;
  beforeSnapshot: OperationControlSnapshot;
  stoppedSnapshot: OperationControlSnapshot | null;
  restoredSnapshot: OperationControlSnapshot | null;
  errorMessage: string | null;
  /**
   * N-451: 停止した瞬間に稼働対象だった定義の指紋（版・期限）のJSON。
   * この仕組みより前に止めた incident では null で、復旧前検査は
   * 「記録なし」として全ての変更検査をスキップしない（検査自体は走る）。
   */
  stoppedDefinitionsJson: string | null;
  /** N-451: 直近の復旧試行の検査結果（再開した対象・理由つきで止めた対象）。 */
  restoreReportJson: string | null;
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
  return Object.fromEntries(
    OPERATION_CAPABILITIES.map((capability) => [capability, 'running']),
  ) as OperationStates;
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
    // 停止中の正本が壊れた場合は、送信を再開せず安全側へ倒す。
    if (activeIncidentId) {
      for (const capability of OPERATION_CAPABILITIES) states[capability] = 'stopped';
    }
  }
  return states;
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
      scopeKey: operationScopeKey(lineAccountId),
      lineAccountId,
      version: 0,
      states: defaultOperationStates(),
      activeIncidentId: null,
      reason: null,
      actorId: null,
      stoppedAt: null,
      updatedAt: null,
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

function snapshot(control: OperationControlSet, capturedAt: string): OperationControlSnapshot {
  return {
    version: control.version,
    states: { ...control.states },
    activeIncidentId: control.activeIncidentId,
    reason: control.reason,
    actorId: control.actorId,
    stoppedAt: control.stoppedAt,
    capturedAt,
  };
}

function parseSnapshot(raw: string | null): OperationControlSnapshot | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Partial<OperationControlSnapshot>;
    if (!Number.isInteger(parsed.version) || !parsed.states || typeof parsed.capturedAt !== 'string') {
      return null;
    }
    return {
      version: Number(parsed.version),
      states: parseStates(JSON.stringify(parsed.states), parsed.activeIncidentId ?? null),
      activeIncidentId: parsed.activeIncidentId ?? null,
      reason: parsed.reason ?? null,
      actorId: parsed.actorId ?? null,
      stoppedAt: parsed.stoppedAt ?? null,
      capturedAt: parsed.capturedAt,
    };
  } catch {
    return null;
  }
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

export async function isOperationCapabilityStopped(
  db: D1Database,
  lineAccountId: string | null,
  capability: OperationCapability,
): Promise<boolean> {
  const scopeKeys = lineAccountId ? [ALL_ACCOUNTS_SCOPE, lineAccountId] : [ALL_ACCOUNTS_SCOPE];
  const rows = await db.prepare(
    `SELECT states_json, active_incident_id
       FROM operation_control_sets
      WHERE scope_key IN (${scopeKeys.map(() => '?').join(',')})`,
  ).bind(...scopeKeys).all<{ states_json: string; active_incident_id: string | null }>();
  return (rows.results ?? []).some((row) =>
    parseStates(row.states_json, row.active_incident_id)[capability] === 'stopped');
}

type IncidentRow = {
  id: string;
  scope_key: string;
  line_account_id: string | null;
  status: OperationIncidentStatus;
  capabilities_json: string;
  reason: string;
  detail: string | null;
  actor_id: string;
  resolved_by_actor_id: string | null;
  control_version: number | null;
  before_snapshot_json: string;
  stopped_snapshot_json: string | null;
  restored_snapshot_json: string | null;
  error_message: string | null;
  stopped_definitions_json: string | null;
  restore_report_json: string | null;
  stopped_at: string | null;
  resolved_at: string | null;
  created_at: string;
  updated_at: string;
};

function parseCapabilities(raw: string): OperationCapability[] {
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((value): value is OperationCapability =>
      typeof value === 'string' && OPERATION_CAPABILITIES.includes(value as OperationCapability));
  } catch {
    return [];
  }
}

function mapIncident(row: IncidentRow): OperationIncident {
  const beforeSnapshot = parseSnapshot(row.before_snapshot_json);
  if (!beforeSnapshot) throw new Error(`Invalid operation incident snapshot: ${row.id}`);
  return {
    id: row.id,
    scopeKey: row.scope_key,
    lineAccountId: row.line_account_id,
    status: row.status,
    capabilities: parseCapabilities(row.capabilities_json),
    reason: row.reason,
    detail: row.detail,
    actorId: row.actor_id,
    resolvedByActorId: row.resolved_by_actor_id,
    controlVersion: row.control_version,
    beforeSnapshot,
    stoppedSnapshot: parseSnapshot(row.stopped_snapshot_json),
    restoredSnapshot: parseSnapshot(row.restored_snapshot_json),
    errorMessage: row.error_message,
    stoppedDefinitionsJson: row.stopped_definitions_json ?? null,
    restoreReportJson: row.restore_report_json ?? null,
    stoppedAt: row.stopped_at,
    resolvedAt: row.resolved_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

async function insertIncident(
  db: D1Database,
  input: {
    id: string;
    lineAccountId: string | null;
    status: OperationIncidentStatus;
    capabilities: OperationCapability[];
    reason: string;
    detail: string | null;
    actorId: string;
    beforeSnapshot: OperationControlSnapshot;
    errorMessage?: string | null;
    now: string;
  },
): Promise<void> {
  await db.prepare(
    `INSERT INTO operation_incidents
       (id, scope_key, line_account_id, status, capabilities_json, reason, detail,
        actor_id, before_snapshot_json, error_message, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).bind(
    input.id,
    operationScopeKey(input.lineAccountId),
    input.lineAccountId,
    input.status,
    JSON.stringify(input.capabilities),
    input.reason,
    input.detail,
    input.actorId,
    JSON.stringify(input.beforeSnapshot),
    input.errorMessage ?? null,
    input.now,
    input.now,
  ).run();
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
  const now = new Date().toISOString();
  const incidentId = crypto.randomUUID();
  const current = await getOperationControlSet(db, input.lineAccountId);
  const beforeSnapshot = snapshot(current, now);
  if (current.version !== input.expectedVersion || current.activeIncidentId) {
    await insertIncident(db, {
      id: incidentId,
      lineAccountId: input.lineAccountId,
      status: 'failed',
      capabilities: input.capabilities,
      reason: input.reason,
      detail: input.detail ?? null,
      actorId: input.actorId,
      beforeSnapshot,
      errorMessage: '別の管理者による停止・復旧が先に反映されました',
      now,
    });
    return { status: 'conflict', control: current };
  }

  /*
   * N-451: 止める瞬間の「止まった定義」の指紋を取る。
   * 復旧のとき、ここで記録した版・期限と現在の定義を比べて、
   * 停止中の 編集・削除・追加・期限切れ を検査する。
   * 制御状態を裏返す前に取るので、snapshotは必ず停止前の定義を指す。
   */
  const stoppedDefinitions = await captureStoppedDefinitions(
    db, input.lineAccountId, input.capabilities,
  );

  await insertIncident(db, {
    id: incidentId,
    lineAccountId: input.lineAccountId,
    status: 'preparing',
    capabilities: input.capabilities,
    reason: input.reason,
    detail: input.detail ?? null,
    actorId: input.actorId,
    beforeSnapshot,
    now,
  });

  const nextStates = { ...current.states };
  for (const capability of input.capabilities) nextStates[capability] = 'stopped';
  const nextVersion = current.version + 1;
  const scopeKey = operationScopeKey(input.lineAccountId);
  let changed = 0;
  if (current.version === 0) {
    const result = await db.prepare(
      `INSERT OR IGNORE INTO operation_control_sets
         (scope_key, line_account_id, version, states_json, active_incident_id,
          reason, actor_id, stopped_at, updated_at)
       VALUES (?, ?, 1, ?, ?, ?, ?, ?, ?)`,
    ).bind(
      scopeKey,
      input.lineAccountId,
      JSON.stringify(nextStates),
      incidentId,
      input.reason,
      input.actorId,
      now,
      now,
    ).run();
    changed = Number(result.meta?.changes ?? 0);
  } else {
    const result = await db.prepare(
      `UPDATE operation_control_sets
          SET version = ?, states_json = ?, active_incident_id = ?, reason = ?,
              actor_id = ?, stopped_at = ?, updated_at = ?
        WHERE scope_key = ? AND version = ? AND active_incident_id IS NULL`,
    ).bind(
      nextVersion,
      JSON.stringify(nextStates),
      incidentId,
      input.reason,
      input.actorId,
      now,
      now,
      scopeKey,
      input.expectedVersion,
    ).run();
    changed = Number(result.meta?.changes ?? 0);
  }

  if (changed !== 1) {
    await db.prepare(
      `UPDATE operation_incidents
          SET status = 'failed', error_message = ?, updated_at = ?
        WHERE id = ?`,
    ).bind('別の管理者による停止・復旧が先に反映されました', now, incidentId).run();
    return { status: 'conflict', control: await getOperationControlSet(db, input.lineAccountId) };
  }

  const control = await getOperationControlSet(db, input.lineAccountId);
  await db.prepare(
    `UPDATE operation_incidents
        SET status = 'stopped', control_version = ?, stopped_snapshot_json = ?,
            stopped_definitions_json = ?, stopped_at = ?, updated_at = ?
      WHERE id = ? AND status = 'preparing'`,
  ).bind(
    control.version,
    JSON.stringify(snapshot(control, now)),
    JSON.stringify(stoppedDefinitions),
    now,
    now,
    incidentId,
  ).run();
  return {
    status: 'changed',
    control,
    incident: (await getOperationIncident(db, incidentId))!,
  };
}

/** N-451: 復旧試行の検査結果。incident の restore_report_json と応答の両方に載せる。 */
export interface OperationRestoreReport {
  evaluatedAt: string;
  drift: OperationRestoreDrift;
  /** この試行で再開した capability。 */
  resumed: OperationCapability[];
  /** 期限切れで下書きへ戻した予約配信。 */
  heldExpired: { capability: OperationCapability; id: string; expiresAt: string | null }[];
  /** まだ止まったままの capability。 */
  remaining: OperationCapability[];
}

export type RestoreOperationIncidentResult =
  | { status: 'restored'; control: OperationControlSet; incident: OperationIncident; report: OperationRestoreReport }
  | { status: 'partial'; control: OperationControlSet; incident: OperationIncident; report: OperationRestoreReport }
  | { status: 'blocked'; control: OperationControlSet; incident: OperationIncident; report: OperationRestoreReport }
  | { status: 'conflict'; control: OperationControlSet }
  | { status: 'not_found' };

/*
 * N-451: 停止前snapshotを無条件には戻さない。
 *
 * 停止時に保存した定義の指紋と現在を比べ、
 * - 変更・追加があった能力 → 再開せず理由つきで止めたままにする
 * - 期限を過ぎた予約配信 → 下書きへ戻し、過去時刻を送らせない
 * - 削除・人が止めたもの → もう動かないので記録だけする
 * - 対象アカウントの無効化 → 全ての再開を止める
 * という検査を通してから、残った能力だけを停止前の状態へ戻す。
 */
export async function restoreOperationIncident(
  db: D1Database,
  input: { incidentId: string; expectedVersion: number; actorId: string },
): Promise<RestoreOperationIncidentResult> {
  const incident = await getOperationIncident(db, input.incidentId);
  if (!incident || incident.status !== 'stopped') return { status: 'not_found' };
  const current = await getOperationControlSet(db, incident.lineAccountId);
  if (current.version !== input.expectedVersion || current.activeIncidentId !== incident.id) {
    return { status: 'conflict', control: current };
  }

  const now = new Date().toISOString();
  const drift = await inspectIncidentRestoreDrift(db, incident);

  // 期限切れの予約は再開の成否に関わらず下書きへ戻す。
  // 「停止中」でも拾われる経路が残っているので、戻すこと自体が防波堤。
  const heldIds = await holdExpiredBroadcasts(
    db,
    drift.expired
      .filter((entry) => entry.capability === 'broadcast_dispatch')
      .map((entry) => entry.id),
    input.actorId,
    now,
  );
  const heldExpired = drift.expired.filter((entry) => heldIds.includes(entry.id));

  const stillStopped = incident.capabilities.filter(
    (capability) => current.states[capability] === 'stopped',
  );
  const resumable = drift.resumable.filter((capability) => stillStopped.includes(capability));
  const report: OperationRestoreReport = {
    evaluatedAt: now,
    drift,
    resumed: resumable,
    heldExpired,
    remaining: stillStopped.filter((capability) => !resumable.includes(capability)),
  };

  if (resumable.length === 0) {
    await db.prepare(
      `UPDATE operation_incidents
          SET restore_report_json = ?, updated_at = ?
        WHERE id = ?`,
    ).bind(JSON.stringify(report), now, incident.id).run();
    return {
      status: 'blocked',
      control: current,
      incident: (await getOperationIncident(db, incident.id))!,
      report,
    };
  }

  const nextStates = { ...current.states };
  for (const capability of resumable) {
    nextStates[capability] = incident.beforeSnapshot.states[capability];
  }
  const fullyResolved = report.remaining.length === 0;
  const nextVersion = current.version + 1;
  const result = await db.prepare(
    `UPDATE operation_control_sets
        SET version = ?, states_json = ?, active_incident_id = ?, reason = ?,
            actor_id = ?, stopped_at = ?, updated_at = ?
      WHERE scope_key = ? AND version = ? AND active_incident_id = ?`,
  ).bind(
    nextVersion,
    JSON.stringify(nextStates),
    fullyResolved ? null : incident.id,
    fullyResolved ? null : current.reason,
    input.actorId,
    fullyResolved ? null : current.stoppedAt,
    now,
    current.scopeKey,
    input.expectedVersion,
    incident.id,
  ).run();
  if (Number(result.meta?.changes ?? 0) !== 1) {
    return { status: 'conflict', control: await getOperationControlSet(db, incident.lineAccountId) };
  }

  const control = await getOperationControlSet(db, incident.lineAccountId);
  if (fullyResolved) {
    await db.prepare(
      `UPDATE operation_incidents
          SET status = 'resolved', control_version = ?, resolved_by_actor_id = ?,
              restored_snapshot_json = ?, restore_report_json = ?, resolved_at = ?, updated_at = ?
        WHERE id = ? AND status = 'stopped'`,
    ).bind(
      control.version,
      input.actorId,
      JSON.stringify(snapshot(control, now)),
      JSON.stringify(report),
      now,
      now,
      incident.id,
    ).run();
  } else {
    await db.prepare(
      `UPDATE operation_incidents
          SET control_version = ?, restore_report_json = ?, updated_at = ?
        WHERE id = ? AND status = 'stopped'`,
    ).bind(control.version, JSON.stringify(report), now, incident.id).run();
  }
  return {
    status: fullyResolved ? 'restored' : 'partial',
    control,
    incident: (await getOperationIncident(db, incident.id))!,
    report,
  };
}

export async function getOperationIncident(
  db: D1Database,
  id: string,
): Promise<OperationIncident | null> {
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
  const limit = Math.max(1, Math.min(Math.floor(options.limit ?? 100), 200));
  const rows = await db.prepare(
    `SELECT * FROM operation_incidents
      WHERE ${clauses.map((clause) => `(${clause})`).join(' OR ')}
      ORDER BY created_at DESC, id DESC LIMIT ?`,
  ).bind(...binds, limit).all<IncidentRow>();
  return (rows.results ?? []).map(mapIncident);
}
