import { computeNextDeliveryAt, DEFAULT_TENANT_ID, jstNow } from '@line-crm/db';

import { fetchQuota } from './broadcast-quota-guard.js';
import { buildSegmentWhere, type SegmentCondition } from './segment-query.js';

const ACTION_TYPES = new Set([
  'add_tag',
  'remove_tag',
  'set_metadata',
  'start_scenario',
  'stop_scenario',
  'resume_scenario',
  'send_message',
  'send_webhook',
  'switch_rich_menu',
  'remove_rich_menu',
  'set_support_mark',
  'assign_operator',
  'adjust_mileage',
  'notify',
  'wait',
  'branch',
  'common_action',
]);

const ACTION_HOOKS = new Set(['step_sent', 'scenario_completed', 'choice_selected']);

export class ScenarioContractError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly status: 400 | 404 | 409 | 422 = 422,
    public readonly field?: string,
  ) {
    super(message);
    this.name = 'ScenarioContractError';
  }
}

type ScenarioContractRow = {
  id: string;
  line_account_id: string;
  delivery_mode: 'relative' | 'elapsed' | 'absolute_time';
  audience_condition_json: string | null;
};

type StepRow = {
  id: string;
  step_order: number;
  delay_minutes: number;
  offset_days: number | null;
  offset_minutes: number | null;
  delivery_time: string | null;
  target_condition_json: string | null;
};

