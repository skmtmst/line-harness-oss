import type { ActionDefinition } from './automation-engine.js';

const SUPPORTED_ACTION_TYPES = new Set([
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
  'wait',
  'common_action',
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
  tags: Array<{ id: string; name: string }>;
  scenarios: Array<{ id: string; name: string }>;
  templates: Array<{ id: string; name: string }>;
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

export function validateActionShape(value: unknown): ActionDefinition[] {
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
    return { id, type, params: item.params, onFailure };
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
  input: { lineAccountId: string; status?: string; query?: string },
): Promise<CommonActionSummary[]> {
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
  const rows = await db.prepare(
    `SELECT ca.id, ca.name, ca.description, ca.status, ca.updated_at,
            dv.version_number AS draft_version, pv.version_number AS published_version,
            COALESCE(json_array_length(COALESCE(dv.action_config, pv.action_config, '[]')), 0) AS action_count,
            COUNT(DISTINCT b.id) AS binding_count,
            COUNT(DISTINCT CASE
              WHEN ca.current_published_version_id IS NOT NULL
               AND b.common_action_version_id <> ca.current_published_version_id THEN b.id END) AS old_binding_count
       FROM common_actions ca
       LEFT JOIN common_action_versions dv ON dv.id = ca.current_draft_version_id
       LEFT JOIN common_action_versions pv ON pv.id = ca.current_published_version_id
       LEFT JOIN common_action_bindings b ON b.common_action_id = ca.id
      WHERE ${where.join(' AND ')}
      GROUP BY ca.id
      ORDER BY ca.updated_at DESC, ca.id DESC`,
  ).bind(...binds).all<{
    id: string; name: string; description: string | null; status: CommonActionSummary['status'];
    updated_at: string; draft_version: number | null; published_version: number | null;
    action_count: number; binding_count: number; old_binding_count: number;
  }>();
  return (rows.results ?? []).map((row) => ({
    id: row.id,
    name: row.name,
    description: row.description,
    status: row.status,
    draftVersion: row.draft_version,
    publishedVersion: row.published_version,
    actionCount: Number(row.action_count),
    bindingCount: Number(row.binding_count),
    oldVersionBindingCount: Number(row.old_binding_count),
    updatedAt: row.updated_at,
  }));
}

export async function listCommonActionResources(
  db: D1Database,
  input: { lineAccountId: string; excludeCommonActionId?: string },
): Promise<CommonActionResources> {
  const [tags, scenarios, templates, webhooks, richMenus, commonActionRows] = await Promise.all([
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
  return {
    tags: tags.results ?? [],
    scenarios: scenarios.results ?? [],
    templates: templates.results ?? [],
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
  input: { id: string; bindingId: string; lineAccountId: string; versionId: unknown },
): Promise<void> {
  const versionId = requiredString(input.versionId, 'versionId', '切り替える版');
  const version = await db.prepare(
    `SELECT cav.id
       FROM common_action_versions cav
       JOIN common_actions ca ON ca.id = cav.common_action_id
      WHERE cav.id = ? AND cav.common_action_id = ? AND cav.status = 'published'
        AND ca.line_account_id = ?`,
  ).bind(versionId, input.id, input.lineAccountId).first<{ id: string }>();
  if (!version) throw new CommonActionValidationError('version_not_found', '切り替える公開版が見つかりません', 'versionId');
  const result = await db.prepare(
    `UPDATE common_action_bindings SET common_action_version_id = ?, updated_at = ?
      WHERE id = ? AND common_action_id = ? AND line_account_id = ?`,
  ).bind(version.id, new Date().toISOString(), input.bindingId, input.id, input.lineAccountId).run();
  if ((result.meta?.changes ?? 0) !== 1) {
    throw new CommonActionValidationError('binding_not_found', '利用先が見つかりません');
  }
}
