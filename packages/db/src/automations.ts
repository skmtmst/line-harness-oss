import { boundedListLimit, jstNow } from './utils.js';
// アクション自動化 (IF-THEN ルール) クエリヘルパー

export interface AutomationRow {
  id: string;
  name: string;
  description: string | null;
  event_type: string;
  conditions: string;  // JSON
  actions: string;     // JSON配列
  line_account_id: string | null;
  is_active: number;
  priority: number;
  created_at: string;
  updated_at: string;
}

export interface AutomationLogRow {
  id: string;
  automation_id: string;
  friend_id: string | null;
  event_data: string | null;
  actions_result: string | null;
  status: string;
  created_at: string;
}

export type AutomationRunDomainStatus =
  | 'queued'
  | 'running'
  | 'waiting'
  | 'success'
  | 'partial'
  | 'failed'
  | 'cancelled'
  | 'skipped_condition';

export interface AutomationExecutionRunRow {
  id: string;
  line_account_id: string;
  account_name: string | null;
  automation_id: string;
  automation_name: string;
  automation_version_id: string;
  friend_id: string | null;
  friend_name: string | null;
  source_event_id: string;
  trigger_type: string;
  status: AutomationRunDomainStatus;
  started_at: string | null;
  completed_at: string | null;
  created_at: string;
  duration_ms: number | null;
  successful_actions: string | null;
  skipped_actions: string | null;
  failed_action: string | null;
  failure_code: string | null;
}

export interface AutomationExecutionRunSummaryRow {
  total: number;
  executed: number;
  skipped: number;
  failed: number;
  most_run_name: string | null;
  most_run_count: number | null;
}

export interface AutomationExecutionRunsQuery {
  allowedAccountIds: string[];
  from: string;
  to: string;
  status?: AutomationRunDomainStatus[];
  search?: string;
  limit: number;
  offset: number;
}

function automationRunWhere(input: AutomationExecutionRunsQuery, includeFilters: boolean) {
  if (input.allowedAccountIds.length === 0) return { sql: '1 = 0', binds: [] as unknown[] };
  const clauses = [
    `r.line_account_id IN (${input.allowedAccountIds.map(() => '?').join(', ')})`,
    'datetime(r.created_at) >= datetime(?)',
    'datetime(r.created_at) < datetime(?)',
  ];
  const binds: unknown[] = [...input.allowedAccountIds, input.from, input.to];
  if (includeFilters && input.status?.length) {
    clauses.push(`r.status IN (${input.status.map(() => '?').join(', ')})`);
    binds.push(...input.status);
  }
  if (includeFilters && input.search?.trim()) {
    const needle = `%${input.search.trim().replaceAll('%', '\\%').replaceAll('_', '\\_')}%`;
    clauses.push(`(
      COALESCE(f.display_name, '') LIKE ? ESCAPE '\\' OR d.name LIKE ? ESCAPE '\\' OR
      v.trigger_type LIKE ? ESCAPE '\\' OR r.source_event_id LIKE ? ESCAPE '\\'
    )`);
    binds.push(needle, needle, needle, needle);
  }
  return { sql: clauses.join(' AND '), binds };
}

/**
 * V6 25-1-B: 新しい横断台帳を作らず、既存automation_runsを読み取り用に整える。
 * 書込時の詳細状態はそのまま保存し、共通状態への読み替えはAPI境界で行う。
 */
