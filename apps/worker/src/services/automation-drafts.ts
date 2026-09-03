export type AutomationDraftActionType = 'add_tag' | 'start_scenario' | 'send_message';

export interface AutomationDraftAction {
  id: string;
  type: AutomationDraftActionType;
  params: Record<string, unknown>;
  onFailure: 'stop';
}

export interface AutomationTemplateSummary {
  key: string;
  name: string;
  description: string;
  triggerLabel: string;
  actionLabel: string;
}

interface AutomationTemplateDefinition extends AutomationTemplateSummary {
  triggerType: 'friend_add' | 'tag_change' | 'message_received';
  triggerConfig: Record<string, unknown>;
  actions: AutomationDraftAction[];
}

export interface AutomationDraftDetail {
  id: string;
  draftVersionId: string;
  name: string;
  description: string | null;
  eventType: AutomationTemplateDefinition['triggerType'];
  triggerConfig: Record<string, unknown>;
  conditions: Record<string, unknown>;
  actions: AutomationDraftAction[];
}

export interface AutomationDraftResources {
  tags: Array<{ id: string; name: string }>;
  scenarios: Array<{ id: string; name: string }>;
}

export class AutomationDraftError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly field?: string,
  ) {
    super(message);
    this.name = 'AutomationDraftError';
  }
}

const TEMPLATES: readonly AutomationTemplateDefinition[] = [
  {
    key: 'welcome-scenario',
    name: '友だち追加のお迎え',
    description: '友だちになった人へ、選んだシナリオを始めます。',
    triggerLabel: '友だちになったとき',
    actionLabel: 'シナリオを始める',
    triggerType: 'friend_add',
    triggerConfig: {},
    actions: [{ id: 'step-1', type: 'start_scenario', params: { scenarioId: '' }, onFailure: 'stop' }],
  },
  {
    key: 'received-message-tag',
    name: '問い合わせを見分ける',
    description: 'メッセージが届いた人へ、選んだタグを付けます。',
    triggerLabel: 'メッセージが届いたとき',
    actionLabel: 'タグを付ける',
    triggerType: 'message_received',
    triggerConfig: {},
    actions: [{ id: 'step-1', type: 'add_tag', params: { tagId: '' }, onFailure: 'stop' }],
  },
  {
    key: 'tag-followup-scenario',
    name: 'タグからフォローを始める',
    description: '選んだタグが付いた人へ、選んだシナリオを始めます。',
    triggerLabel: 'タグが付いたとき',
    actionLabel: 'シナリオを始める',
    triggerType: 'tag_change',
    triggerConfig: { tagId: '', action: 'add' },
    actions: [{ id: 'step-1', type: 'start_scenario', params: { scenarioId: '' }, onFailure: 'stop' }],
  },
] as const;

function template(key: string): AutomationTemplateDefinition {
  const found = TEMPLATES.find((item) => item.key === key);
  if (!found) throw new AutomationDraftError('template_not_found', '選んだ見本は現在使えません');
  return found;
}

function requiredString(value: unknown, field: string, label: string): string {
  if (typeof value !== 'string' || !value.trim()) {
    throw new AutomationDraftError('required', `${label}を選んでください`, field);
  }
  return value.trim();
}

function parseObject(raw: string, label: string): Record<string, unknown> {
  try {
    const value: unknown = JSON.parse(raw);
    if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
      return value as Record<string, unknown>;
    }
  } catch {
    // 下で保存データの不整合として扱う。
  }
  throw new AutomationDraftError('stored_data_invalid', `${label}を読み込めませんでした`);
}

function parseActions(raw: string): AutomationDraftAction[] {
  try {
    const value: unknown = JSON.parse(raw);
    if (Array.isArray(value)) return value as AutomationDraftAction[];
  } catch {
    // 下で保存データの不整合として扱う。
  }
  throw new AutomationDraftError('stored_data_invalid', '下書きの処理を読み込めませんでした');
}

