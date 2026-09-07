import type { ActionDefinition } from './automation-engine.js';

const SUPPORTED_ACTION_TYPES = new Set([
  'add_tag',
  'remove_tag',
  'set_metadata',
  'set_support_mark',
  'start_scenario',
  'stop_scenario',
  'resume_scenario',
  'send_message',
  'send_webhook',
  'switch_rich_menu',
  'remove_rich_menu',
  'start_reminder',
  'stop_reminder',
  'notify_staff',
  'grant_mileage',
  'wait',
  'common_action',
  'branch',
]);

export class CommonActionValidationError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly field?: string,
  ) {
    super(message);
    this.name = 'CommonActionValidationError';
  }
}

export interface CommonActionSummary {
  id: string;
  name: string;
  description: string | null;
  status: 'draft' | 'published' | 'archived';
  draftVersion: number | null;
  publishedVersion: number | null;
  actionCount: number;
  bindingCount: number;
  oldVersionBindingCount: number;
  executionCountThisMonth: number;
  failureCountThisMonth: number;
  lastRunAt: string | null;
  updatedAt: string;
}

interface CommonActionRow {
  id: string;
  line_account_id: string;
  name: string;
  description: string | null;
  status: 'draft' | 'published' | 'archived';
  current_draft_version_id: string | null;
  current_published_version_id: string | null;
  created_at: string;
  updated_at: string;
}

interface VersionRow {
  id: string;
  common_action_id: string;
  version_number: number;
  status: 'draft' | 'published';
  action_config: string;
  created_by: string | null;
  created_at: string;
  published_at: string | null;
}

export interface CommonActionVersion {
  id: string;
  versionNumber: number;
  status: 'draft' | 'published';
  actions: ActionDefinition[];
  createdBy: string | null;
  createdAt: string;
  publishedAt: string | null;
}

export interface CommonActionBinding {
  id: string;
  consumerType: string;
  consumerId: string;
  consumerPath: string;
  versionId: string;
  versionNumber: number;
  latestVersionNumber: number | null;
  hasNewerVersion: boolean;
  runningCount: number | null;
  waitingCount: number | null;
  updatedAt: string;
}

