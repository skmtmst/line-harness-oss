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

/**
 * 版の中身を、保存されている生の文字列のまま持ったもの。
 *
 * 指紋も突き合わせも**この生の文字列**で行う。読み直して組み立て直すと
 * 鍵の並びや空白で見た目が変わることがあり、同じ中身なのに違うと言い出す。
 */
export interface AutomationVersionContent {
  trigger_type: string;
  trigger_config: string;
  condition_config: string;
  action_config: string;
}

async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

/**
 * 版の中身の指紋。**1文字でも違えば別の値**になる。
 *
 * 長さを前に付けてから繋ぐので、区切りの文字が中身に紛れていても
 * 別の組み合わせが同じ文字列にならない。
 */
export async function automationVersionFingerprint(content: AutomationVersionContent): Promise<string> {
  const joined = [
    content.trigger_type, content.trigger_config, content.condition_config, content.action_config,
  ].map((part) => `${part.length}:${part}`).join('|');
  return (await sha256Hex(joined)).slice(0, 32);
}

/**
 * 画面へ渡す「確認した版」の札（revision）。
 *
 * `<版の行のid>.<中身の指紋>` の形。**画面はこれを中身の分からない札として
 * 持ち回るだけ**で、指紋の作り方を知らない。同じ判定を画面とWorkerの2か所に
 * 置くと、片方だけ直したときに食い違うためである。
 *
 * `updateAutomationDraft` は `automation_versions` の同じ行を書き換えるので、
 * 行のidだけでは中身が変わったことを見分けられない。**指紋を札に混ぜて初めて、
 * 突き合わせが中身に効く。**
 */
export async function automationRevisionToken(
  versionId: string,
  content: AutomationVersionContent,
): Promise<string> {
  return `${versionId}.${await automationVersionFingerprint(content)}`;
}