export type ScenarioDraftAction = {
  id: string;
  hook: 'step_sent' | 'scenario_completed' | 'choice_selected';
  stepId: string | null;
  choiceKey: string | null;
  type: string;
  params: Record<string, unknown>;
  condition: SegmentCondition | null;
  onFailure: 'stop' | 'continue';
  sortOrder: number;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function requiredString(value: unknown, field: string, label: string): string {
  if (typeof value !== 'string' || !value.trim()) {
    throw new ScenarioContractError('required', `${label}を入力してください`, 422, field);
  }
  return value.trim();
}

function parseCondition(value: unknown, field: string): SegmentCondition | null {
  if (value === null || value === undefined) return null;
  if (!isRecord(value)) {
    throw new ScenarioContractError('condition_invalid', '条件の形が正しくありません', 422, field);
  }
  try {
    buildSegmentWhere(value as unknown as SegmentCondition);
  } catch (error) {
    throw new ScenarioContractError(
      'condition_invalid',
      `条件を読めません: ${error instanceof Error ? error.message : String(error)}`,
      422,
      field,
    );
  }
  return value as unknown as SegmentCondition;
}

function storedCondition(raw: string | null, field: string): SegmentCondition | null {
  if (!raw) return null;
  try {
    return parseCondition(JSON.parse(raw), field);
  } catch (error) {
    if (error instanceof ScenarioContractError) {
      throw new ScenarioContractError(
        'stored_condition_invalid',
        '保存済みの対象条件が壊れています',
        422,
        field,
      );
    }
    throw error;
  }
}

async function requireResource(
  db: D1Database,
  sql: string,
  binds: unknown[],
  field: string,
  label: string,
): Promise<void> {
  const row = await db.prepare(sql).bind(...binds).first<{ id: string }>();
  if (!row) {
    throw new ScenarioContractError(
      'resource_not_found',
      `${label}が見つからないか、別のLINE公式アカウントにあります`,
      422,
      field,
    );
  }
}

async function validateActionResources(
  db: D1Database,
  lineAccountId: string,
  scenarioId: string,
  action: ScenarioDraftAction,
  index: number,
  branchDepth = 0,
): Promise<ScenarioDraftAction> {
  const field = `afterActions.${index}.params`;
  const params = { ...action.params };
  if (action.stepId) {
    await requireResource(
      db,
      `SELECT ss.id FROM scenario_steps ss
        JOIN scenarios s ON s.id = ss.scenario_id
       WHERE ss.id = ? AND s.id = ? AND s.line_account_id = ?`,
      [action.stepId, scenarioId, lineAccountId],
      `afterActions.${index}.stepId`,
      '通',
    );
  }

  if (action.type === 'add_tag' || action.type === 'remove_tag') {
    const tagId = requiredString(params.tagId, `${field}.tagId`, 'タグ');
    await requireResource(db, 'SELECT id FROM tags WHERE id = ? AND line_account_id = ?', [tagId, lineAccountId], `${field}.tagId`, 'タグ');
  } else if (['start_scenario', 'stop_scenario', 'resume_scenario'].includes(action.type)) {
    const scenarioId = requiredString(params.scenarioId, `${field}.scenarioId`, 'シナリオ');
    await requireResource(db, 'SELECT id FROM scenarios WHERE id = ? AND line_account_id = ?', [scenarioId, lineAccountId], `${field}.scenarioId`, 'シナリオ');
  } else if (action.type === 'set_metadata') {
    const values = params.values ?? params.data;
    if (!isRecord(values) || Object.keys(values).length === 0) {
      throw new ScenarioContractError('metadata_values_required', '設定する友だち情報を入力してください', 422, `${field}.values`);
    }
    params.values = values;
    delete params.data;
  } else if (action.type === 'send_message') {
    if (params.templateId !== undefined) {
      const templateId = requiredString(params.templateId, `${field}.templateId`, 'テンプレート');
      await requireResource(db, 'SELECT id FROM templates WHERE id = ? AND line_account_id = ?', [templateId, lineAccountId], `${field}.templateId`, 'テンプレート');
    } else {
      requiredString(params.content, `${field}.content`, '送信内容');
    }
  } else if (action.type === 'send_webhook') {
    const webhookId = requiredString(params.webhookId, `${field}.webhookId`, '送信Webhook');
    await requireResource(db, 'SELECT id FROM outgoing_webhooks WHERE id = ? AND line_account_id = ? AND is_active = 1', [webhookId, lineAccountId], `${field}.webhookId`, '送信Webhook');
  } else if (action.type === 'switch_rich_menu') {
    const pageId = requiredString(params.richMenuPageId, `${field}.richMenuPageId`, 'リッチメニュー');
    await requireResource(
      db,
      `SELECT p.id FROM rich_menu_pages p
        JOIN rich_menu_groups g ON g.id = p.group_id
       WHERE p.id = ? AND g.account_id = ? AND g.status = 'published'`,
      [pageId, lineAccountId],
      `${field}.richMenuPageId`,
      '公開済みリッチメニュー',
    );
  } else if (action.type === 'set_support_mark') {
    const supportMarkId = requiredString(params.supportMarkId, `${field}.supportMarkId`, '対応マーク');
    await requireResource(
      db,
      `SELECT sm.id FROM support_marks sm
        JOIN support_mark_scopes sms ON sms.mark_id = sm.id
        JOIN line_accounts la ON la.id = ? AND la.tenant_id = sms.tenant_id
       WHERE sm.id = ? AND sm.archived_at IS NULL
         AND (sms.line_account_id IS NULL OR sms.line_account_id = ?)
       LIMIT 1`,
      [lineAccountId, supportMarkId, lineAccountId],
      `${field}.supportMarkId`,
      '対応マーク',
    );
  } else if (action.type === 'assign_operator') {
    if (params.unassign !== true) {
      const operatorId = requiredString(params.operatorId, `${field}.operatorId`, '担当者');
      await requireResource(
        db,
        `SELECT sm.id FROM staff_members sm
          JOIN line_accounts la ON la.id = ?
            AND COALESCE(la.tenant_id, ?) = COALESCE(sm.tenant_id, ?)
         WHERE sm.id = ? AND sm.is_active = 1
           AND (sm.account_scope = 'all' OR EXISTS (
             SELECT 1 FROM staff_account_scopes sas
              WHERE sas.staff_id = sm.id AND sas.line_account_id = ?
           ))`,
        [lineAccountId, DEFAULT_TENANT_ID, DEFAULT_TENANT_ID, operatorId, lineAccountId],
        `${field}.operatorId`,
        '担当者',
      );
    }
  } else if (action.type === 'adjust_mileage') {
    const amount = Number(params.amount);
    if (!Number.isSafeInteger(amount) || amount === 0) {
      throw new ScenarioContractError('mileage_amount_invalid', 'マイル増減は0以外の整数で指定してください', 422, `${field}.amount`);
    }
    requiredString(params.reason, `${field}.reason`, 'マイル増減の理由');
  } else if (action.type === 'notify') {
    const notificationDefinitionId = requiredString(params.notificationDefinitionId, `${field}.notificationDefinitionId`, '通知定義');
    await requireResource(
      db,
      `SELECT id FROM customer_notification_definitions
        WHERE id = ? AND line_account_id = ? AND status = 'published'`,
      [notificationDefinitionId, lineAccountId],
      `${field}.notificationDefinitionId`,
      '公開済み通知定義',
    );
  } else if (action.type === 'wait') {
    const nowMs = Date.now();
    const retentionLimitMs = nowMs + 90 * 24 * 60 * 60 * 1000;
    const duration = Number(params.duration ?? params.durationMinutes);
    const hasDuration = Number.isSafeInteger(duration)
      && duration > 0
      && duration % 5 === 0
      && duration <= 90 * 24 * 60;
    const untilAt = typeof params.until === 'string' ? Date.parse(params.until) : Number.NaN;
    const hasUntil = Number.isFinite(untilAt) && untilAt > nowMs && untilAt <= retentionLimitMs;
    const timeoutAt = typeof params.timeout === 'string' ? Date.parse(params.timeout) : Number.NaN;
    const hasCondition = params.condition !== undefined
      && Number.isFinite(timeoutAt)
      && timeoutAt > nowMs
      && timeoutAt <= retentionLimitMs;
    if (!hasDuration && !hasUntil && !hasCondition) {
      throw new ScenarioContractError('wait_invalid', '待つ時間は5分単位で90日以内、または日時・条件と期限を指定してください', 422, field);
    }
    if (hasDuration) {
      params.durationMinutes = duration;
      delete params.duration;
    }
    if (hasCondition) {
      parseCondition(params.condition, `${field}.condition`);
    }
  } else if (action.type === 'branch') {
    if (branchDepth >= 3) {
      throw new ScenarioContractError('branch_depth_exceeded', '条件分岐は3段までです', 422, field);
    }
    parseCondition(params.condition, `${field}.condition`);
    if (!Array.isArray(params.then) || !Array.isArray(params.else)) {
      throw new ScenarioContractError('branch_invalid', '条件分岐にはthenとelseが必要です', 422, field);
    }
    params.then = await validateNestedActions(
      db, lineAccountId, scenarioId, params.then, `${field}.then`, branchDepth + 1,
    );
    params.else = await validateNestedActions(
      db, lineAccountId, scenarioId, params.else, `${field}.else`, branchDepth + 1,
    );
  } else if (action.type === 'common_action') {
    const commonActionId = requiredString(params.commonActionId, `${field}.commonActionId`, '共通アクション');
    const published = await db.prepare(
      `SELECT ca.id, ca.current_published_version_id AS version_id
         FROM common_actions ca
         JOIN common_action_versions cav
           ON cav.id = ca.current_published_version_id
          AND cav.common_action_id = ca.id AND cav.status = 'published'
        WHERE ca.id = ? AND ca.line_account_id = ? AND ca.status = 'published'`,
    ).bind(commonActionId, lineAccountId).first<{ id: string; version_id: string }>();
    if (!published) {
      throw new ScenarioContractError('resource_not_found', '公開済み共通アクションが見つかりません', 422, `${field}.commonActionId`);
    }
    params.commonActionVersionId = published.version_id;
  }
  return { ...action, params };
}

async function validateNestedActions(
  db: D1Database,
  lineAccountId: string,
  scenarioId: string,
  value: unknown[],
  field: string,
  branchDepth: number,
): Promise<Array<{ id: string; type: string; params: Record<string, unknown>; onFailure: 'stop' | 'continue' }>> {
  if (value.length > 100) {
    throw new ScenarioContractError('actions_too_many', '分岐内のアクションは100件までです', 422, field);
  }
  const ids = new Set<string>();
  const normalized = [];
  for (const [index, raw] of value.entries()) {
    if (!isRecord(raw)) {
      throw new ScenarioContractError('action_invalid', '分岐内のアクションが正しくありません', 422, `${field}.${index}`);
    }
    const id = requiredString(raw.id, `${field}.${index}.id`, 'アクションID');
    if (ids.has(id)) {
      throw new ScenarioContractError('action_id_duplicate', '分岐内のアクションIDが重複しています', 422, `${field}.${index}.id`);
    }
    ids.add(id);
    const type = requiredString(raw.type, `${field}.${index}.type`, 'アクション種別');
    if (!ACTION_TYPES.has(type)) {
      throw new ScenarioContractError('action_type_unsupported', `処理「${type}」はまだ保存できません`, 422, `${field}.${index}.type`);
    }
    if (!isRecord(raw.params)) {
      throw new ScenarioContractError('action_params_invalid', '分岐内のアクション設定が正しくありません', 422, `${field}.${index}.params`);
    }
    const rawOnFailure = raw.onFailure ?? 'stop';
    if (rawOnFailure !== 'stop' && rawOnFailure !== 'continue') {
      throw new ScenarioContractError('failure_mode_invalid', '失敗時はstopかcontinueを指定してください', 422, `${field}.${index}.onFailure`);
    }
    const onFailure: 'stop' | 'continue' = rawOnFailure;
    const checked = await validateActionResources(db, lineAccountId, scenarioId, {
      id,
      hook: 'scenario_completed',
      stepId: null,
      choiceKey: null,
      type,
      params: raw.params,
      condition: null,
      onFailure,
      sortOrder: index,
    }, index, branchDepth);
    normalized.push({ id, type, params: checked.params, onFailure });
  }
  return normalized;
}

function normalizeActions(value: unknown): ScenarioDraftAction[] {
  if (!Array.isArray(value)) {
    throw new ScenarioContractError('actions_invalid', '送信後アクションは配列で指定してください', 422, 'afterActions');
  }
  if (value.length > 100) {
    throw new ScenarioContractError('actions_too_many', '送信後アクションは100件までです', 422, 'afterActions');
  }
  const ids = new Set<string>();
  return value.map((raw, index) => {
    if (!isRecord(raw)) {
      throw new ScenarioContractError('action_invalid', `${index + 1}番目のアクションが正しくありません`, 422, `afterActions.${index}`);
    }
    const id = requiredString(raw.id, `afterActions.${index}.id`, 'アクションID');
    if (ids.has(id)) {
      throw new ScenarioContractError('action_id_duplicate', 'アクションIDが重複しています', 422, `afterActions.${index}.id`);
    }
    ids.add(id);
    const hook = requiredString(raw.hook, `afterActions.${index}.hook`, '発火点');
    if (!ACTION_HOOKS.has(hook)) {
      throw new ScenarioContractError('action_hook_invalid', 'アクションの発火点が正しくありません', 422, `afterActions.${index}.hook`);
    }
    const type = requiredString(raw.type, `afterActions.${index}.type`, 'アクション種別');
    if (!ACTION_TYPES.has(type)) {
      throw new ScenarioContractError('action_type_unsupported', `処理「${type}」はまだ保存できません`, 422, `afterActions.${index}.type`);
    }
    if (!isRecord(raw.params)) {
      throw new ScenarioContractError('action_params_invalid', 'アクション設定が正しくありません', 422, `afterActions.${index}.params`);
    }
    const onFailure = raw.onFailure ?? 'stop';
    if (onFailure !== 'stop' && onFailure !== 'continue') {
      throw new ScenarioContractError('failure_mode_invalid', '失敗時はstopかcontinueを指定してください', 422, `afterActions.${index}.onFailure`);
    }
    const sortOrder = raw.sortOrder === undefined ? index : Number(raw.sortOrder);
    if (!Number.isSafeInteger(sortOrder) || sortOrder < 0) {
      throw new ScenarioContractError('sort_order_invalid', '並び順は0以上の整数で指定してください', 422, `afterActions.${index}.sortOrder`);
    }
    const stepId = raw.stepId == null ? null : requiredString(raw.stepId, `afterActions.${index}.stepId`, '通');
    if (hook !== 'scenario_completed' && !stepId) {
      throw new ScenarioContractError('step_required', 'この発火点には通の指定が必要です', 422, `afterActions.${index}.stepId`);
    }
    const choiceKey = raw.choiceKey == null ? null : requiredString(raw.choiceKey, `afterActions.${index}.choiceKey`, '選択肢');
    if (hook === 'choice_selected' && !choiceKey) {
      throw new ScenarioContractError('choice_required', '選択肢の発火にはchoiceKeyが必要です', 422, `afterActions.${index}.choiceKey`);
    }
    return {
      id,
      hook: hook as ScenarioDraftAction['hook'],
      stepId,
      choiceKey,
      type,
      params: raw.params,
      condition: parseCondition(raw.condition, `afterActions.${index}.condition`),
      onFailure,
      sortOrder,
    };
  });
}

async function scenarioRow(
  db: D1Database,
  scenarioId: string,
  lineAccountId: string,
): Promise<ScenarioContractRow> {
  const row = await db.prepare(
    `SELECT id, line_account_id, delivery_mode, audience_condition_json
       FROM scenarios WHERE id = ? AND line_account_id = ?`,
  ).bind(scenarioId, lineAccountId).first<ScenarioContractRow>();
  if (!row) throw new ScenarioContractError('not_found', 'シナリオが見つかりません', 404);
  return row;
}

async function count(db: D1Database, sql: string, binds: unknown[]): Promise<number> {
  const row = await db.prepare(sql).bind(...binds).first<{ total: number }>();
  return Number(row?.total ?? 0);
}

export async function simulateScenario(
  db: D1Database,
  input: { scenarioId: string; lineAccountId: string; startAt?: string },
) {
  const scenario = await scenarioRow(db, input.scenarioId, input.lineAccountId);
  const start = input.startAt ? new Date(input.startAt) : new Date();
  if (!Number.isFinite(start.getTime())) {
    throw new ScenarioContractError('start_at_invalid', '開始日時が正しくありません', 400, 'startAt');
  }
  const audience = storedCondition(scenario.audience_condition_json, 'audienceCondition');
  const audienceWhere = audience ? buildSegmentWhere(audience) : { sql: '1=1', bindings: [] as unknown[] };
  const baseBinds = [input.lineAccountId, ...audienceWhere.bindings];
  const accountTotal = await count(db, 'SELECT COUNT(*) AS total FROM friends f WHERE f.line_account_id = ?', [input.lineAccountId]);
  const matched = await count(
    db,
    `SELECT COUNT(*) AS total FROM friends f
      WHERE f.line_account_id = ? AND f.is_following = 1 AND (${audienceWhere.sql})`,
    baseBinds,
  );
  const alreadySubscribed = await count(
    db,
    `SELECT COUNT(DISTINCT f.id) AS total FROM friends f
      WHERE f.line_account_id = ? AND f.is_following = 1 AND (${audienceWhere.sql})
        AND EXISTS (
          SELECT 1 FROM friend_scenarios fs
           WHERE fs.friend_id = f.id AND fs.scenario_id = ?
             AND fs.status IN ('active', 'delivering')
        )`,
    [...baseBinds, input.scenarioId],
  );

  const rows = await db.prepare(
    `SELECT id, step_order, delay_minutes, offset_days, offset_minutes,
            delivery_time, target_condition_json
       FROM scenario_steps WHERE scenario_id = ? AND is_draft = 0
      ORDER BY step_order`,
  ).bind(input.scenarioId).all<StepRow>();
  const steps = [];
  let previousAt = start;
  for (const step of rows.results ?? []) {
    const target = storedCondition(step.target_condition_json, `steps.${step.id}.targetCondition`);
    const targetWhere = target ? buildSegmentWhere(target) : { sql: '1=1', bindings: [] as unknown[] };
    const targetCount = await count(
      db,
      `SELECT COUNT(*) AS total FROM friends f
        WHERE f.line_account_id = ? AND f.is_following = 1
          AND (${audienceWhere.sql}) AND (${targetWhere.sql})`,
      [input.lineAccountId, ...audienceWhere.bindings, ...targetWhere.bindings],
    );
    const scheduled = computeNextDeliveryAt(
      { delivery_mode: scenario.delivery_mode },
      step,
      { enrolledAt: start, previousDeliveredAt: previousAt, now: start },
    );
    previousAt = scheduled;
    steps.push({
      id: step.id,
      stepOrder: step.step_order,
      scheduledAt: scheduled.toISOString(),
      targetCount,
      excludedCount: Math.max(matched - targetCount, 0),
    });
  }

  return {
    scenarioId: input.scenarioId,
    lineAccountId: input.lineAccountId,
    computedAt: new Date().toISOString(),
    sideEffects: false as const,
    audience: {
      accountTotal,
      matched,
      alreadySubscribed,
      newStartPlanned: Math.max(matched - alreadySubscribed, 0),
      excluded: Math.max(accountTotal - matched, 0),
    },
    steps,
  };
}

export async function saveScenarioDraft(
  db: D1Database,
  input: {
    scenarioId: string;
    lineAccountId: string;
    expectedVersion: number;
    afterActions: unknown;
    staffId: string;
  },
) {
  await scenarioRow(db, input.scenarioId, input.lineAccountId);
  if (!Number.isSafeInteger(input.expectedVersion) || input.expectedVersion < 0) {
    throw new ScenarioContractError('expected_version_invalid', 'expectedVersionは0以上の整数で指定してください', 400, 'expectedVersion');
  }
  const normalized = normalizeActions(input.afterActions);
  const actions: ScenarioDraftAction[] = [];
  for (const [index, action] of normalized.entries()) {
    actions.push(await validateActionResources(
      db, input.lineAccountId, input.scenarioId, action, index,
    ));
  }
  const now = jstNow();
  const json = JSON.stringify(actions);
  let result: D1Result<unknown>;
  if (input.expectedVersion === 0) {
    result = await db.prepare(
      `INSERT OR IGNORE INTO scenario_drafts
         (scenario_id, line_account_id, version, after_actions_json, updated_by, created_at, updated_at)
       VALUES (?, ?, 1, ?, ?, ?, ?)`,
    ).bind(input.scenarioId, input.lineAccountId, json, input.staffId, now, now).run();
  } else {
    result = await db.prepare(
      `UPDATE scenario_drafts
          SET after_actions_json = ?, version = version + 1, updated_by = ?, updated_at = ?
        WHERE scenario_id = ? AND line_account_id = ? AND version = ?`,
    ).bind(json, input.staffId, now, input.scenarioId, input.lineAccountId, input.expectedVersion).run();
  }
  if (Number(result.meta.changes ?? 0) === 0) {
    throw new ScenarioContractError(
      'version_conflict',
      'ほかの担当者が先に下書きを変更しました。読み直してください',
      409,
    );
  }
  return {
    scenarioId: input.scenarioId,
    lineAccountId: input.lineAccountId,
    version: input.expectedVersion + 1,
    afterActions: actions,
    updatedBy: input.staffId,
    updatedAt: now,
  };
}

type QuotaFetcher = typeof fetchQuota;

export async function getScenarioRuns(
  db: D1Database,
  input: {
    scenarioId: string;
    lineAccountId: string;
    status?: string;
    cursor?: string;
    limit: number;
    quotaFetcher?: QuotaFetcher;
  },
) {
  await scenarioRow(db, input.scenarioId, input.lineAccountId);
  const allowedStatuses = new Set(['active', 'paused', 'completed', 'delivering']);
  if (input.status && !allowedStatuses.has(input.status)) {
    throw new ScenarioContractError('status_invalid', 'statusが正しくありません', 400, 'status');
  }
  const offset = input.cursor && /^\d+$/.test(input.cursor) ? Number(input.cursor) : 0;
  const limit = Math.max(1, Math.min(100, input.limit));
  const statusSql = input.status ? ' AND fs.status = ?' : '';
  const statusBinds = input.status ? [input.status] : [];
  const summaryRows = await db.prepare(
    `SELECT fs.status, COUNT(*) AS total FROM friend_scenarios fs
      JOIN friends f ON f.id = fs.friend_id AND f.line_account_id = ?
      WHERE fs.scenario_id = ? GROUP BY fs.status`,
  ).bind(input.lineAccountId, input.scenarioId).all<{ status: string; total: number }>();
  const summary = { active: 0, paused: 0, completed: 0, delivering: 0 };
  for (const row of summaryRows.results ?? []) {
    if (row.status in summary) summary[row.status as keyof typeof summary] = Number(row.total ?? 0);
  }
  const total = await count(
    db,
    `SELECT COUNT(*) AS total FROM friend_scenarios fs
      JOIN friends f ON f.id = fs.friend_id AND f.line_account_id = ?
      WHERE fs.scenario_id = ?${statusSql}`,
    [input.lineAccountId, input.scenarioId, ...statusBinds],
  );
  const subscriptions = await db.prepare(
    `SELECT fs.id, fs.friend_id, f.display_name, fs.status, fs.current_step_order,
            fs.started_at, fs.next_delivery_at, fs.updated_at
       FROM friend_scenarios fs
       JOIN friends f ON f.id = fs.friend_id AND f.line_account_id = ?
      WHERE fs.scenario_id = ?${statusSql}
      ORDER BY fs.started_at DESC, fs.id DESC LIMIT ? OFFSET ?`,
  ).bind(input.lineAccountId, input.scenarioId, ...statusBinds, limit, offset).all<{
    id: string; friend_id: string; display_name: string; status: string;
    current_step_order: number; started_at: string; next_delivery_at: string | null; updated_at: string;
  }>();
  const testSends = await db.prepare(
    `SELECT MIN(ml.id) AS id, ml.friend_id, f.display_name,
            MIN(ml.created_at) AS sent_at, COUNT(*) AS message_count
       FROM messages_log ml
       JOIN scenario_steps ss ON ss.id = ml.scenario_step_id
       JOIN friends f ON f.id = ml.friend_id AND f.line_account_id = ?
      WHERE ss.scenario_id = ? AND ml.source = 'scenario_test'
        AND ml.line_account_id = ?
      GROUP BY ml.friend_id, substr(ml.created_at, 1, 19)
      ORDER BY sent_at DESC LIMIT 20`,
  ).bind(input.lineAccountId, input.scenarioId, input.lineAccountId).all<{
    id: string; friend_id: string; display_name: string; sent_at: string; message_count: number;
  }>();
  const concurrent = await db.prepare(
    `SELECT DISTINCT b.id, b.title, b.status, b.scheduled_at
       FROM broadcasts b
      WHERE b.line_account_id = ? AND b.status IN ('scheduled', 'sending')
        AND b.scheduled_at IS NOT NULL
        AND EXISTS (
          SELECT 1 FROM friend_scenarios fs
           WHERE fs.scenario_id = ? AND fs.status IN ('active', 'delivering')
             AND fs.next_delivery_at IS NOT NULL
             AND substr(fs.next_delivery_at, 1, 16) = substr(b.scheduled_at, 1, 16)
        )
      ORDER BY b.scheduled_at, b.id LIMIT 20`,
  ).bind(input.lineAccountId, input.scenarioId).all<{
    id: string; title: string; status: string; scheduled_at: string;
  }>();
  const stepRows = await db.prepare(
    `SELECT ss.id, ss.step_order,
            COUNT(DISTINCT CASE
              WHEN ml.direction = 'outgoing' AND ml.source = 'scenario' THEN ml.id END
            ) AS delivered
       FROM scenario_steps ss
       LEFT JOIN messages_log ml ON ml.scenario_step_id = ss.id
      WHERE ss.scenario_id = ?
      GROUP BY ss.id, ss.step_order ORDER BY ss.step_order`,
  ).bind(input.scenarioId).all<{ id: string; step_order: number; delivered: number }>();
  const clickRow = await db.prepare(
    `SELECT COALESCE(SUM(click_count), 0) AS total
       FROM tracked_links WHERE scenario_id = ? AND line_account_id = ?`,
  ).bind(input.scenarioId, input.lineAccountId).first<{ total: number }>();
  const account = await db.prepare(
    'SELECT channel_access_token FROM line_accounts WHERE id = ?',
  ).bind(input.lineAccountId).first<{ channel_access_token: string | null }>();
  const fetched = account?.channel_access_token
    ? await (input.quotaFetcher ?? fetchQuota)(account.channel_access_token)
    : { limit: null, used: null };
  const quota = fetched.used === null
    ? { limit: fetched.limit, used: null, remaining: null, state: 'unavailable' as const, reason: '送信数を取得できませんでした' }
    : fetched.limit === null
      ? { limit: null, used: fetched.used, remaining: null, state: 'unlimited' as const, reason: null }
      : { limit: fetched.limit, used: fetched.used, remaining: Math.max(fetched.limit - fetched.used, 0), state: 'available' as const, reason: null };
  const unavailable = (reason: string) => ({ value: null, state: 'unavailable' as const, reason });

  return {
    summary,
    subscriptions: (subscriptions.results ?? []).map((row) => ({
      id: row.id,
      friendId: row.friend_id,
      friendName: row.display_name,
      status: row.status,
      currentStepOrder: row.current_step_order,
      startedAt: row.started_at,
      nextDeliveryAt: row.next_delivery_at,
      updatedAt: row.updated_at,
    })),
    pagination: {
      total,
      limit,
      cursor: String(offset),
      nextCursor: offset + limit < total ? String(offset + limit) : null,
    },
    testSends: (testSends.results ?? []).map((row) => ({
      id: row.id,
      friendId: row.friend_id,
      friendName: row.display_name,
      sentAt: row.sent_at,
      messageCount: Number(row.message_count ?? 0),
    })),
    quota: { ...quota, asOf: new Date().toISOString() },
    concurrentBroadcasts: (concurrent.results ?? []).map((row) => ({
      id: row.id,
      title: row.title,
      status: row.status,
      scheduledAt: row.scheduled_at,
    })),
    scenarioClickTotal: Number(clickRow?.total ?? 0),
    steps: (stepRows.results ?? []).map((row) => ({
      id: row.id,
      stepOrder: row.step_order,
      delivered: Number(row.delivered ?? 0),
      opened: unavailable('LINEはシナリオの通ごとの開封数を提供していません'),
      clicked: unavailable('計測URLを通へ対応付ける識別子がまだありません'),
      failed: unavailable('既存の配信履歴には通ごとの失敗台帳がありません'),
    })),
  };
}