export interface CommonActionResources {
  trigger: 'tag.added' | null;
  actionTypes: Array<{
    id: string;
    label: string;
    actionType: string;
    variant?: string;
    resource?: string;
    state: 'available' | 'unavailable';
    reason: string | null;
    schema: {
      type: 'object';
      required: string[];
      properties: Record<string, Record<string, unknown>>;
    };
  }>;
  tags: Array<{ id: string; name: string }>;
  scenarios: Array<{ id: string; name: string }>;
  templates: Array<{ id: string; name: string }>;
  friendFields: Array<{ id: string; name: string }>;
  supportMarks: Array<{ id: string; name: string }>;
  reminders: Array<{ id: string; name: string }>;
  notificationRules: Array<{ id: string; name: string }>;
  webhooks: Array<{ id: string; name: string }>;
  richMenus: Array<{ id: string; name: string }>;
  commonActions: Array<{ id: string; name: string; version: number }>;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function requiredString(value: unknown, field: string, label: string): string {
  if (typeof value !== 'string' || !value.trim()) {
    throw new CommonActionValidationError('required', `${label}を入力してください`, field);
  }
  return value.trim();
}

function parseStoredActions(raw: string): ActionDefinition[] {
  try {
    return validateActionShape(JSON.parse(raw));
  } catch (error) {
    if (error instanceof CommonActionValidationError) throw error;
    throw new CommonActionValidationError('stored_action_config_invalid', '保存済みの処理定義が壊れています');
  }
}

export function validateActionShape(value: unknown, depth = 0): ActionDefinition[] {
  if (depth > 3) {
    throw new CommonActionValidationError('branch_too_deep', '条件分岐の入れ子は3段までです', 'actions');
  }
  if (!Array.isArray(value) || value.length === 0) {
    throw new CommonActionValidationError('actions_required', '処理を1つ以上追加してください', 'actions');
  }
  if (value.length > 100) {
    throw new CommonActionValidationError('actions_too_many', '処理は100個までです', 'actions');
  }
  const ids = new Set<string>();
  return value.map((item, index) => {
    if (!isRecord(item)) {
      throw new CommonActionValidationError('action_invalid', `${index + 1}番目の処理が正しくありません`, `actions.${index}`);
    }
    const id = requiredString(item.id, `actions.${index}.id`, `${index + 1}番目の処理ID`);
    const type = requiredString(item.type, `actions.${index}.type`, `${index + 1}番目の処理の種類`);
    if (ids.has(id)) {
      throw new CommonActionValidationError('action_id_duplicate', `処理ID「${id}」が重複しています`, `actions.${index}.id`);
    }
    ids.add(id);
    if (!SUPPORTED_ACTION_TYPES.has(type)) {
      throw new CommonActionValidationError('action_type_unsupported', `処理「${type}」はまだ実行できません`, `actions.${index}.type`);
    }
    if (!isRecord(item.params)) {
      throw new CommonActionValidationError('action_params_invalid', `${index + 1}番目の処理設定が正しくありません`, `actions.${index}.params`);
    }
    const onFailure = item.onFailure ?? 'stop';
    if (onFailure !== 'stop' && onFailure !== 'continue') {
      throw new CommonActionValidationError('failure_mode_invalid', '失敗時は「止める」か「次へ進む」を選んでください', `actions.${index}.onFailure`);
    }
    let params = item.params;
    if (type === 'branch') {
      const condition = params.condition;
      if (!isRecord(condition) || !['AND', 'OR'].includes(String(condition.operator))
        || !Array.isArray(condition.rules) || condition.rules.length === 0) {
        throw new CommonActionValidationError(
          'branch_condition_invalid', '条件分岐の条件を1つ以上指定してください', `actions.${index}.params.condition`,
        );
      }
      params = {
        ...params,
        then: validateActionShape(params.then, depth + 1),
        else: validateActionShape(params.else, depth + 1),
      };
    }
    return { id, type, params, onFailure };
  });
}

async function requireResource(
  db: D1Database,
  input: { table: string; id: unknown; lineAccountId: string; field: string; label: string },
): Promise<string> {
  const id = requiredString(input.id, input.field, input.label);
  const row = await db.prepare(
    `SELECT id FROM ${input.table} WHERE id = ? AND line_account_id = ? LIMIT 1`,
  ).bind(id, input.lineAccountId).first<{ id: string }>();
  if (!row) {
    throw new CommonActionValidationError('resource_not_found', `${input.label}が見つからないか、別のLINE公式アカウントにあります`, input.field);
  }
  return id;
}

/** タグ連動の下書き保存時にも、別アカウントの選択肢を混ぜない。 */
export async function validateTagAddedActionResources(
  db: D1Database,
  lineAccountId: string,
  actions: ActionDefinition[],
): Promise<ActionDefinition[]> {
  for (const [index, action] of actions.entries()) {
    const field = `actions.${index}.params`;
    if (action.type === 'add_tag' || action.type === 'remove_tag') {
      await requireResource(db, {
        table: 'tags', id: action.params.tagId, lineAccountId,
        field: `${field}.tagId`, label: 'タグ',
      });
    } else if (action.type === 'start_scenario'
      || action.type === 'stop_scenario'
      || action.type === 'resume_scenario') {
      await requireResource(db, {
        table: 'scenarios', id: action.params.scenarioId, lineAccountId,
        field: `${field}.scenarioId`, label: 'シナリオ',
      });
    } else if (action.type === 'send_message') {
      if (action.params.templateId !== undefined || action.params.template_id !== undefined) {
        await requireResource(db, {
          table: 'templates', id: action.params.templateId ?? action.params.template_id,
          lineAccountId, field: `${field}.templateId`, label: 'テンプレート',
        });
      } else {
        requiredString(action.params.content, `${field}.content`, '送信内容');
      }
    } else if (action.type === 'set_metadata') {
      if (action.params.fieldId !== undefined) {
        throw new CommonActionValidationError(
          'resource_scope_unavailable',
          '友だち情報欄のアカウント範囲が整うまで、この処理は選べません',
          `${field}.fieldId`,
        );
      }
      const values = action.params.values ?? action.params.data;
      if (!isRecord(values) || Object.keys(values).length === 0) {
        throw new CommonActionValidationError(
          'metadata_values_required', '設定する友だち情報を入力してください', `${field}.values`,
        );
      }
    } else if (action.type === 'set_support_mark') {
      const markId = requiredString(action.params.markId, `${field}.markId`, '対応マーク');
      const mark = await db.prepare(
        `SELECT sm.id
           FROM support_marks sm
           JOIN support_mark_scopes sms ON sms.mark_id = sm.id
           JOIN line_accounts la ON la.id = ? AND la.tenant_id = sms.tenant_id
          WHERE sm.id = ? AND sm.archived_at IS NULL
            AND (sms.line_account_id IS NULL OR sms.line_account_id = ?)
          LIMIT 1`,
      ).bind(lineAccountId, markId, lineAccountId).first<{ id: string }>();
      if (!mark) {
        throw new CommonActionValidationError(
          'resource_not_found', '対応マークが見つからないか、別のLINE公式アカウントにあります',
          `${field}.markId`,
        );
      }
    } else if (action.type === 'start_reminder' || action.type === 'stop_reminder') {
      const reminderId = requiredString(action.params.reminderId, `${field}.reminderId`, 'リマインダ');
      const reminder = await db.prepare(
        `SELECT id FROM reminders
          WHERE id = ? AND line_account_id = ? AND deleted_at IS NULL LIMIT 1`,
      ).bind(reminderId, lineAccountId).first<{ id: string }>();
      if (!reminder) {
        throw new CommonActionValidationError(
          'resource_not_found', 'リマインダが見つからないか、別のLINE公式アカウントにあります',
          `${field}.reminderId`,
        );
      }
    } else if (action.type === 'switch_rich_menu') {
      const pageId = requiredString(
        action.params.richMenuPageId ?? action.params.richMenuId,
        `${field}.richMenuPageId`,
        'リッチメニュー',
      );
      const page = await db.prepare(
        `SELECT p.id FROM rich_menu_pages p
          JOIN rich_menu_groups g ON g.id = p.group_id
         WHERE p.id = ? AND g.account_id = ? AND g.status = 'published' LIMIT 1`,
      ).bind(pageId, lineAccountId).first<{ id: string }>();
      if (!page) {
        throw new CommonActionValidationError(
          'resource_not_found',
          '公開済みのリッチメニューが見つからないか、別のLINE公式アカウントにあります',
          `${field}.richMenuPageId`,
        );
      }
    } else if (action.type === 'notify_staff') {
      const ruleId = requiredString(
        action.params.notificationRuleId,
        `${field}.notificationRuleId`,
        '担当者通知',
      );
      const rule = await db.prepare(
        `SELECT id FROM notification_rules
          WHERE id = ? AND line_account_id = ? AND is_active = 1 LIMIT 1`,
      ).bind(ruleId, lineAccountId).first<{ id: string }>();
      if (!rule) {
        throw new CommonActionValidationError(
          'resource_not_found', '担当者通知が見つからないか、別のLINE公式アカウントにあります',
          `${field}.notificationRuleId`,
        );
      }
      requiredString(action.params.message, `${field}.message`, '通知文');
    } else if (action.type === 'grant_mileage') {
      const amount = Number(action.params.amount);
      if (!Number.isInteger(amount) || amount < 1 || amount > 1_000_000) {
        throw new CommonActionValidationError(
          'mileage_amount_invalid', '付けるマイルは1〜1000000の整数で指定してください',
          `${field}.amount`,
        );
      }
    } else if (action.type === 'branch') {
      const condition = action.params.condition as { rules?: Array<{ type?: unknown; value?: unknown }> };
      for (const [ruleIndex, rule] of (condition.rules ?? []).entries()) {
        if (rule.type === 'tag_exists' || rule.type === 'tag_not_exists') {
          await requireResource(db, {
            table: 'tags', id: rule.value, lineAccountId,
            field: `${field}.condition.rules.${ruleIndex}.value`, label: '分岐条件のタグ',
          });
        }
      }
      await validateTagAddedActionResources(
        db,
        lineAccountId,
        action.params.then as ActionDefinition[],
      );
      await validateTagAddedActionResources(
        db,
        lineAccountId,
        action.params.else as ActionDefinition[],
      );
    }
  }
  return actions;
}

async function pinAndValidateReferences(
  db: D1Database,
  lineAccountId: string,
  ownerId: string,
  actions: ActionDefinition[],
): Promise<ActionDefinition[]> {
  const pinned: ActionDefinition[] = [];
  for (const [index, action] of actions.entries()) {
    const field = `actions.${index}.params`;
    const params = { ...action.params };
    if (action.type === 'add_tag' || action.type === 'remove_tag') {
      params.tagId = await requireResource(db, {
        table: 'tags', id: params.tagId, lineAccountId, field: `${field}.tagId`, label: 'タグ',
      });
    } else if (action.type === 'start_scenario' || action.type === 'stop_scenario' || action.type === 'resume_scenario') {
      params.scenarioId = await requireResource(db, {
        table: 'scenarios', id: params.scenarioId, lineAccountId, field: `${field}.scenarioId`, label: 'シナリオ',
      });
    } else if (action.type === 'send_webhook') {
      params.webhookId = await requireResource(db, {
        table: 'outgoing_webhooks', id: params.webhookId, lineAccountId, field: `${field}.webhookId`, label: '送信Webhook',
      });
    } else if (action.type === 'send_message') {
      const templateId = params.templateId ?? params.template_id;
      if (templateId !== undefined) {
        params.templateId = await requireResource(db, {
          table: 'templates', id: templateId, lineAccountId, field: `${field}.templateId`, label: 'テンプレート',
        });
        delete params.template_id;
      } else {
        requiredString(params.content, `${field}.content`, '送信内容');
      }
    } else if (action.type === 'set_metadata') {
      const values = params.values ?? params.data;
      if (!isRecord(values) || Object.keys(values).length === 0) {
        throw new CommonActionValidationError('metadata_values_required', '設定する友だち情報を入力してください', `${field}.values`);
      }
      if (Object.keys(values).some((key) => !key.trim())) {
        throw new CommonActionValidationError('metadata_key_required', '友だち情報の項目名を入力してください', `${field}.values`);
      }
      params.values = values;
      delete params.data;
    } else if (action.type === 'switch_rich_menu') {
      const richMenuId = requiredString(
        params.richMenuPageId ?? params.richMenuId,
        `${field}.richMenuPageId`,
        'リッチメニュー',
      );
      const page = await db.prepare(
        `SELECT p.id
           FROM rich_menu_pages p
           JOIN rich_menu_groups g ON g.id = p.group_id
          WHERE (p.id = ? OR p.line_richmenu_id = ?)
            AND g.account_id = ? AND g.status = 'published'
            AND p.line_richmenu_id IS NOT NULL
          LIMIT 1`,
      ).bind(richMenuId, richMenuId, lineAccountId).first<{ id: string }>();
      if (!page) {
        throw new CommonActionValidationError(
          'resource_not_found',
          '公開済みのリッチメニューが見つからないか、別のLINE公式アカウントにあります',
          `${field}.richMenuPageId`,
        );
      }
      params.richMenuPageId = page.id;
      delete params.richMenuId;
    } else if (action.type === 'wait') {
      const minutes = Number(params.durationMinutes ?? params.minutes);
      if (!Number.isInteger(minutes) || minutes <= 0 || minutes % 5 !== 0 || minutes > 365 * 24 * 60) {
        throw new CommonActionValidationError('wait_minutes_invalid', '待つ時間は5分単位で1年以上にならないよう指定してください', `${field}.minutes`);
      }
      params.durationMinutes = minutes;
      delete params.minutes;
    } else if (action.type === 'common_action') {
      const commonActionId = requiredString(params.commonActionId, `${field}.commonActionId`, '呼び出す共通アクション');
      if (commonActionId === ownerId) {
        throw new CommonActionValidationError('common_action_cycle', '共通アクションは自分自身を呼び出せません', `${field}.commonActionId`);
      }
      const referenced = await db.prepare(
        `SELECT ca.id, ca.current_published_version_id AS version_id
           FROM common_actions ca
           JOIN common_action_versions cav
             ON cav.id = ca.current_published_version_id AND cav.common_action_id = ca.id
            AND cav.status = 'published'
          WHERE ca.id = ? AND ca.line_account_id = ? AND ca.status = 'published'`,
      ).bind(commonActionId, lineAccountId).first<{ id: string; version_id: string }>();
      if (!referenced) {
        throw new CommonActionValidationError('common_action_not_published', '呼び出す共通アクションに公開版がありません', `${field}.commonActionId`);
      }
      params.commonActionId = referenced.id;
      params.commonActionVersionId = referenced.version_id;
    } else if (action.type === 'branch') {
      const condition = params.condition as { rules?: Array<{ type?: unknown; value?: unknown }> };
      for (const [ruleIndex, rule] of (condition.rules ?? []).entries()) {
        if (rule.type === 'tag_exists' || rule.type === 'tag_not_exists') {
          await requireResource(db, {
            table: 'tags', id: rule.value, lineAccountId,
            field: `${field}.condition.rules.${ruleIndex}.value`, label: '分岐条件のタグ',
          });
        }
      }
      params.then = await pinAndValidateReferences(
        db, lineAccountId, ownerId, params.then as ActionDefinition[],
      );
      params.else = await pinAndValidateReferences(
        db, lineAccountId, ownerId, params.else as ActionDefinition[],
      );
    }
    pinned.push({ ...action, params });
  }
  await assertNoCycle(db, lineAccountId, ownerId, pinned);
  return pinned;
}

async function assertNoCycle(
  db: D1Database,
  lineAccountId: string,
  ownerId: string,
  ownerActions: ActionDefinition[],
): Promise<void> {
  const rows = await db.prepare(
    `SELECT ca.id, cav.action_config
       FROM common_actions ca
       JOIN common_action_versions cav
         ON cav.id = ca.current_published_version_id AND cav.common_action_id = ca.id
        AND cav.status = 'published'
      WHERE ca.line_account_id = ? AND ca.status = 'published'`,
  ).bind(lineAccountId).all<{ id: string; action_config: string }>();
  const graph = new Map<string, string[]>();
  for (const row of rows.results ?? []) {
    const calls = parseStoredActions(row.action_config)
      .filter((action) => action.type === 'common_action')
      .map((action) => action.params.commonActionId)
      .filter((id): id is string => typeof id === 'string' && !!id);
    graph.set(row.id, calls);
  }
  graph.set(ownerId, ownerActions
    .filter((action) => action.type === 'common_action')
    .map((action) => action.params.commonActionId)
    .filter((id): id is string => typeof id === 'string' && !!id));

  const visiting = new Set<string>();
  const visited = new Set<string>();
  const walk = (id: string): boolean => {
    if (visiting.has(id)) return true;
    if (visited.has(id)) return false;
    visiting.add(id);
    for (const next of graph.get(id) ?? []) {
      if (walk(next)) return true;
    }
    visiting.delete(id);
    visited.add(id);
    return false;
  };
  if (walk(ownerId)) {
    throw new CommonActionValidationError('common_action_cycle', '共通アクションの呼び出しを循環させることはできません', 'actions');
  }
}

export async function listCommonActions(
  db: D1Database,
  input: { lineAccountId: string; status?: string; query?: string; limit?: number; offset?: number },
): Promise<{ items: CommonActionSummary[]; total: number }> {
  const where = [`ca.line_account_id = ?`];
  const binds: unknown[] = [input.lineAccountId];
  if (input.status && input.status !== 'all') {
    if (!['draft', 'published', 'archived', 'old_version', 'unused'].includes(input.status)) {
      throw new CommonActionValidationError('status_invalid', '絞り込み条件が正しくありません', 'status');
    }
    if (input.status === 'old_version') {
      where.push(`EXISTS (SELECT 1 FROM common_action_bindings ob WHERE ob.common_action_id = ca.id AND ob.common_action_version_id <> ca.current_published_version_id)`);
    } else if (input.status === 'unused') {
      where.push(`NOT EXISTS (SELECT 1 FROM common_action_bindings ub WHERE ub.common_action_id = ca.id)`);
    } else {
      where.push(`ca.status = ?`);
      binds.push(input.status);
    }
  }
  if (input.query?.trim()) {
    where.push(`(ca.name LIKE ? ESCAPE '\\' OR COALESCE(ca.description, '') LIKE ? ESCAPE '\\')`);
    const escaped = input.query.trim().replace(/[\\%_]/g, '\\$&');
    binds.push(`%${escaped}%`, `%${escaped}%`);
  }
  const total = await db.prepare(
    `SELECT COUNT(*) AS count FROM common_actions ca WHERE ${where.join(' AND ')}`,
  ).bind(...binds).first<{ count: number }>();
  const paginationSql = input.limit === undefined ? '' : ' LIMIT ? OFFSET ?';
  const paginationBinds = input.limit === undefined ? [] : [input.limit, input.offset ?? 0];
  const rows = await db.prepare(
    `SELECT ca.id, ca.name, ca.description, ca.status, ca.updated_at,
            dv.version_number AS draft_version, pv.version_number AS published_version,
            COALESCE(json_array_length(COALESCE(dv.action_config, pv.action_config, '[]')), 0) AS action_count,
            COUNT(DISTINCT b.id) AS binding_count,
            COUNT(DISTINCT CASE
              WHEN ca.current_published_version_id IS NOT NULL
               AND b.common_action_version_id <> ca.current_published_version_id THEN b.id END) AS old_binding_count
            ,(SELECT COUNT(DISTINCT r.id)
                FROM automation_run_steps marker
                JOIN automation_runs r ON r.id = marker.automation_run_id
                JOIN common_action_versions metric_version
                  ON metric_version.id = marker.common_action_version_id
               WHERE metric_version.common_action_id = ca.id
                 AND marker.action_type = 'common_action_marker'
                 AND r.is_test = 0
                 AND r.line_account_id = ca.line_account_id
                 AND strftime('%Y-%m', r.created_at) = strftime('%Y-%m', 'now')) AS execution_count_this_month
            ,(SELECT COUNT(DISTINCT r.id)
                FROM automation_run_steps marker
                JOIN automation_runs r ON r.id = marker.automation_run_id
                JOIN common_action_versions metric_version
                  ON metric_version.id = marker.common_action_version_id
               WHERE metric_version.common_action_id = ca.id
                 AND marker.action_type = 'common_action_marker'
                 AND r.is_test = 0
                 AND r.line_account_id = ca.line_account_id
                 AND EXISTS (
                   SELECT 1 FROM automation_run_steps failed_step
                    WHERE failed_step.automation_run_id = r.id
                      AND failed_step.status = 'failed'
                      AND substr(failed_step.step_key, 1, length(marker.step_key) + 1)
                          = marker.step_key || '/'
                 )
                 AND strftime('%Y-%m', r.created_at) = strftime('%Y-%m', 'now')) AS failure_count_this_month
            ,(SELECT MAX(r.created_at)
                FROM automation_run_steps marker
                JOIN automation_runs r ON r.id = marker.automation_run_id
                JOIN common_action_versions metric_version
                  ON metric_version.id = marker.common_action_version_id
               WHERE metric_version.common_action_id = ca.id
                 AND marker.action_type = 'common_action_marker'
                 AND r.is_test = 0
                 AND r.line_account_id = ca.line_account_id) AS last_run_at
       FROM common_actions ca
       LEFT JOIN common_action_versions dv ON dv.id = ca.current_draft_version_id
       LEFT JOIN common_action_versions pv ON pv.id = ca.current_published_version_id
       LEFT JOIN common_action_bindings b ON b.common_action_id = ca.id
      WHERE ${where.join(' AND ')}
      GROUP BY ca.id
      ORDER BY ca.updated_at DESC, ca.id DESC${paginationSql}`,
  ).bind(...binds, ...paginationBinds).all<{
    id: string; name: string; description: string | null; status: CommonActionSummary['status'];
    updated_at: string; draft_version: number | null; published_version: number | null;
    action_count: number; binding_count: number; old_binding_count: number;
    execution_count_this_month: number; failure_count_this_month: number;
    last_run_at: string | null;
  }>();
  return { items: (rows.results ?? []).map((row) => ({
    id: row.id,
    name: row.name,
    description: row.description,
    status: row.status,
    draftVersion: row.draft_version,
    publishedVersion: row.published_version,
    actionCount: Number(row.action_count),
    bindingCount: Number(row.binding_count),
    oldVersionBindingCount: Number(row.old_binding_count),
    executionCountThisMonth: Number(row.execution_count_this_month),
    failureCountThisMonth: Number(row.failure_count_this_month),
    lastRunAt: row.last_run_at,
    updatedAt: row.updated_at,
  })), total: Number(total?.count ?? 0) };
}

/**
 * 一覧の札・KPIに使う集計だけを返す（#554 点検#519中2）。
 *
 * 画面は件数表示のために全件取得をもう1回投げていたが、行単価の高い
 * 月次集計サブクエリ4本が行ごとに走るため、表示1回で2倍走っていた。
 * 集計はページ送り・絞り込みに依らずアカウント全体で数える。
 * 行ごとの内訳式は `listCommonActions` と同じにし、画面の合計と一致させる。
 */
export async function getCommonActionsSummary(
  db: D1Database,
  lineAccountId: string,
): Promise<{
  total: number;
  published: number;
  draft: number;
  oldVersion: number;
  unused: number;
  actions: number;
  bindings: number;
  outdated: number;
  outdatedItems: number;
  executions: number;
  failures: number;
}> {
  const row = await db.prepare(
    `SELECT COUNT(*) AS total,
            SUM(CASE WHEN status = 'published' THEN 1 ELSE 0 END) AS published,
            SUM(CASE WHEN status = 'draft' THEN 1 ELSE 0 END) AS draft,
            SUM(CASE WHEN old_binding_count > 0 THEN 1 ELSE 0 END) AS old_version,
            SUM(CASE WHEN status = 'published' AND binding_count = 0 THEN 1 ELSE 0 END) AS unused,
            SUM(action_count) AS actions,
            SUM(binding_count) AS bindings,
            SUM(old_binding_count) AS outdated,
            SUM(CASE WHEN old_binding_count > 0 THEN 1 ELSE 0 END) AS outdated_items,
            SUM(execution_count_this_month) AS executions,
            SUM(failure_count_this_month) AS failures
       FROM (SELECT ca.status AS status,
                    COALESCE(json_array_length(COALESCE(dv.action_config, pv.action_config, '[]')), 0) AS action_count,
                    COUNT(DISTINCT b.id) AS binding_count,
                    COUNT(DISTINCT CASE
                      WHEN ca.current_published_version_id IS NOT NULL
                       AND b.common_action_version_id <> ca.current_published_version_id THEN b.id END) AS old_binding_count
                    ,(SELECT COUNT(DISTINCT r.id)
                        FROM automation_run_steps marker
                        JOIN automation_runs r ON r.id = marker.automation_run_id
                        JOIN common_action_versions metric_version
                          ON metric_version.id = marker.common_action_version_id
                       WHERE metric_version.common_action_id = ca.id
                         AND marker.action_type = 'common_action_marker'
                         AND r.is_test = 0
                         AND r.line_account_id = ca.line_account_id
                         AND strftime('%Y-%m', r.created_at) = strftime('%Y-%m', 'now')) AS execution_count_this_month
                    ,(SELECT COUNT(DISTINCT r.id)
                        FROM automation_run_steps marker
                        JOIN automation_runs r ON r.id = marker.automation_run_id
                        JOIN common_action_versions metric_version
                          ON metric_version.id = marker.common_action_version_id
                       WHERE metric_version.common_action_id = ca.id
                         AND marker.action_type = 'common_action_marker'
                         AND r.is_test = 0
                         AND r.line_account_id = ca.line_account_id
                         AND EXISTS (
                           SELECT 1 FROM automation_run_steps failed_step
                            WHERE failed_step.automation_run_id = r.id
                              AND failed_step.status = 'failed'
                              AND substr(failed_step.step_key, 1, length(marker.step_key) + 1)
                                  = marker.step_key || '/'
                         )
                         AND strftime('%Y-%m', r.created_at) = strftime('%Y-%m', 'now')) AS failure_count_this_month
               FROM common_actions ca
               LEFT JOIN common_action_versions dv ON dv.id = ca.current_draft_version_id
               LEFT JOIN common_action_versions pv ON pv.id = ca.current_published_version_id
               LEFT JOIN common_action_bindings b ON b.common_action_id = ca.id
              WHERE ca.line_account_id = ?
              GROUP BY ca.id)`,
  ).bind(lineAccountId).first<{
    total: number; published: number | null; draft: number | null; old_version: number | null;
    unused: number | null; actions: number | null; bindings: number | null; outdated: number | null;
    outdated_items: number | null; executions: number | null; failures: number | null;
  }>();
  return {
    total: Number(row?.total ?? 0),
    published: Number(row?.published ?? 0),
    draft: Number(row?.draft ?? 0),
    oldVersion: Number(row?.old_version ?? 0),
    unused: Number(row?.unused ?? 0),
    actions: Number(row?.actions ?? 0),
    bindings: Number(row?.bindings ?? 0),
    outdated: Number(row?.outdated ?? 0),
    outdatedItems: Number(row?.outdated_items ?? 0),
    executions: Number(row?.executions ?? 0),
    failures: Number(row?.failures ?? 0),
  };
}

export async function listCommonActionResources(
  db: D1Database,
  input: {
    lineAccountId: string;
    excludeCommonActionId?: string;
    trigger?: 'tag.added';
  },
): Promise<CommonActionResources> {
  const [
    tags,
    scenarios,
    templates,
    supportMarks,
    reminders,
    notificationRules,
    webhooks,
    richMenus,
    commonActionRows,
  ] = await Promise.all([
    db.prepare(
      `SELECT id, name FROM tags WHERE line_account_id = ? ORDER BY name ASC`,
    ).bind(input.lineAccountId).all<{ id: string; name: string }>(),
    db.prepare(
      `SELECT id, name FROM scenarios WHERE line_account_id = ? AND is_active = 1 ORDER BY name ASC`,
    ).bind(input.lineAccountId).all<{ id: string; name: string }>(),
    db.prepare(
      `SELECT id, name FROM templates WHERE line_account_id = ? ORDER BY name ASC`,
    ).bind(input.lineAccountId).all<{ id: string; name: string }>(),
    db.prepare(
      `SELECT sm.id, sm.name
         FROM support_marks sm
         JOIN support_mark_scopes sms ON sms.mark_id = sm.id
         JOIN line_accounts la ON la.id = ? AND la.tenant_id = sms.tenant_id
        WHERE sm.archived_at IS NULL
          AND (sms.line_account_id IS NULL OR sms.line_account_id = ?)
        ORDER BY sm.display_order ASC, sm.name ASC`,
    ).bind(input.lineAccountId, input.lineAccountId).all<{ id: string; name: string }>(),
    db.prepare(
      `SELECT id, name FROM reminders
        WHERE line_account_id = ? AND deleted_at IS NULL
          AND lifecycle_status <> 'stopped'
        ORDER BY display_order ASC, name ASC`,
    ).bind(input.lineAccountId).all<{ id: string; name: string }>(),
    db.prepare(
      `SELECT id, name FROM notification_rules
        WHERE line_account_id = ? AND is_active = 1
        ORDER BY name ASC`,
    ).bind(input.lineAccountId).all<{ id: string; name: string }>(),
    db.prepare(
      `SELECT id, name FROM outgoing_webhooks
        WHERE line_account_id = ? AND is_active = 1 ORDER BY name ASC`,
    ).bind(input.lineAccountId).all<{ id: string; name: string }>(),
    db.prepare(
      `SELECT p.id, g.name || ' / ' || p.name AS name
         FROM rich_menu_pages p
         JOIN rich_menu_groups g ON g.id = p.group_id
        WHERE g.account_id = ? AND g.status = 'published'
          AND p.line_richmenu_id IS NOT NULL
        ORDER BY g.name ASC, p.order_index ASC`,
    ).bind(input.lineAccountId).all<{ id: string; name: string }>(),
    db.prepare(
      `SELECT ca.id, ca.name, cav.version_number AS version
         FROM common_actions ca
         JOIN common_action_versions cav
           ON cav.id = ca.current_published_version_id AND cav.common_action_id = ca.id
          AND cav.status = 'published'
        WHERE ca.line_account_id = ? AND ca.status = 'published'
          AND (? = '' OR ca.id <> ?)
        ORDER BY ca.name ASC`,
    ).bind(
      input.lineAccountId,
      input.excludeCommonActionId ?? '',
      input.excludeCommonActionId ?? '',
    ).all<{ id: string; name: string; version: number }>(),
  ]);
  const objectSchema = (
    required: string[],
    properties: Record<string, Record<string, unknown>>,
  ) => ({ type: 'object' as const, required, properties });
  const commonTiming = {
    delayMinutes: { type: 'integer', minimum: 0, maximum: 525600, multipleOf: 5 },
    cancelIfTagRemoved: { type: 'boolean', default: true },
  };
  const actionTypes: CommonActionResources['actionTypes'] = input.trigger === 'tag.added' ? [
    { id: 'send_text', label: 'テキスト送信', actionType: 'send_message', variant: 'text', state: 'available', reason: null, schema: objectSchema(['content'], { content: { type: 'string', minLength: 1 }, ...commonTiming }) },
    { id: 'send_template', label: 'テンプレート送信', actionType: 'send_message', variant: 'template', resource: 'templates', state: 'available', reason: null, schema: objectSchema(['templateId'], { templateId: { type: 'string' }, ...commonTiming }) },
    { id: 'add_tag', label: 'タグ追加', actionType: 'add_tag', resource: 'tags', state: 'available', reason: null, schema: objectSchema(['tagId'], { tagId: { type: 'string' }, ...commonTiming }) },
    { id: 'remove_tag', label: 'タグ解除', actionType: 'remove_tag', resource: 'tags', state: 'available', reason: null, schema: objectSchema(['tagId'], { tagId: { type: 'string' }, ...commonTiming }) },
    { id: 'set_metadata', label: '友だち情報更新', actionType: 'set_metadata', resource: 'friendFields', state: 'unavailable', reason: 'friend_field_scope_pending', schema: objectSchema(['fieldId', 'value'], { fieldId: { type: 'string' }, value: {}, ...commonTiming }) },
    { id: 'set_support_mark', label: '対応マーク変更', actionType: 'set_support_mark', resource: 'supportMarks', state: 'available', reason: null, schema: objectSchema(['markId'], { markId: { type: 'string' }, ...commonTiming }) },
    { id: 'start_scenario', label: 'シナリオ開始', actionType: 'start_scenario', resource: 'scenarios', state: 'available', reason: null, schema: objectSchema(['scenarioId'], { scenarioId: { type: 'string' }, ...commonTiming }) },
    { id: 'stop_scenario', label: 'シナリオ停止', actionType: 'stop_scenario', resource: 'scenarios', state: 'available', reason: null, schema: objectSchema(['scenarioId'], { scenarioId: { type: 'string' }, ...commonTiming }) },
    { id: 'start_reminder', label: 'リマインダ開始', actionType: 'start_reminder', resource: 'reminders', state: 'available', reason: null, schema: objectSchema(['reminderId'], { reminderId: { type: 'string' }, ...commonTiming }) },
    { id: 'stop_reminder', label: 'リマインダ解除', actionType: 'stop_reminder', resource: 'reminders', state: 'available', reason: null, schema: objectSchema(['reminderId'], { reminderId: { type: 'string' }, ...commonTiming }) },
    { id: 'switch_rich_menu', label: 'リッチメニュー切替', actionType: 'switch_rich_menu', resource: 'richMenus', state: 'available', reason: null, schema: objectSchema(['richMenuPageId'], { richMenuPageId: { type: 'string' }, ...commonTiming }) },
    { id: 'notify_staff', label: '担当者通知', actionType: 'notify_staff', resource: 'notificationRules', state: 'available', reason: null, schema: objectSchema(['notificationRuleId', 'message'], { notificationRuleId: { type: 'string' }, message: { type: 'string', minLength: 1 }, ...commonTiming }) },
    { id: 'grant_mileage', label: 'マイル付与', actionType: 'grant_mileage', state: 'available', reason: null, schema: objectSchema(['amount'], { amount: { type: 'integer', minimum: 1, maximum: 1000000 }, ...commonTiming }) },
  ] : [];
  return {
    trigger: input.trigger ?? null,
    actionTypes,
    tags: tags.results ?? [],
    scenarios: scenarios.results ?? [],
    templates: templates.results ?? [],
    // #318 が項目定義へアカウント範囲を追加するまで、別統括の項目を混ぜない。
    friendFields: [],
    supportMarks: supportMarks.results ?? [],
    reminders: reminders.results ?? [],
    notificationRules: notificationRules.results ?? [],
    webhooks: webhooks.results ?? [],
    richMenus: richMenus.results ?? [],
    commonActions: commonActionRows.results ?? [],
  };
}

export async function createCommonAction(
  db: D1Database,
  input: { lineAccountId: string; name: unknown; description?: unknown; actions: unknown; createdBy?: string | null },
): Promise<{ id: string; draftVersionId: string; versionNumber: number }> {
  const name = requiredString(input.name, 'name', '共通アクション名');
  if (name.length > 120) throw new CommonActionValidationError('name_too_long', '共通アクション名は120文字までです', 'name');
  const description = typeof input.description === 'string' && input.description.trim()
    ? input.description.trim()
    : null;
  const actions = validateActionShape(input.actions);
  const id = crypto.randomUUID();
  const versionId = crypto.randomUUID();
  const now = new Date().toISOString();
  await db.batch([
    db.prepare(
      `INSERT INTO common_actions
         (id, line_account_id, name, description, status, created_by, created_at, updated_at)
       VALUES (?, ?, ?, ?, 'draft', ?, ?, ?)`,
    ).bind(id, input.lineAccountId, name, description, input.createdBy ?? null, now, now),
    db.prepare(
      `INSERT INTO common_action_versions
         (id, common_action_id, version_number, status, action_config, created_by, created_at)
       VALUES (?, ?, 1, 'draft', ?, ?, ?)`,
    ).bind(versionId, id, JSON.stringify(actions), input.createdBy ?? null, now),
    db.prepare(
      `UPDATE common_actions SET current_draft_version_id = ? WHERE id = ?`,
    ).bind(versionId, id),
  ]);
  return { id, draftVersionId: versionId, versionNumber: 1 };
}

async function getOwnedAction(db: D1Database, id: string, lineAccountId: string): Promise<CommonActionRow | null> {
  return db.prepare(
    `SELECT id, line_account_id, name, description, status, current_draft_version_id,
            current_published_version_id, created_at, updated_at
       FROM common_actions WHERE id = ? AND line_account_id = ?`,
  ).bind(id, lineAccountId).first<CommonActionRow>();
}

export async function duplicateCommonAction(
  db: D1Database,
  input: { id: string; lineAccountId: string; createdBy?: string | null },
): Promise<{ id: string; draftVersionId: string; versionNumber: number }> {
  const owner = await getOwnedAction(db, input.id, input.lineAccountId);
  if (!owner) throw new CommonActionValidationError('not_found', '複製する共通アクションが見つかりません');
  const sourceId = owner.current_draft_version_id ?? owner.current_published_version_id;
  if (!sourceId) throw new CommonActionValidationError('source_version_not_found', '複製する内容が見つかりません');
  const source = await db.prepare(
    `SELECT action_config FROM common_action_versions
      WHERE id = ? AND common_action_id = ?`,
  ).bind(sourceId, owner.id).first<{ action_config: string }>();
  if (!source) throw new CommonActionValidationError('source_version_not_found', '複製する内容が見つかりません');
  return createCommonAction(db, {
    lineAccountId: input.lineAccountId,
    name: `${owner.name.slice(0, 114)} のコピー`,
    description: owner.description,
    actions: parseStoredActions(source.action_config),
    createdBy: input.createdBy,
  });
}

export async function updateCommonActionDraft(
  db: D1Database,
  input: {
    id: string; lineAccountId: string; expectedDraftVersionId: unknown;
    name: unknown; description?: unknown; actions: unknown;
  },
): Promise<void> {
  const owner = await getOwnedAction(db, input.id, input.lineAccountId);
  if (!owner) throw new CommonActionValidationError('not_found', '共通アクションが見つかりません');
  const expected = requiredString(input.expectedDraftVersionId, 'expectedDraftVersionId', '編集中の版');
  if (!owner.current_draft_version_id || owner.current_draft_version_id !== expected) {
    throw new CommonActionValidationError('version_conflict', '別の人が新版を作りました。再読み込みしてください');
  }
  const name = requiredString(input.name, 'name', '共通アクション名');
  const description = typeof input.description === 'string' && input.description.trim()
    ? input.description.trim()
    : null;
  const actions = validateActionShape(input.actions);
  const now = new Date().toISOString();
  const result = await db.batch([
    db.prepare(
      `UPDATE common_action_versions SET action_config = ?
        WHERE id = ? AND common_action_id = ? AND status = 'draft'`,
    ).bind(JSON.stringify(actions), expected, owner.id),
    db.prepare(
      `UPDATE common_actions SET name = ?, description = ?, updated_at = ?
        WHERE id = ? AND line_account_id = ? AND current_draft_version_id = ?`,
    ).bind(name, description, now, owner.id, input.lineAccountId, expected),
  ]);
  if ((result[0].meta?.changes ?? 0) !== 1 || (result[1].meta?.changes ?? 0) !== 1) {
    throw new CommonActionValidationError('version_conflict', '編集中の版が変わりました。再読み込みしてください');
  }
}

export async function createCommonActionDraft(
  db: D1Database,
  input: { id: string; lineAccountId: string; fromVersionId?: unknown; createdBy?: string | null },
): Promise<{ draftVersionId: string; versionNumber: number }> {
  const owner = await getOwnedAction(db, input.id, input.lineAccountId);
  if (!owner) throw new CommonActionValidationError('not_found', '共通アクションが見つかりません');
  if (owner.current_draft_version_id) {
    throw new CommonActionValidationError('draft_exists', '編集中の下書きがすでにあります');
  }
  const fromVersionId = typeof input.fromVersionId === 'string' && input.fromVersionId
    ? input.fromVersionId
    : owner.current_published_version_id;
  if (!fromVersionId) throw new CommonActionValidationError('base_version_required', 'もとにする公開版がありません');
  const base = await db.prepare(
    `SELECT id, action_config FROM common_action_versions
      WHERE id = ? AND common_action_id = ? AND status = 'published'`,
  ).bind(fromVersionId, owner.id).first<{ id: string; action_config: string }>();
  if (!base) throw new CommonActionValidationError('base_version_not_found', 'もとにする公開版が見つかりません');
  const max = await db.prepare(
    `SELECT COALESCE(MAX(version_number), 0) AS value FROM common_action_versions WHERE common_action_id = ?`,
  ).bind(owner.id).first<{ value: number }>();
  const versionNumber = Number(max?.value ?? 0) + 1;
  const versionId = crypto.randomUUID();
  const now = new Date().toISOString();
  const result = await db.batch([
    db.prepare(
      `INSERT INTO common_action_versions
         (id, common_action_id, version_number, status, action_config, created_by, created_at)
       SELECT ?, ca.id, ?, 'draft', ?, ?, ?
         FROM common_actions ca
        WHERE ca.id = ? AND ca.line_account_id = ? AND ca.current_draft_version_id IS NULL`,
    ).bind(
      versionId, versionNumber, base.action_config, input.createdBy ?? null, now,
      owner.id, input.lineAccountId,
    ),
    db.prepare(
      `UPDATE common_actions SET current_draft_version_id = ?, updated_at = ?
        WHERE id = ? AND line_account_id = ? AND current_draft_version_id IS NULL`,
    ).bind(versionId, now, owner.id, input.lineAccountId),
  ]);
  if ((result[0].meta?.changes ?? 0) !== 1 || (result[1].meta?.changes ?? 0) !== 1) {
    throw new CommonActionValidationError('draft_exists', '編集中の下書きがすでにあります');
  }
  return { draftVersionId: versionId, versionNumber };
}

export async function publishCommonActionDraft(
  db: D1Database,
  input: { id: string; lineAccountId: string; draftVersionId: unknown },
): Promise<{ versionId: string; versionNumber: number }> {
  const owner = await getOwnedAction(db, input.id, input.lineAccountId);
  if (!owner) throw new CommonActionValidationError('not_found', '共通アクションが見つかりません');
  const draftVersionId = requiredString(input.draftVersionId, 'draftVersionId', '公開する版');
  if (owner.current_draft_version_id !== draftVersionId) {
    throw new CommonActionValidationError('version_conflict', '公開対象の下書きが変わりました。再読み込みしてください');
  }
  const draft = await db.prepare(
    `SELECT id, common_action_id, version_number, status, action_config, created_by, created_at, published_at
       FROM common_action_versions
      WHERE id = ? AND common_action_id = ? AND status = 'draft'`,
  ).bind(draftVersionId, owner.id).first<VersionRow>();
  if (!draft) throw new CommonActionValidationError('draft_not_found', '公開する下書きが見つかりません');
  const actions = validateActionShape(JSON.parse(draft.action_config));
  const pinned = await pinAndValidateReferences(db, input.lineAccountId, owner.id, actions);
  const now = new Date().toISOString();
  const result = await db.batch([
    db.prepare(
      `UPDATE common_action_versions
          SET status = 'published', action_config = ?, published_at = ?
        WHERE id = ? AND common_action_id = ? AND status = 'draft'`,
    ).bind(JSON.stringify(pinned), now, draft.id, owner.id),
    db.prepare(
      `UPDATE common_actions
          SET status = 'published', current_draft_version_id = NULL,
              current_published_version_id = ?, updated_at = ?
        WHERE id = ? AND line_account_id = ? AND current_draft_version_id = ?`,
    ).bind(draft.id, now, owner.id, input.lineAccountId, draft.id),
  ]);
  if ((result[0].meta?.changes ?? 0) !== 1 || (result[1].meta?.changes ?? 0) !== 1) {
    throw new CommonActionValidationError('version_conflict', '公開直前に版が変わりました。再読み込みしてください');
  }
  return { versionId: draft.id, versionNumber: draft.version_number };
}

export async function getCommonActionDetail(
  db: D1Database,
  input: { id: string; lineAccountId: string },
): Promise<{
  id: string; name: string; description: string | null; status: CommonActionRow['status'];
  currentDraftVersionId: string | null; currentPublishedVersionId: string | null;
  versions: CommonActionVersion[]; bindings: CommonActionBinding[];
}> {
  const owner = await getOwnedAction(db, input.id, input.lineAccountId);
  if (!owner) throw new CommonActionValidationError('not_found', '共通アクションが見つかりません');
  const [versionsResult, bindingsResult] = await Promise.all([
    db.prepare(
      `SELECT id, common_action_id, version_number, status, action_config,
              created_by, created_at, published_at
         FROM common_action_versions WHERE common_action_id = ?
        ORDER BY version_number DESC`,
    ).bind(owner.id).all<VersionRow>(),
    db.prepare(
      `SELECT b.id, b.consumer_type, b.consumer_id, b.consumer_path,
              b.common_action_version_id, b.updated_at, v.version_number,
              pv.version_number AS latest_version_number,
              CASE WHEN b.consumer_type = 'automation' THEN (
                SELECT COUNT(DISTINCT r.id) FROM automation_runs r
                JOIN automation_run_steps s ON s.automation_run_id = r.id
                WHERE r.automation_id = b.consumer_id
                  AND s.common_action_version_id = b.common_action_version_id
                  AND r.status = 'running'
              ) END AS running_count,
              CASE WHEN b.consumer_type = 'automation' THEN (
                SELECT COUNT(DISTINCT r.id) FROM automation_runs r
                JOIN automation_run_steps s ON s.automation_run_id = r.id
                WHERE r.automation_id = b.consumer_id
                  AND s.common_action_version_id = b.common_action_version_id
                  AND r.status = 'waiting'
              ) END AS waiting_count
         FROM common_action_bindings b
         JOIN common_action_versions v ON v.id = b.common_action_version_id
         LEFT JOIN common_action_versions pv ON pv.id = ?
        WHERE b.common_action_id = ? AND b.line_account_id = ?
        ORDER BY b.updated_at DESC`,
    ).bind(owner.current_published_version_id, owner.id, input.lineAccountId).all<{
      id: string; consumer_type: string; consumer_id: string; consumer_path: string;
      common_action_version_id: string; updated_at: string; version_number: number;
      latest_version_number: number | null; running_count: number | null; waiting_count: number | null;
    }>(),
  ]);
  const versions = (versionsResult.results ?? []).map((row) => ({
    id: row.id,
    versionNumber: row.version_number,
    status: row.status,
    actions: parseStoredActions(row.action_config),
    createdBy: row.created_by,
    createdAt: row.created_at,
    publishedAt: row.published_at,
  }));
  const bindings = (bindingsResult.results ?? []).map((row) => ({
    id: row.id,
    consumerType: row.consumer_type,
    consumerId: row.consumer_id,
    consumerPath: row.consumer_path,
    versionId: row.common_action_version_id,
    versionNumber: row.version_number,
    latestVersionNumber: row.latest_version_number,
    hasNewerVersion: row.latest_version_number !== null && row.latest_version_number > row.version_number,
    runningCount: row.running_count === null ? null : Number(row.running_count),
    waitingCount: row.waiting_count === null ? null : Number(row.waiting_count),
    updatedAt: row.updated_at,
  }));
  return {
    id: owner.id,
    name: owner.name,
    description: owner.description,
    status: owner.status,
    currentDraftVersionId: owner.current_draft_version_id,
    currentPublishedVersionId: owner.current_published_version_id,
    versions,
    bindings,
  };
}

export async function updateCommonActionBindingVersion(
  db: D1Database,
  input: {
    id: string;
    bindingId: string;
    lineAccountId: string;
    versionId: unknown;
    expectedVersionId: unknown;
    actorId?: string | null;
  },
): Promise<void> {
  const versionId = requiredString(input.versionId, 'versionId', '切り替える版');
  const expectedVersionId = requiredString(
    input.expectedVersionId, 'expectedVersionId', '現在利用中の版',
  );
  const version = await db.prepare(
    `SELECT cav.id
       FROM common_action_versions cav
       JOIN common_actions ca ON ca.id = cav.common_action_id
      WHERE cav.id = ? AND cav.common_action_id = ? AND cav.status = 'published'
        AND ca.line_account_id = ?`,
  ).bind(versionId, input.id, input.lineAccountId).first<{ id: string }>();
  if (!version) throw new CommonActionValidationError('version_not_found', '切り替える公開版が見つかりません', 'versionId');
  const now = new Date().toISOString();
  const eventId = crypto.randomUUID();
  const results = await db.batch([
    db.prepare(
      `INSERT INTO common_action_binding_migration_events
         (id, line_account_id, common_action_id, binding_id,
          from_action_version_id, to_action_version_id, actor_id, created_at)
       SELECT ?, line_account_id, common_action_id, id,
              common_action_version_id, ?, ?, ?
         FROM common_action_bindings
        WHERE id = ? AND common_action_id = ? AND line_account_id = ?
          AND common_action_version_id = ?`,
    ).bind(
      eventId, version.id, input.actorId ?? null, now,
      input.bindingId, input.id, input.lineAccountId, expectedVersionId,
    ),
    db.prepare(
      `UPDATE common_action_bindings SET common_action_version_id = ?, updated_at = ?
        WHERE id = ? AND common_action_id = ? AND line_account_id = ?
          AND common_action_version_id = ?`,
    ).bind(
      version.id, now, input.bindingId, input.id, input.lineAccountId, expectedVersionId,
    ),
  ]);
  if ((results[0].meta?.changes ?? 0) !== 1 || (results[1].meta?.changes ?? 0) !== 1) {
    const binding = await db.prepare(
      `SELECT id FROM common_action_bindings
        WHERE id = ? AND common_action_id = ? AND line_account_id = ?`,
    ).bind(input.bindingId, input.id, input.lineAccountId).first<{ id: string }>();
    if (!binding) throw new CommonActionValidationError('binding_not_found', '利用先が見つかりません');
    throw new CommonActionValidationError('version_conflict', '利用先の固定版が変わりました。再読み込みしてください');
  }
}