/** 札を、版の行のidと指紋に分ける。指紋の付いていない古い形も受け取る。 */
export function parseAutomationRevision(value: unknown): { versionId: string; fingerprint: string | null } {
  const raw = typeof value === 'string' ? value.trim() : '';
  // 版の行のidはUUIDで `.` を含まない。最後の `.` から後ろが指紋。
  const separator = raw.lastIndexOf('.');
  if (separator <= 0) return { versionId: raw, fingerprint: null };
  return { versionId: raw.slice(0, separator), fingerprint: raw.slice(separator + 1) };
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

/**
 * 同じ人・同じ店・同じ見本なら、いつも同じ下書きのidになるようにする（冪等鍵）。
 *
 * `automation_definitions.id` は主鍵なので、**この値を鍵として使えば
 * 移行を足さずに一意にできる**。世代番号は、前の下書きを公開して
 * そのidが埋まったときに次へずらすためのもの。
 */
async function templateDraftId(
  input: { templateKey: string; lineAccountId: string; createdBy?: string | null },
  generation: number,
): Promise<string> {
  const seed = [
    'automation-template-draft',
    input.lineAccountId,
    input.templateKey,
    input.createdBy ?? 'anonymous',
    String(generation),
  ].map((part) => `${part.length}:${part}`).join('|');
  const hex = await sha256Hex(seed);
  // 既存のidと同じ見た目（UUIDの形）に整える。
  return [hex.slice(0, 8), hex.slice(8, 12), hex.slice(12, 16), hex.slice(16, 20), hex.slice(20, 32)].join('-');
}

/**
 * 見本から下書きを作る。**同じ条件で何度呼んでも1件しか作らない。**
 *
 * 以前は毎回 `crypto.randomUUID()` を振っていたので、2つのタブが同時に
 * 保存を押すと下書きが2件できた。画面側の連打よけ（JSの変数と sessionStorage）は
 * タブの中でしか効かない。**冪等鍵を主鍵に載せ、DBで1件に収める。**
 *
 * 3つの文をひとつのまとまりで流すので、途中で割り込まれても
 * 「定義だけあって版が無い」状態にはならない。既にある下書きに当たったときは
 * 版を足さず、そのまま同じ下書きを返す。
 */
export async function createAutomationDraftFromTemplate(
  db: D1Database,
  input: { templateKey: string; lineAccountId: string; createdBy?: string | null },
): Promise<{ id: string; draftVersionId: string }> {
  const source = template(input.templateKey);
  const now = new Date().toISOString();

  // 公開済みなどで鍵が埋まっていたら、次の世代へずらす。
  for (let generation = 0; generation < 32; generation += 1) {
    const id = await templateDraftId(input, generation);
    const versionId = crypto.randomUUID();
    await db.batch([
      db.prepare(
        `INSERT OR IGNORE INTO automation_definitions
           (id, line_account_id, name, description, status, created_by, created_at, updated_at)
         VALUES (?, ?, ?, ?, 'draft', ?, ?, ?)`,
      ).bind(id, input.lineAccountId, source.name, source.description, input.createdBy ?? null, now, now),
      db.prepare(
        // まだ版が付いていない下書きのときだけ足す。先に作った側の版を
        // 上書きしないよう、`current_draft_version_id IS NULL` で守る。
        `INSERT INTO automation_versions
           (id, automation_id, version_number, status, trigger_type, trigger_config,
            condition_config, action_config, created_by, created_at)
         SELECT ?, ?, 1, 'draft', ?, ?, '{}', ?, ?, ?
          WHERE EXISTS (
            SELECT 1 FROM automation_definitions
             WHERE id = ? AND line_account_id = ? AND status = 'draft'
               AND current_draft_version_id IS NULL
          )`,
      ).bind(
        versionId,
        id,
        source.triggerType,
        JSON.stringify(source.triggerConfig),
        JSON.stringify(source.actions),
        input.createdBy ?? null,
        now,
        id,
        input.lineAccountId,
      ),
      db.prepare(
        `UPDATE automation_definitions SET current_draft_version_id = ?
          WHERE id = ? AND line_account_id = ? AND status = 'draft'
            AND current_draft_version_id IS NULL`,
      ).bind(versionId, id, input.lineAccountId),
    ]);

    const row = await db.prepare(
      `SELECT d.current_draft_version_id, v.trigger_type, v.trigger_config,
              v.condition_config, v.action_config
         FROM automation_definitions d
         JOIN automation_versions v
           ON v.id = d.current_draft_version_id
          AND v.automation_id = d.id AND v.status = 'draft'
        WHERE d.id = ? AND d.line_account_id = ? AND d.status = 'draft'`,
    ).bind(id, input.lineAccountId).first<AutomationVersionContent & { current_draft_version_id: string }>();
    // この鍵が別の用途（公開済み・他店）で埋まっていたら次の世代を試す。
    if (!row) continue;
    return { id, draftVersionId: await automationRevisionToken(row.current_draft_version_id, row) };
  }
  throw new AutomationDraftError('template_conflict', '下書きを作れませんでした。少し待ってからもう一度お試しください');
}

interface AutomationDraftRow extends AutomationVersionContent {
  id: string;
  name: string;
  description: string | null;
  current_draft_version_id: string;
  trigger_type: AutomationDraftDetail['eventType'];
  created_by: string | null;
}

/** 下書きを、保存されている生の文字列のまま読む。突き合わせはこの値で行う。 */
async function readAutomationDraftRow(
  db: D1Database,
  input: { id: string; lineAccountId: string },
): Promise<AutomationDraftRow> {
  const row = await db.prepare(
    `SELECT d.id, d.name, d.description, d.current_draft_version_id, v.created_by,
            v.trigger_type, v.trigger_config, v.condition_config, v.action_config
       FROM automation_definitions d
       JOIN automation_versions v
         ON v.id = d.current_draft_version_id
        AND v.automation_id = d.id AND v.status = 'draft'
      WHERE d.id = ? AND d.line_account_id = ? AND d.status = 'draft'`,
  ).bind(input.id, input.lineAccountId).first<AutomationDraftRow>();
  if (!row) throw new AutomationDraftError('not_found', '編集中の下書きが見つかりません');
  return row;
}

export async function getAutomationDraft(
  db: D1Database,
  input: { id: string; lineAccountId: string },
): Promise<AutomationDraftDetail> {
  const row = await readAutomationDraftRow(db, input);
  return {
    id: row.id,
    // 中身の指紋を混ぜた札を返す。画面はこれをそのまま送り返すだけでよい。
    draftVersionId: await automationRevisionToken(row.current_draft_version_id, row),
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
): Promise<{ draftVersionId: string }> {
  const current = await readAutomationDraftRow(db, { id: input.id, lineAccountId: input.lineAccountId });
  const expected = requiredString(input.expectedDraftVersionId, 'expectedDraftVersionId', '編集中の版');
  // 札には中身の指紋が入っているので、この1行で「行が同じか」だけでなく
  // 「中身が同じか」まで見ている。指紋の無い古い形の札は中身を守れないので
  // 受け取らない（黙って素通しすると、守っているつもりの穴が残る）。
  const requested = parseAutomationRevision(expected);
  if (!requested.fingerprint) {
    throw new AutomationDraftError('version_conflict', '編集中の版を読み直してください', 'expectedDraftVersionId');
  }
  if (await automationRevisionToken(current.current_draft_version_id, current) !== expected) {
    throw new AutomationDraftError('version_conflict', '別の人が下書きを更新しました。再読み込みしてください');
  }
  const expectedVersionId = requested.versionId;
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
  const conditions = input.conditions === undefined
    ? parseObject(current.condition_config, '下書きの条件')
    : input.conditions;
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
  const nextContent: AutomationVersionContent = {
    trigger_type: eventType,
    trigger_config: JSON.stringify(triggerConfig),
    condition_config: JSON.stringify(conditions),
    action_config: JSON.stringify(actions),
  };
  const nextVersionId = crypto.randomUUID();
  /*
   * **版の行は書き換えない。新しい行を作って、現在の下書きを差し替える。**
   *
   * 以前は同じ行の中身を上書きしていたので、下書きを何度更新しても
   * `automation_versions.id` が変わらなかった。すると
   *
   *   - `WHERE ... current_draft_version_id = ?` の突き合わせが中身に効かず、
   *     後から来た保存が、別の人の保存を黙って上書きしていた
   *   - 1人テストが「確認した版」として渡した id が、中身が入れ替わった後も
   *     そのまま通り、**利用者が見ていない文面を送れてしまった**
   *
   * 行を不変にすると、`startAutomationRun` の
   * `v.id IN (現在の下書き, 現在の公開)` がそのまま CAS になる。割り込みの保存が
   * 入った版はその場で外れるので、**実行記録を1行も作らずに**止まる。
   * 公開済みの版が `trg_automation_published_version_immutable` で不変なのと
   * 同じ考え方を、下書きにも広げた形になる。
   *
   * 古い版の行は残す。実行記録（`automation_runs.automation_version_id`）が
   * 指していることがあり、実行記録は消せない決まりだからである。
   */
  const results = await db.batch([
    db.prepare(
      `INSERT INTO automation_versions
         (id, automation_id, version_number, status, trigger_type, trigger_config,
          condition_config, action_config, created_by, created_at)
       SELECT ?, ?,
              COALESCE((SELECT MAX(version_number) FROM automation_versions WHERE automation_id = ?), 0) + 1,
              'draft', ?, ?, ?, ?, ?, ?
        WHERE EXISTS (
          SELECT 1 FROM automation_definitions d
            JOIN automation_versions v ON v.id = d.current_draft_version_id
           WHERE d.id = ? AND d.line_account_id = ? AND d.status = 'draft'
             AND d.current_draft_version_id = ?
             AND v.trigger_type = ? AND v.trigger_config = ?
             AND v.condition_config = ? AND v.action_config = ?
        )`,
    ).bind(
      nextVersionId, current.id, current.id,
      nextContent.trigger_type, nextContent.trigger_config,
      nextContent.condition_config, nextContent.action_config,
      current.created_by ?? null, now,
      current.id, input.lineAccountId, expectedVersionId,
      current.trigger_type, current.trigger_config,
      current.condition_config, current.action_config,
    ),
    db.prepare(
      // 1文目が当たらなかったとき（＝読んだあとに中身が変わったとき）は、
      // ここも当ててはいけない。**無い版を指しにいってしまう。**
      // 新しい版が本当にできたときだけ差し替える。
      `UPDATE automation_definitions
          SET name = ?, updated_at = ?, current_draft_version_id = ?
        WHERE id = ? AND line_account_id = ? AND status = 'draft'
          AND current_draft_version_id = ?
          AND EXISTS (
            SELECT 1 FROM automation_versions WHERE id = ? AND automation_id = ?
          )`,
    ).bind(
      name, now, nextVersionId, current.id, input.lineAccountId, expectedVersionId,
      nextVersionId, current.id,
    ),
  ]);
  if ((results[0].meta?.changes ?? 0) !== 1 || (results[1].meta?.changes ?? 0) !== 1) {
    throw new AutomationDraftError('version_conflict', '編集中の下書きが変わりました。再読み込みしてください');
  }
  // 版が新しくなったので札も変わる。画面はこれを次の突き合わせに使う。
  return { draftVersionId: await automationRevisionToken(nextVersionId, nextContent) };
}

export async function publishAutomationDraft(
  db: D1Database,
  input: { id: string; lineAccountId: string; expectedDraftVersionId: unknown; activate: unknown },
): Promise<{ id: string; versionId: string; versionNumber: number; status: 'active' | 'stopped' }> {
  const current = await readAutomationDraftRow(db, { id: input.id, lineAccountId: input.lineAccountId });
  const expected = requiredString(input.expectedDraftVersionId, 'expectedDraftVersionId', '公開する版');
  const requested = parseAutomationRevision(expected);
  if (!requested.fingerprint) {
    throw new AutomationDraftError('version_conflict', '公開する版を読み直してください', 'expectedDraftVersionId');
  }
  // 見ていない中身をそのまま公開しないよう、公開も中身で突き合わせる。
  if (await automationRevisionToken(current.current_draft_version_id, current) !== expected) {
    throw new AutomationDraftError('version_conflict', '別の人が下書きを更新しました。再読み込みしてください');
  }
  const expectedVersionId = requested.versionId;
  const version = await db.prepare(
    `SELECT version_number FROM automation_versions
      WHERE id = ? AND automation_id = ? AND status = 'draft'`,
  ).bind(expectedVersionId, current.id).first<{ version_number: number }>();
  if (!version) throw new AutomationDraftError('not_found', '公開する下書きが見つかりません');
  const status = input.activate === false ? 'stopped' : 'active';
  const now = new Date().toISOString();
  const results = await db.batch([
    db.prepare(
      `UPDATE automation_versions SET status = 'published', published_at = ?
        WHERE id = ? AND automation_id = ? AND status = 'draft'
          AND trigger_type = ? AND trigger_config = ?
          AND condition_config = ? AND action_config = ?`,
    ).bind(
      now, expectedVersionId, current.id,
      current.trigger_type, current.trigger_config,
      current.condition_config, current.action_config,
    ),
    db.prepare(
      `UPDATE automation_definitions
          SET status = ?, current_published_version_id = ?, current_draft_version_id = NULL, updated_at = ?
        WHERE id = ? AND line_account_id = ? AND status = 'draft'
          AND current_draft_version_id = ?`,
    ).bind(status, expectedVersionId, now, current.id, input.lineAccountId, expectedVersionId),
  ]);
  if ((results[0].meta?.changes ?? 0) !== 1 || (results[1].meta?.changes ?? 0) !== 1) {
    throw new AutomationDraftError('version_conflict', '公開する前に下書きが変わりました。再読み込みしてください');
  }
  return { id: current.id, versionId: expectedVersionId, versionNumber: Number(version.version_number), status };
}