async function requireResource(
  db: D1Database,
  table: 'tags' | 'scenarios',
  id: string,
  lineAccountId: string,
  field: string,
  label: string,
): Promise<void> {
  const activeClause = table === 'scenarios' ? ' AND is_active = 1' : '';
  const row = await db.prepare(
    `SELECT id FROM ${table} WHERE id = ? AND line_account_id = ?${activeClause} LIMIT 1`,
  ).bind(id, lineAccountId).first<{ id: string }>();
  if (!row) throw new AutomationDraftError('resource_not_found', `${label}を選び直してください`, field);
}

export function listAutomationTemplates(): AutomationTemplateSummary[] {
  return TEMPLATES.map(({ key, name, description, triggerLabel, actionLabel }) => ({
    key, name, description, triggerLabel, actionLabel,
  }));
}

export async function listAutomationDraftResources(
  db: D1Database,
  lineAccountId: string,
): Promise<AutomationDraftResources> {
  const [tags, scenarios] = await Promise.all([
    db.prepare(
      'SELECT id, name FROM tags WHERE line_account_id = ? ORDER BY name ASC',
    ).bind(lineAccountId).all<{ id: string; name: string }>(),
    db.prepare(
      `SELECT id, name FROM scenarios
        WHERE line_account_id = ? AND is_active = 1 ORDER BY name ASC`,
    ).bind(lineAccountId).all<{ id: string; name: string }>(),
  ]);
  return { tags: tags.results ?? [], scenarios: scenarios.results ?? [] };
}

export async function createAutomationDraftFromTemplate(
  db: D1Database,
  input: { templateKey: string; lineAccountId: string; createdBy?: string | null },
): Promise<{ id: string; draftVersionId: string }> {
  const source = template(input.templateKey);
  const id = crypto.randomUUID();
  const versionId = crypto.randomUUID();
  const now = new Date().toISOString();
  await db.batch([
    db.prepare(
      `INSERT INTO automation_definitions
         (id, line_account_id, name, description, status, created_by, created_at, updated_at)
       VALUES (?, ?, ?, ?, 'draft', ?, ?, ?)`,
    ).bind(id, input.lineAccountId, source.name, source.description, input.createdBy ?? null, now, now),
    db.prepare(
      `INSERT INTO automation_versions
         (id, automation_id, version_number, status, trigger_type, trigger_config,
          condition_config, action_config, created_by, created_at)
       VALUES (?, ?, 1, 'draft', ?, ?, '{}', ?, ?, ?)`,
    ).bind(
      versionId,
      id,
      source.triggerType,
      JSON.stringify(source.triggerConfig),
      JSON.stringify(source.actions),
      input.createdBy ?? null,
      now,
    ),
    db.prepare(
      'UPDATE automation_definitions SET current_draft_version_id = ? WHERE id = ?',
    ).bind(versionId, id),
  ]);
  return { id, draftVersionId: versionId };
}

export async function getAutomationDraft(
  db: D1Database,
  input: { id: string; lineAccountId: string },
): Promise<AutomationDraftDetail> {
  const row = await db.prepare(
    `SELECT d.id, d.name, d.description, d.current_draft_version_id,
            v.trigger_type, v.trigger_config, v.condition_config, v.action_config
       FROM automation_definitions d
       JOIN automation_versions v
         ON v.id = d.current_draft_version_id
        AND v.automation_id = d.id AND v.status = 'draft'
      WHERE d.id = ? AND d.line_account_id = ? AND d.status = 'draft'`,
  ).bind(input.id, input.lineAccountId).first<{
    id: string;
    name: string;
    description: string | null;
    current_draft_version_id: string;
    trigger_type: AutomationDraftDetail['eventType'];
    trigger_config: string;
    condition_config: string;
    action_config: string;
  }>();
  if (!row) throw new AutomationDraftError('not_found', '編集中の下書きが見つかりません');
  return {
    id: row.id,
    draftVersionId: row.current_draft_version_id,
    name: row.name,
    description: row.description,
    eventType: row.trigger_type,
    triggerConfig: parseObject(row.trigger_config, '下書きのきっかけ'),
    conditions: parseObject(row.condition_config, '下書きの条件'),
    actions: parseActions(row.action_config),
  };
}