export async function getAutomationExecutionRuns(
  db: D1Database,
  input: AutomationExecutionRunsQuery,
): Promise<{ rows: AutomationExecutionRunRow[]; total: number; summary: AutomationExecutionRunSummaryRow }> {
  const filtered = automationRunWhere(input, true);
  const summaryScope = automationRunWhere(input, false);

  const [itemsResult, totalRow, summaryCounts, mostRun] = await Promise.all([
    db.prepare(
      `SELECT r.id, r.line_account_id, la.name AS account_name,
              r.automation_id, d.name AS automation_name, r.automation_version_id,
              r.friend_id, f.display_name AS friend_name, r.source_event_id,
              v.trigger_type, r.status, r.started_at, r.completed_at, r.created_at,
              CASE WHEN r.started_at IS NOT NULL AND r.completed_at IS NOT NULL
                   THEN MAX(0, ROUND((julianday(r.completed_at) - julianday(r.started_at)) * 86400000))
                   ELSE NULL END AS duration_ms,
              GROUP_CONCAT(CASE WHEN s.status = 'success' THEN s.action_type END, ' / ') AS successful_actions,
              GROUP_CONCAT(CASE WHEN s.status = 'skipped' THEN s.action_type END, ' / ') AS skipped_actions,
              MAX(CASE WHEN s.status = 'failed' THEN s.action_type END) AS failed_action,
              MAX(CASE WHEN s.status = 'failed' THEN s.error_code END) AS failure_code
         FROM automation_runs r
         JOIN automation_definitions d ON d.id = r.automation_id
         JOIN automation_versions v ON v.id = r.automation_version_id
         LEFT JOIN friends f ON f.id = r.friend_id
         LEFT JOIN line_accounts la ON la.id = r.line_account_id
         LEFT JOIN automation_run_steps s ON s.automation_run_id = r.id
        WHERE ${filtered.sql}
        GROUP BY r.id
        ORDER BY datetime(r.created_at) DESC, r.id DESC
        LIMIT ? OFFSET ?`,
    ).bind(...filtered.binds, input.limit, input.offset).all<AutomationExecutionRunRow>(),
    db.prepare(`SELECT COUNT(*) AS total FROM automation_runs r
      JOIN automation_definitions d ON d.id = r.automation_id
      JOIN automation_versions v ON v.id = r.automation_version_id
      LEFT JOIN friends f ON f.id = r.friend_id
      WHERE ${filtered.sql}`).bind(...filtered.binds).first<{ total: number }>(),
    db.prepare(`SELECT COUNT(*) AS total,
        SUM(CASE WHEN r.status IN ('success', 'partial', 'failed') THEN 1 ELSE 0 END) AS executed,
        SUM(CASE WHEN r.status = 'skipped_condition' THEN 1 ELSE 0 END) AS skipped,
        SUM(CASE WHEN r.status IN ('failed', 'partial') THEN 1 ELSE 0 END) AS failed
      FROM automation_runs r WHERE ${summaryScope.sql}`)
      .bind(...summaryScope.binds).first<{ total: number; executed: number; skipped: number; failed: number }>(),
    db.prepare(`SELECT d.name AS most_run_name, COUNT(*) AS most_run_count
      FROM automation_runs r JOIN automation_definitions d ON d.id = r.automation_id
      WHERE ${summaryScope.sql} AND r.status IN ('success', 'partial', 'failed')
      GROUP BY r.automation_id, d.name ORDER BY most_run_count DESC, d.name ASC LIMIT 1`)
      .bind(...summaryScope.binds).first<{ most_run_name: string; most_run_count: number }>(),
  ]);

  return {
    rows: itemsResult.results,
    total: Number(totalRow?.total ?? 0),
    summary: {
      total: Number(summaryCounts?.total ?? 0),
      executed: Number(summaryCounts?.executed ?? 0),
      skipped: Number(summaryCounts?.skipped ?? 0),
      failed: Number(summaryCounts?.failed ?? 0),
      most_run_name: mostRun?.most_run_name ?? null,
      most_run_count: mostRun ? Number(mostRun.most_run_count) : null,
    },
  };
}

// --- 自動化ルール ---

export async function getAutomations(db: D1Database): Promise<AutomationRow[]> {
  const result = await db.prepare(`SELECT * FROM automations ORDER BY priority DESC, created_at DESC`).all<AutomationRow>();
  return result.results;
}

