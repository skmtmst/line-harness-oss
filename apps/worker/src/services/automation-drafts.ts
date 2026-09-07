import { parseCondition } from './segment-query.js';

export type AutomationDraftActionType = 'add_tag' | 'start_scenario' | 'send_message';
export type AutomationDraftTriggerType =
  | 'friend_add'
  | 'tag_change'
  | 'message_received'
  | 'form_submitted'
  | 'link_clicked'
  | 'calendar_booked'
  | 'datetime'
  | 'daily'
  | 'weekly'
  | 'ec.order.confirmed';

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
  triggerType: AutomationDraftTriggerType;
  triggerConfig: Record<string, unknown>;
  actions: AutomationDraftAction[];
}

export interface AutomationDraftDetail {
  id: string;
  draftVersionId: string;
  name: string;
  description: string | null;
  eventType: AutomationDraftTriggerType;
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

function optionalString(value: unknown, field: string): string | null {
  if (value === undefined || value === null || value === '') return null;
  if (typeof value !== 'string' || !value.trim()) {
    throw new AutomationDraftError('invalid', '選択内容を確認してください', field);
  }
  return value.trim();
}

async function requireScopedId(
  db: D1Database,
  input: { sql: string; binds: unknown[]; field: string; label: string },
): Promise<void> {
  const row = await db.prepare(input.sql).bind(...input.binds).first<{ id: string }>();
  if (!row) throw new AutomationDraftError('resource_not_found', `${input.label}を選び直してください`, input.field);
}

async function validateTriggerConfig(
  db: D1Database,
  eventType: AutomationDraftTriggerType,
  value: unknown,
  lineAccountId: string,
): Promise<Record<string, unknown>> {
  const config = value !== null && typeof value === 'object' && !Array.isArray(value)
    ? { ...value as Record<string, unknown> }
    : {};
  const allowed: Record<AutomationDraftTriggerType, ReadonlySet<string>> = {
    friend_add: new Set(),
    tag_change: new Set(['tagId', 'action']),
    message_received: new Set(['keyword']),
    form_submitted: new Set(['formId']),
    link_clicked: new Set(['trackedLinkId']),
    calendar_booked: new Set(['bookingType', 'menuId', 'eventId']),
    datetime: new Set(['at', 'friendIds']),
    daily: new Set(['time', 'friendIds']),
    weekly: new Set(['time', 'weekdays', 'friendIds']),
    'ec.order.confirmed': new Set(),
  };
  const unknown = Object.keys(config).find((key) => !allowed[eventType].has(key));
  if (unknown) throw new AutomationDraftError('trigger_config_invalid', 'きっかけの設定を確認してください', unknown);

  if (eventType === 'tag_change') {
    const tagId = requiredString(config.tagId, 'triggerTagId', 'きっかけのタグ');
    await requireResource(db, 'tags', tagId, lineAccountId, 'triggerTagId', 'きっかけのタグ');
    if (config.action !== 'add' && config.action !== 'remove') {
      throw new AutomationDraftError('trigger_config_invalid', 'タグを付けたときか外したときを選んでください', 'triggerAction');
    }
    return { tagId, action: config.action };
  }
  if (eventType === 'message_received') {
    const keyword = optionalString(config.keyword, 'keyword');
    return keyword ? { keyword } : {};
  }
  if (eventType === 'form_submitted') {
    const formId = optionalString(config.formId, 'formId');
    if (formId) await requireScopedId(db, {
      sql: `SELECT form_id AS id FROM form_accounts WHERE form_id = ? AND line_account_id = ?`,
      binds: [formId, lineAccountId], field: 'formId', label: '回答フォーム',
    });
    return formId ? { formId } : {};
  }
  if (eventType === 'link_clicked') {
    const trackedLinkId = optionalString(config.trackedLinkId, 'trackedLinkId');
    if (trackedLinkId) await requireScopedId(db, {
      sql: `SELECT id FROM tracked_links WHERE id = ? AND line_account_id = ? AND is_active = 1`,
      binds: [trackedLinkId, lineAccountId], field: 'trackedLinkId', label: '計測リンク',
    });
    return trackedLinkId ? { trackedLinkId } : {};
  }
  if (eventType === 'calendar_booked') {
    const bookingType = optionalString(config.bookingType, 'bookingType');
    if (bookingType && bookingType !== 'salon' && bookingType !== 'event') {
      throw new AutomationDraftError('trigger_config_invalid', '予約の種類を選び直してください', 'bookingType');
    }
    const menuId = optionalString(config.menuId, 'menuId');
    const eventId = optionalString(config.eventId, 'eventId');
    if (menuId) await requireScopedId(db, {
      sql: `SELECT id FROM menus WHERE id = ? AND line_account_id = ? AND deleted_at IS NULL`,
      binds: [menuId, lineAccountId], field: 'menuId', label: '予約メニュー',
    });
    if (eventId) await requireScopedId(db, {
      sql: `SELECT id FROM events WHERE id = ? AND line_account_id = ? AND deleted_at IS NULL`,
      binds: [eventId, lineAccountId], field: 'eventId', label: 'イベント',
    });
    if ((bookingType === 'salon' && eventId) || (bookingType === 'event' && menuId)) {
      throw new AutomationDraftError('trigger_config_invalid', '予約の種類と絞り込み先が一致しません', 'bookingType');
    }
    return {
      ...(bookingType ? { bookingType } : {}),
      ...(menuId ? { menuId } : {}),
      ...(eventId ? { eventId } : {}),
    };
  }
  if (eventType === 'datetime' || eventType === 'daily' || eventType === 'weekly') {
    if (!Array.isArray(config.friendIds) || config.friendIds.length === 0 || config.friendIds.length > 100
      || config.friendIds.some((id) => typeof id !== 'string' || !id.trim())) {
      throw new AutomationDraftError('trigger_config_invalid', '対象の友だちは1〜100人で選んでください', 'friendIds');
    }
    const friendIds = [...new Set(config.friendIds as string[])];
    const placeholders = friendIds.map(() => '?').join(', ');
    const count = await db.prepare(
      `SELECT COUNT(*) AS count FROM friends WHERE line_account_id = ? AND id IN (${placeholders})`,
    ).bind(lineAccountId, ...friendIds).first<{ count: number }>();
    if (Number(count?.count ?? 0) !== friendIds.length) {
      throw new AutomationDraftError('resource_not_found', '対象の友だちを選び直してください', 'friendIds');
    }
    if (eventType === 'datetime') {
      const at = requiredString(config.at, 'at', '実行日時');
      if (!/T.*(?:Z|[+-]\d{2}:\d{2})$/.test(at) || !Number.isFinite(Date.parse(at))) {
        throw new AutomationDraftError('trigger_config_invalid', 'タイムゾーンを含む日時を入力してください', 'at');
      }
      if (Date.parse(at) <= Date.now()) {
        throw new AutomationDraftError('trigger_config_invalid', 'これからの日時を入力してください', 'at');
      }
      return { at, friendIds };
    }
    const time = requiredString(config.time, 'time', '実行時刻');
    if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(time) || Number(time.slice(3)) % 5 !== 0) {
      throw new AutomationDraftError('trigger_config_invalid', '時刻は5分単位で入力してください', 'time');
    }
    if (eventType === 'weekly') {
      if (!Array.isArray(config.weekdays) || config.weekdays.length === 0
        || config.weekdays.some((day) => !Number.isInteger(day) || Number(day) < 0 || Number(day) > 6)) {
        throw new AutomationDraftError('trigger_config_invalid', '曜日を1つ以上選んでください', 'weekdays');
      }
      return { time, weekdays: [...new Set(config.weekdays as number[])], friendIds };
    }
    return { time, friendIds };
  }
  return {};
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
    conditions?: unknown;
    actions: unknown;
  },
): Promise<void> {
  const current = await getAutomationDraft(db, { id: input.id, lineAccountId: input.lineAccountId });
  const expected = requiredString(input.expectedDraftVersionId, 'expectedDraftVersionId', '編集中の版');
  if (current.draftVersionId !== expected) {
    throw new AutomationDraftError('version_conflict', '別の人が下書きを更新しました。再読み込みしてください');
  }
  const name = requiredString(input.name, 'name', 'ルール名');
  const allowedTriggers = new Set<AutomationDraftTriggerType>([
    'friend_add', 'tag_change', 'message_received', 'form_submitted', 'link_clicked',
    'calendar_booked', 'datetime', 'daily', 'weekly', 'ec.order.confirmed',
  ]);
  const eventType = requiredString(input.eventType, 'eventType', 'きっかけ');
  if (!allowedTriggers.has(eventType as AutomationDraftTriggerType)) {
    throw new AutomationDraftError('trigger_unsupported', 'このきっかけはまだ実行まで接続されていません', 'eventType');
  }
  const triggerConfig = await validateTriggerConfig(
    db, eventType as AutomationDraftTriggerType, input.triggerConfig, input.lineAccountId,
  );
  const conditions = input.conditions === undefined ? current.conditions : input.conditions;
  if (conditions === null || typeof conditions !== 'object' || Array.isArray(conditions)) {
    throw new AutomationDraftError('condition_invalid', '対象条件を確認してください', 'conditions');
  }
  if (Object.keys(conditions as Record<string, unknown>).length > 0
    && !parseCondition(JSON.stringify(conditions))) {
    throw new AutomationDraftError('condition_invalid', '対象条件を確認してください', 'conditions');
  }

  if (!Array.isArray(input.actions) || input.actions.length === 0 || input.actions.length > 20) {
    throw new AutomationDraftError('actions_invalid', 'することは1〜20個で選んでください', 'actions');
  }
  const actions: AutomationDraftAction[] = [];
  const ids = new Set<string>();
  for (const [index, candidate] of input.actions.entries()) {
    const raw = candidate as Partial<AutomationDraftAction>;
    if (!raw || !new Set(['add_tag', 'start_scenario', 'send_message']).has(String(raw.type))) {
      throw new AutomationDraftError('action_unsupported', 'この処理はまだ実行まで接続されていません', `actions.${index}`);
    }
    const params = raw.params && typeof raw.params === 'object' && !Array.isArray(raw.params)
      ? { ...raw.params }
      : {};
    if (raw.type === 'add_tag') {
      const tagId = requiredString(params.tagId, `actions.${index}.tagId`, '付けるタグ');
      await requireResource(db, 'tags', tagId, input.lineAccountId, `actions.${index}.tagId`, '付けるタグ');
      params.tagId = tagId;
    } else if (raw.type === 'start_scenario') {
      const scenarioId = requiredString(params.scenarioId, `actions.${index}.scenarioId`, '始めるシナリオ');
      await requireResource(db, 'scenarios', scenarioId, input.lineAccountId, `actions.${index}.scenarioId`, '始めるシナリオ');
      params.scenarioId = scenarioId;
    } else {
      params.messageType = 'text';
      params.content = requiredString(params.content, `actions.${index}.content`, '送る文面');
    }
    const id = typeof raw.id === 'string' && raw.id.trim() ? raw.id.trim() : `step-${index + 1}`;
    if (ids.has(id)) throw new AutomationDraftError('action_id_duplicate', '処理の番号が重複しています', `actions.${index}.id`);
    ids.add(id);
    actions.push({ id, type: raw.type as AutomationDraftActionType, params, onFailure: 'stop' });
  }
  const now = new Date().toISOString();
  const results = await db.batch([
    db.prepare(
      `UPDATE automation_versions
          SET trigger_type = ?, trigger_config = ?, condition_config = ?, action_config = ?
        WHERE id = ? AND automation_id = ? AND status = 'draft'`,
    ).bind(
      eventType, JSON.stringify(triggerConfig), JSON.stringify(conditions),
      JSON.stringify(actions), expected, current.id,
    ),
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

export async function publishAutomationDraft(
  db: D1Database,
  input: { id: string; lineAccountId: string; expectedDraftVersionId: unknown; activate: unknown },
): Promise<{ id: string; versionId: string; versionNumber: number; status: 'active' | 'stopped' }> {
  const current = await getAutomationDraft(db, { id: input.id, lineAccountId: input.lineAccountId });
  const expected = requiredString(input.expectedDraftVersionId, 'expectedDraftVersionId', '公開する版');
  if (current.draftVersionId !== expected) {
    throw new AutomationDraftError('version_conflict', '別の人が下書きを更新しました。再読み込みしてください');
  }
  const version = await db.prepare(
    `SELECT version_number FROM automation_versions
      WHERE id = ? AND automation_id = ? AND status = 'draft'`,
  ).bind(expected, current.id).first<{ version_number: number }>();
  if (!version) throw new AutomationDraftError('not_found', '公開する下書きが見つかりません');
  const status = input.activate === false ? 'stopped' : 'active';
  const now = new Date().toISOString();
  const results = await db.batch([
    db.prepare(
      `UPDATE automation_versions SET status = 'published', published_at = ?
        WHERE id = ? AND automation_id = ? AND status = 'draft'`,
    ).bind(now, expected, current.id),
    db.prepare(
      `UPDATE automation_definitions
          SET status = ?, current_published_version_id = ?, current_draft_version_id = NULL, updated_at = ?
        WHERE id = ? AND line_account_id = ? AND status = 'draft'
          AND current_draft_version_id = ?`,
    ).bind(status, expected, now, current.id, input.lineAccountId, expected),
  ]);
  if ((results[0].meta?.changes ?? 0) !== 1 || (results[1].meta?.changes ?? 0) !== 1) {
    throw new AutomationDraftError('version_conflict', '公開する前に下書きが変わりました。再読み込みしてください');
  }
  return { id: current.id, versionId: expected, versionNumber: Number(version.version_number), status };
}