export async function updateAutomationDraft(
  db: D1Database,
  input: {
    id: string;
    lineAccountId: string;
    expectedDraftVersionId: unknown;
    name: unknown;
    eventType: unknown;
    triggerConfig: unknown;
    actions: unknown;
  },
): Promise<void> {
  const current = await getAutomationDraft(db, { id: input.id, lineAccountId: input.lineAccountId });
  const expected = requiredString(input.expectedDraftVersionId, 'expectedDraftVersionId', '編集中の版');
  if (current.draftVersionId !== expected) {
    throw new AutomationDraftError('version_conflict', '別の人が下書きを更新しました。再読み込みしてください');
  }
  const name = requiredString(input.name, 'name', 'ルール名');
  const allowedTriggers = new Set(['friend_add', 'tag_change', 'message_received']);
  const eventType = requiredString(input.eventType, 'eventType', 'きっかけ');
  if (!allowedTriggers.has(eventType)) {
    throw new AutomationDraftError('trigger_unsupported', 'このきっかけはまだ実行まで接続されていません', 'eventType');
  }
  const triggerConfig = input.triggerConfig !== null
    && typeof input.triggerConfig === 'object'
    && !Array.isArray(input.triggerConfig)
    ? { ...input.triggerConfig as Record<string, unknown> }
    : {};
  if (eventType === 'tag_change') {
    const tagId = requiredString(triggerConfig.tagId, 'triggerTagId', 'きっかけのタグ');
    await requireResource(db, 'tags', tagId, input.lineAccountId, 'triggerTagId', 'きっかけのタグ');
    triggerConfig.tagId = tagId;
    triggerConfig.action = 'add';
  }

  if (!Array.isArray(input.actions) || input.actions.length !== 1) {
    throw new AutomationDraftError('actions_invalid', 'することを1つ選んでください', 'actions');
  }
  const raw = input.actions[0] as Partial<AutomationDraftAction>;
  if (!raw || !new Set(['add_tag', 'start_scenario', 'send_message']).has(String(raw.type))) {
    throw new AutomationDraftError('action_unsupported', 'この処理はまだ実行まで接続されていません', 'actions');
  }
  const params = raw.params && typeof raw.params === 'object' && !Array.isArray(raw.params)
    ? { ...raw.params }
    : {};
  if (raw.type === 'add_tag') {
    const tagId = requiredString(params.tagId, 'actionTagId', '付けるタグ');
    await requireResource(db, 'tags', tagId, input.lineAccountId, 'actionTagId', '付けるタグ');
    params.tagId = tagId;
  } else if (raw.type === 'start_scenario') {
    const scenarioId = requiredString(params.scenarioId, 'actionScenarioId', '始めるシナリオ');
    await requireResource(db, 'scenarios', scenarioId, input.lineAccountId, 'actionScenarioId', '始めるシナリオ');
    params.scenarioId = scenarioId;
  } else {
    params.messageType = 'text';
    params.content = requiredString(params.content, 'actionMessage', '送る文面');
  }
  const actions: AutomationDraftAction[] = [{
    id: typeof raw.id === 'string' && raw.id ? raw.id : 'step-1',
    type: raw.type as AutomationDraftActionType,
    params,
    onFailure: 'stop',
  }];
  const now = new Date().toISOString();
  const results = await db.batch([
    db.prepare(
      `UPDATE automation_versions
          SET trigger_type = ?, trigger_config = ?, condition_config = '{}', action_config = ?
        WHERE id = ? AND automation_id = ? AND status = 'draft'`,
    ).bind(eventType, JSON.stringify(triggerConfig), JSON.stringify(actions), expected, current.id),
    db.prepare(
      `UPDATE automation_definitions SET name = ?, updated_at = ?
        WHERE id = ? AND line_account_id = ? AND status = 'draft'
          AND current_draft_version_id = ?`,
    ).bind(name, now, current.id, input.lineAccountId, expected),
  ]);
  if ((results[0].meta?.changes ?? 0) !== 1 || (results[1].meta?.changes ?? 0) !== 1) {
    throw new AutomationDraftError('version_conflict', '編集中の下書きが変わりました。再読み込みしてください');
  }
}