export async function getAutomationById(db: D1Database, id: string): Promise<AutomationRow | null> {
  return db.prepare(`SELECT * FROM automations WHERE id = ?`).bind(id).first<AutomationRow>();
}

export async function createAutomation(
  db: D1Database,
  input: { name: string; description?: string; eventType: string; conditions?: Record<string, unknown>; actions: unknown[]; priority?: number },
): Promise<AutomationRow> {
  const id = crypto.randomUUID();
  const now = jstNow();
  await db.prepare(`INSERT INTO automations (id, name, description, event_type, conditions, actions, priority, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .bind(id, input.name, input.description ?? null, input.eventType, JSON.stringify(input.conditions ?? {}), JSON.stringify(input.actions), input.priority ?? 0, now, now).run();
  return (await getAutomationById(db, id))!;
}

export async function updateAutomation(
  db: D1Database,
  id: string,
  updates: Partial<{ name: string; description: string; eventType: string; conditions: Record<string, unknown>; actions: unknown[]; isActive: boolean; priority: number }>,
): Promise<void> {
  const sets: string[] = [];
  const values: unknown[] = [];
  if (updates.name !== undefined) { sets.push('name = ?'); values.push(updates.name); }
  if (updates.description !== undefined) { sets.push('description = ?'); values.push(updates.description); }
  if (updates.eventType !== undefined) { sets.push('event_type = ?'); values.push(updates.eventType); }
  if (updates.conditions !== undefined) { sets.push('conditions = ?'); values.push(JSON.stringify(updates.conditions)); }
  if (updates.actions !== undefined) { sets.push('actions = ?'); values.push(JSON.stringify(updates.actions)); }
  if (updates.isActive !== undefined) { sets.push('is_active = ?'); values.push(updates.isActive ? 1 : 0); }
  if (updates.priority !== undefined) { sets.push('priority = ?'); values.push(updates.priority); }
  if (sets.length === 0) return;
  sets.push('updated_at = ?');
  values.push(jstNow());
  values.push(id);
  await db.prepare(`UPDATE automations SET ${sets.join(', ')} WHERE id = ?`).bind(...values).run();
}

export async function deleteAutomation(db: D1Database, id: string): Promise<void> {
  await db.prepare(`DELETE FROM automations WHERE id = ?`).bind(id).run();
}

// --- 自動化ログ ---

export async function getAutomationLogs(db: D1Database, automationId?: string, limit = 100): Promise<AutomationLogRow[]> {
  const safeLimit = boundedListLimit(limit, 100);
  if (automationId) {
    const result = await db.prepare(`SELECT * FROM automation_logs WHERE automation_id = ? ORDER BY created_at DESC LIMIT ?`)
      .bind(automationId, safeLimit).all<AutomationLogRow>();
    return result.results;
  }
  const result = await db.prepare(`SELECT * FROM automation_logs ORDER BY created_at DESC LIMIT ?`)
    .bind(safeLimit).all<AutomationLogRow>();
  return result.results;
}

export async function createAutomationLog(
  db: D1Database,
  input: { automationId: string; friendId?: string; eventData?: string; actionsResult?: string; status: string },
): Promise<void> {
  const id = crypto.randomUUID();
  const now = jstNow();
  await db.prepare(`INSERT INTO automation_logs (id, automation_id, friend_id, event_data, actions_result, status, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)`)
    .bind(id, input.automationId, input.friendId ?? null, input.eventData ?? null, input.actionsResult ?? null, input.status, now).run();
}

/** イベントタイプに一致するアクティブな自動化ルールを取得（優先度順） */
export async function getActiveAutomationsByEvent(db: D1Database, eventType: string): Promise<AutomationRow[]> {
  const result = await db.prepare(`SELECT * FROM automations WHERE event_type = ? AND is_active = 1 ORDER BY priority DESC`)
    .bind(eventType).all<AutomationRow>();
  return result.results;
}
