import { processAutomationRun, startAutomationRun, type RunStatus } from './automation-engine.js';
import { createAutomationActionExecutors } from './automation-action-executors.js';
import { buildSegmentWhere, parseCondition, type SegmentCondition } from './segment-query.js';

export class AutomationDefinitionError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly field?: string,
  ) {
    super(message);
    this.name = 'AutomationDefinitionError';
  }
}

interface DefinitionListRow {
  id: string;
  line_account_id: string;
  name: string;
  description: string | null;
  status: 'draft' | 'active' | 'stopped' | 'archived';
  priority: number;
  version_id: string;
  version_number: number;
  trigger_type: string;
  trigger_config: string;
  condition_config: string;
  action_config: string;
  execution_count_30d: number;
  failure_count_30d: number;
  last_run_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface AutomationDefinitionSummary {
  id: string;
  name: string;
  description: string | null;
  eventType: string;
  triggerConfig: Record<string, unknown>;
  conditions: Record<string, unknown>;
  actions: unknown[];
  isActive: boolean;
  status: DefinitionListRow['status'];
  priority: number;
  lineAccountId: string;
  versionId: string;
  version: number;
  executionCount30d: number;
  failureCount30d: number;
  lastRunAt: string | null;
  createdAt: string;
  updatedAt: string;
}

function parseRecord(raw: string, label: string): Record<string, unknown> {
  try {
    const value: unknown = JSON.parse(raw);
    if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
      return value as Record<string, unknown>;
    }
  } catch {
    // 下で保存データ不整合へ揃える。
  }
  throw new AutomationDefinitionError('stored_data_invalid', `${label}を読み込めませんでした`);
}

function parseArray(raw: string, label: string): unknown[] {
  try {
    const value: unknown = JSON.parse(raw);
    if (Array.isArray(value)) return value;
  } catch {
    // 下で保存データ不整合へ揃える。
  }
  throw new AutomationDefinitionError('stored_data_invalid', `${label}を読み込めませんでした`);
}

export async function listAutomationDefinitions(
  db: D1Database,
  lineAccountIds: string[],
): Promise<{
  items: AutomationDefinitionSummary[];
  summary: { active: number; stopped: number; executionCount30d: number; failureCount30d: number };
  freshness: 'available';
}> {
  if (lineAccountIds.length === 0) {
    return {
      items: [],
      summary: { active: 0, stopped: 0, executionCount30d: 0, failureCount30d: 0 },
      freshness: 'available',
    };
  }
  const placeholders = lineAccountIds.map(() => '?').join(', ');
  const result = await db.prepare(
    `SELECT d.id, d.line_account_id, d.name, d.description, d.status, d.priority,
            v.id AS version_id, v.version_number, v.trigger_type, v.trigger_config,
            v.condition_config, v.action_config,
            (SELECT COUNT(*) FROM automation_runs r
              WHERE r.automation_id = d.id AND r.is_test = 0
                AND r.status IN ('success', 'partial', 'failed')
                AND datetime(r.created_at) >= datetime('now', '-30 days')) AS execution_count_30d,
            (SELECT COUNT(*) FROM automation_runs r
              WHERE r.automation_id = d.id AND r.is_test = 0
                AND r.status IN ('partial', 'failed')
                AND datetime(r.created_at) >= datetime('now', '-30 days')) AS failure_count_30d,
            (SELECT MAX(r.created_at) FROM automation_runs r
              WHERE r.automation_id = d.id AND r.is_test = 0) AS last_run_at,
            d.created_at, d.updated_at
       FROM automation_definitions d
       JOIN automation_versions v
         ON v.id = CASE
              WHEN d.status = 'draft' THEN d.current_draft_version_id
              ELSE d.current_published_version_id
            END
        AND v.automation_id = d.id
      WHERE d.line_account_id IN (${placeholders}) AND d.status <> 'archived'
      ORDER BY d.priority DESC, d.updated_at DESC, d.id DESC`,
  ).bind(...lineAccountIds).all<DefinitionListRow>();
  const items = (result.results ?? []).map((row): AutomationDefinitionSummary => ({
    id: row.id,
    name: row.name,
    description: row.description,
    eventType: row.trigger_type,
    triggerConfig: parseRecord(row.trigger_config, 'きっかけ'),
    conditions: parseRecord(row.condition_config, '対象条件'),
    actions: parseArray(row.action_config, '処理'),
    isActive: row.status === 'active',
    status: row.status,
    priority: Number(row.priority),
    lineAccountId: row.line_account_id,
    versionId: row.version_id,
    version: Number(row.version_number),
    executionCount30d: Number(row.execution_count_30d),
    failureCount30d: Number(row.failure_count_30d),
    lastRunAt: row.last_run_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }));
  return {
    items,
    summary: {
      active: items.filter((item) => item.status === 'active').length,
      stopped: items.filter((item) => item.status === 'stopped').length,
      executionCount30d: items.reduce((sum, item) => sum + item.executionCount30d, 0),
      failureCount30d: items.reduce((sum, item) => sum + item.failureCount30d, 0),
    },
    freshness: 'available',
  };
}

interface SelectedVersion {
  automation_id: string;
  version_id: string;
  condition_config: string;
}

