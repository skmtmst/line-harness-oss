import { processAutomationRun, startAutomationRun, type RunStatus } from './automation-engine.js';
import {
  automationRevisionToken,
  parseAutomationRevision,
  type AutomationVersionContent,
} from './automation-drafts.js';
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
  paging?: { limit?: number; offset?: number },
): Promise<{
  items: AutomationDefinitionSummary[];
  total: number;
  summary: { active: number; stopped: number; executionCount30d: number; failureCount30d: number };
  freshness: 'available';
}> {
  const emptySummary = { active: 0, stopped: 0, executionCount30d: 0, failureCount30d: 0 };
  if (lineAccountIds.length === 0) {
    return { items: [], total: 0, summary: emptySummary, freshness: 'available' };
  }
  const placeholders = lineAccountIds.map(() => '?').join(', ');
  // 集計はページ送りに依らず対象アカウント全体で数える（一覧のKPIと一致させる）。
  const [totalRow, statusRows, runTotals] = await Promise.all([
    db.prepare(
      `SELECT COUNT(*) AS count FROM automation_definitions d
        WHERE d.line_account_id IN (${placeholders}) AND d.status <> 'archived'`,
    ).bind(...lineAccountIds).first<{ count: number }>(),
    db.prepare(
      `SELECT d.status AS status, COUNT(*) AS count FROM automation_definitions d
        WHERE d.line_account_id IN (${placeholders}) AND d.status <> 'archived'
        GROUP BY d.status`,
    ).bind(...lineAccountIds).all<{ status: string; count: number }>(),
    db.prepare(
      `SELECT COUNT(*) AS executions,
              SUM(CASE WHEN r.status IN ('partial', 'failed') THEN 1 ELSE 0 END) AS failures
         FROM automation_runs r
         JOIN automation_definitions d ON d.id = r.automation_id
        WHERE d.line_account_id IN (${placeholders}) AND d.status <> 'archived'
          AND r.is_test = 0 AND r.status IN ('success', 'partial', 'failed')
          AND datetime(r.created_at) >= datetime('now', '-30 days')`,
    ).bind(...lineAccountIds).first<{ executions: number; failures: number | null }>(),
  ]);
  const limit = paging?.limit === undefined ? null
    : Math.max(1, Math.min(Math.floor(paging.limit), 200));
  const offset = paging?.offset === undefined ? 0
    : Math.max(0, Math.floor(paging.offset));
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
      ORDER BY d.priority DESC, d.updated_at DESC, d.id DESC${limit === null ? '' : ' LIMIT ? OFFSET ?'}`,
  ).bind(...lineAccountIds, ...(limit === null ? [] : [limit, offset])).all<DefinitionListRow>();
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
  const statusCount = new Map((statusRows.results ?? []).map((row) => [row.status, Number(row.count)]));
  return {
    items,
    total: Number(totalRow?.count ?? items.length),
    summary: {
      active: statusCount.get('active') ?? 0,
      stopped: statusCount.get('stopped') ?? 0,
      executionCount30d: Number(runTotals?.executions ?? 0),
      failureCount30d: Number(runTotals?.failures ?? 0),
    },
    freshness: 'available',
  };
}

interface SelectedVersion extends AutomationVersionContent {
  automation_id: string;
  version_id: string;
}

/**
 * 画面が持っている札（`<版の行のid>.<中身の指紋>`）で版を選ぶ。
 *
 * `requireFingerprint` を立てると、**指紋の無い札を受け取らない**。
 * 送信のように取り消せない口では、中身まで確かめられない札を通すと、
 * 守っているつもりの穴がそのまま残る。
 */
async function requireCurrentVersion(
  db: D1Database,
  input: { automationId: string; versionId: unknown; lineAccountId: string },
  options: { requireFingerprint?: boolean } = {},
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
  const requested = parseAutomationRevision(input.versionId);
  if (options.requireFingerprint && !requested.fingerprint) {
    throw new AutomationDefinitionError('version_conflict', '送る内容を確認し直してください', 'versionId');
  }
  const versionId = requested.versionId;
  if (![definition.current_draft_version_id, definition.current_published_version_id].includes(versionId)) {
    throw new AutomationDefinitionError('version_conflict', '確認中の版が変わりました。再読み込みしてください');
  }
  const version = await db.prepare(
    `SELECT automation_id, id AS version_id,
            trigger_type, trigger_config, condition_config, action_config
       FROM automation_versions
      WHERE id = ? AND automation_id = ?`,
  ).bind(versionId, definition.id).first<SelectedVersion>();
  if (!version) throw new AutomationDefinitionError('not_found', '指定した版が見つかりません');
  // 版の行のidは中身を書き換えても変わらない。**指紋まで見て初めて、
  // 確認したときの中身と同じかどうかが分かる。**
  if (requested.fingerprint
    && await automationRevisionToken(versionId, version) !== `${versionId}.${requested.fingerprint}`) {
    throw new AutomationDefinitionError(
      'version_conflict', '確認したあとに下書きが変わりました。もう一度、送る内容を確認してください',
    );
  }
  return version;
}

/** 版の中身が、読んだときのままかを見る。1文字でも違えば当たらない。 */
async function versionContentUnchanged(
  db: D1Database,
  version: SelectedVersion,
): Promise<boolean> {
  const row = await db.prepare(
    `SELECT 1 AS ok FROM automation_versions
      WHERE id = ? AND automation_id = ?
        AND trigger_type = ? AND trigger_config = ?
        AND condition_config = ? AND action_config = ?`,
  ).bind(
    version.version_id, version.automation_id,
    version.trigger_type, version.trigger_config,
    version.condition_config, version.action_config,
  ).first<{ ok: number }>();
  return !!row;
}

/**
 * 送る前に取りやめる。
 *
 * **実行記録は消せない。** `packages/db/bootstrap.sql` の
 * `trg_automation_runs_no_delete` / `trg_automation_run_steps_no_delete` が
 * 削除を禁じている（履歴を消さないという決めごと）。だから取りやめは
 * 「送らずに取消として閉じる」形にする。
 */
async function cancelAutomationRunBeforeSend(db: D1Database, runId: string): Promise<void> {
  await db.prepare(
    `UPDATE automation_runs
        SET status = 'cancelled', completed_at = ?, resume_at = NULL, lease_expires_at = NULL
      WHERE id = ? AND status IN ('queued', 'skipped_condition')`,
  ).bind(new Date().toISOString(), runId).run();
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
  /*
   * 1人テストは**取り消せない実送信**なので、確認した中身と1文字でも違えば
   * 送らない。守りは2段。
   *
   *   1. 入口で、札の指紋と DB のいまの中身を突き合わせる（`requireFingerprint`）。
   *      ここで違えば、実行記録すら作らずに 409 で返す（副作用0）。
   *   2. 実行計画を固めたあと・送る前に、もう一度中身を見る。`startAutomationRun`
   *      は自分でもう一度 `action_config` を読んで `execution_plan_json` に
   *      焼き付けるので、1 の後・その読み取りの前に割り込まれると、
   *      確認していない中身が焼き付く。**送る前に気づいて記録ごと捨てる。**
   *
   * ただし 2 は最後の網であって、主役ではない。**主役は版を不変にしたこと**で、
   * `updateAutomationDraft` は同じ行を書き換えず、新しい版の行を作って
   * `current_draft_version_id` を差し替える（`automation-drafts.ts`）。
   * `startAutomationRun` は `v.id IN (現在の下書き, 現在の公開)` を満たす版しか
   * 拾わないので、割り込みの保存が入った瞬間にこの札の版は外れ、
   * **実行記録を1行も作らずに** `not_active` で戻る。CAS が実行記録を作る文の
   * 中にある、という形はこれで満たされる。
   *
   * 2 に当たるのは、アプリを通さずDBを直接書き換えた場合だけである。
   * そのときは送らずに取消として閉じる（実行記録は消せない。理由は
   * `cancelAutomationRunBeforeSend` の注釈）。
   */
  const version = await requireCurrentVersion(db, input, { requireFingerprint: true });
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
  // 焼き付けたあと・送る前の最後の見張り（上の 2）。
  if (started.automationVersionId !== version.version_id
    || !await versionContentUnchanged(db, version)) {
    await cancelAutomationRunBeforeSend(db, started.runId);
    throw new AutomationDefinitionError(
      'version_conflict', '確認したあとに下書きが変わりました。送っていません。もう一度、送る内容を確認してください',
    );
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