async function requireCurrentVersion(
  db: D1Database,
  input: { automationId: string; versionId: unknown; lineAccountId: string },
): Promise<SelectedVersion> {
  if (typeof input.versionId !== 'string' || !input.versionId.trim()) {
    throw new AutomationDefinitionError('required', '確認する版を選んでください', 'versionId');
  }
  const definition = await db.prepare(
    `SELECT id, current_draft_version_id, current_published_version_id
       FROM automation_definitions
      WHERE id = ? AND line_account_id = ?`,
  ).bind(input.automationId, input.lineAccountId).first<{
    id: string;
    current_draft_version_id: string | null;
    current_published_version_id: string | null;
  }>();
  if (!definition) throw new AutomationDefinitionError('not_found', 'オートメーションが見つかりません');
  const versionId = input.versionId.trim();
  if (![definition.current_draft_version_id, definition.current_published_version_id].includes(versionId)) {
    throw new AutomationDefinitionError('version_conflict', '確認中の版が変わりました。再読み込みしてください');
  }
  const version = await db.prepare(
    `SELECT automation_id, id AS version_id, condition_config
       FROM automation_versions
      WHERE id = ? AND automation_id = ?`,
  ).bind(versionId, definition.id).first<SelectedVersion>();
  if (!version) throw new AutomationDefinitionError('not_found', '指定した版が見つかりません');
  return version;
}

function targetCondition(raw: string): SegmentCondition | null {
  const object = parseRecord(raw, '対象条件');
  if (Object.keys(object).length === 0) return null;
  const condition = parseCondition(raw);
  if (!condition) throw new AutomationDefinitionError('condition_invalid', '対象条件を確認してください', 'conditions');
  return condition;
}

export async function previewAutomationAudience(
  db: D1Database,
  input: { automationId: string; versionId: unknown; lineAccountId: string },
): Promise<{
  automationId: string;
  versionId: string;
  matched: number;
  total: number;
  freshness: 'available';
  calculatedAt: string;
}> {
  const version = await requireCurrentVersion(db, input);
  const condition = targetCondition(version.condition_config);
  const where = condition ? buildSegmentWhere(condition) : { sql: '1=1', bindings: [] as unknown[] };
  const [matched, total] = await Promise.all([
    db.prepare(
      `SELECT COUNT(*) AS count FROM friends f
        WHERE f.line_account_id = ? AND (${where.sql})`,
    ).bind(input.lineAccountId, ...where.bindings).first<{ count: number }>(),
    db.prepare(
      `SELECT COUNT(*) AS count FROM friends WHERE line_account_id = ?`,
    ).bind(input.lineAccountId).first<{ count: number }>(),
  ]);
  return {
    automationId: input.automationId,
    versionId: version.version_id,
    matched: Number(matched?.count ?? 0),
    total: Number(total?.count ?? 0),
    freshness: 'available',
    calculatedAt: new Date().toISOString(),
  };
}

export async function runAutomationTest(
  db: D1Database,
  input: {
    automationId: string;
    versionId: unknown;
    friendId: unknown;
    lineAccountId: string;
    credentialEncryptionKey?: string;
  },
): Promise<{ runId: string; versionId: string; status: RunStatus | 'busy' }> {
  const version = await requireCurrentVersion(db, input);
  if (typeof input.friendId !== 'string' || !input.friendId.trim()) {
    throw new AutomationDefinitionError('required', 'テストする友だちを選んでください', 'friendId');
  }
  const friendId = input.friendId.trim();
  const friend = await db.prepare(
    `SELECT id FROM friends WHERE id = ? AND line_account_id = ?`,
  ).bind(friendId, input.lineAccountId).first<{ id: string }>();
  if (!friend) throw new AutomationDefinitionError('not_found', 'テストする友だちが見つかりません');
  const condition = targetCondition(version.condition_config);
  const where = condition ? buildSegmentWhere(condition) : { sql: '1=1', bindings: [] as unknown[] };
  const match = await db.prepare(
    `SELECT 1 AS ok FROM friends f
      WHERE f.id = ? AND f.line_account_id = ? AND (${where.sql}) LIMIT 1`,
  ).bind(friendId, input.lineAccountId, ...where.bindings).first<{ ok: number }>();
  const requestId = crypto.randomUUID();
  const started = await startAutomationRun(db, {
    lineAccountId: input.lineAccountId,
    automationId: input.automationId,
    automationVersionId: version.version_id,
    sourceEventId: `manual-test:${requestId}`,
    idempotencyKey: `manual-test:${requestId}`,
    friendId,
    inputEvent: { type: 'manual_test' },
    conditionMatched: !!match,
    isTest: true,
  });
  if (!started.runId || !started.automationVersionId) {
    throw new AutomationDefinitionError('version_conflict', 'テストする版が変わりました。再読み込みしてください');
  }
  const status = started.status === 'queued'
    ? await processAutomationRun(db, started.runId, {
      executors: createAutomationActionExecutors({
        credentialEncryptionKey: input.credentialEncryptionKey,
      }),
    })
    : started.status;
  if (!status || status === 'not_found') {
    throw new AutomationDefinitionError('not_found', 'テスト実行を確認できませんでした');
  }
  return { runId: started.runId, versionId: started.automationVersionId, status };
}
