export type ActionScoreRuleOperation = 'delta' | 'set';
export type ActionScoreRuleSetStatus = 'draft' | 'published' | 'stopped';
export type ActionScoreFrequencyKind =
  | 'unlimited'
  | 'per_day'
  | 'per_subject'
  | 'per_subject_per_day'
  | 'once_per_period';

export interface ActionScoreRule {
  id: string;
  name: string;
  eventType: string;
  source: string | null;
  operation: ActionScoreRuleOperation;
  value: number;
  frequency: { kind: ActionScoreFrequencyKind; limit: number };
  sameSourceEventOnce: true;
  validFrom: string | null;
  validUntil: string | null;
  enabled: boolean;
}

export interface ActionScoreBands {
  min: number;
  max: number;
  normalMin: number;
  highMin: number;
}

export interface ActionScoreRuleBundle {
  rules: ActionScoreRule[];
  bands: ActionScoreBands;
}

export interface ActionScoreRuleVersion extends ActionScoreRuleBundle {
  id: string | null;
  versionNumber: number;
  status: 'draft' | 'published';
  createdAt: string | null;
  publishedAt: string | null;
}

export interface ActionScoreRuleConfiguration {
  configured: boolean;
  status: 'not_configured' | ActionScoreRuleSetStatus;
  currentDraftVersionId: string | null;
  currentPublishedVersionId: string | null;
  editableVersion: ActionScoreRuleVersion;
  publishedVersion: ActionScoreRuleVersion | null;
}

export class ActionScoreRuleValidationError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly field?: string,
  ) {
    super(message);
  }
}

type RuleSetRow = {
  id: string;
  line_account_id: string;
  status: ActionScoreRuleSetStatus;
  current_draft_version_id: string | null;
  current_published_version_id: string | null;
};

type VersionRow = {
  id: string;
  rule_set_id: string;
  version_number: number;
  status: 'draft' | 'published';
  rules_json: string;
  min_score: number;
  max_score: number;
  normal_min: number;
  high_min: number;
  created_at: string;
  published_at: string | null;
};

const DEFAULT_BANDS: ActionScoreBands = { min: 0, max: 100, normalMin: 30, highMin: 70 };

const DEFAULT_RULES: ActionScoreRule[] = [
  {
    id: 'message-replied', name: 'こちらに返信した', eventType: 'message_received', source: 'line_webhook',
    operation: 'delta', value: 8, frequency: { kind: 'per_day', limit: 1 },
    sameSourceEventOnce: true, validFrom: null, validUntil: null, enabled: true,
  },
  {
    id: 'delivery-url-clicked', name: '配信のURLを押した', eventType: 'link_clicked', source: 'tracked_link',
    operation: 'delta', value: 5, frequency: { kind: 'per_subject', limit: 1 },
    sameSourceEventOnce: true, validFrom: null, validUntil: null, enabled: true,
  },
  {
    id: 'form-answered', name: '回答フォームに答えた', eventType: 'form_submitted', source: 'form',
    operation: 'delta', value: 15, frequency: { kind: 'unlimited', limit: 1 },
    sameSourceEventOnce: true, validFrom: null, validUntil: null, enabled: true,
  },
  {
    id: 'booking-created', name: '予約をした', eventType: 'booking_created', source: null,
    operation: 'delta', value: 20, frequency: { kind: 'unlimited', limit: 1 },
    sameSourceEventOnce: true, validFrom: null, validUntil: null, enabled: true,
  },
  {
    id: 'purchase-completed', name: '買った', eventType: 'purchase_completed', source: 'stripe',
    operation: 'delta', value: 25, frequency: { kind: 'unlimited', limit: 1 },
    sameSourceEventOnce: true, validFrom: null, validUntil: null, enabled: true,
  },
  {
    id: 'inactive-30-days', name: '30日間反応がない', eventType: 'inactivity_30d', source: 'scheduler',
    operation: 'delta', value: -10, frequency: { kind: 'once_per_period', limit: 1 },
    sameSourceEventOnce: true, validFrom: null, validUntil: null, enabled: true,
  },
  {
    id: 'friend-blocked', name: 'ブロックした', eventType: 'friend_unfollow', source: 'line_webhook',
    operation: 'set', value: 0, frequency: { kind: 'unlimited', limit: 1 },
    sameSourceEventOnce: true, validFrom: null, validUntil: null, enabled: true,
  },
];

export function defaultActionScoreRuleBundle(): ActionScoreRuleBundle {
  return {
    rules: DEFAULT_RULES.map((rule) => ({ ...rule, frequency: { ...rule.frequency } })),
    bands: { ...DEFAULT_BANDS },
  };
}

function requiredText(value: unknown, field: string, label: string, max: number): string {
  if (typeof value !== 'string' || !value.trim()) {
    throw new ActionScoreRuleValidationError('required', `${label}を入力してください`, field);
  }
  const text = value.trim();
  if (text.length > max) {
    throw new ActionScoreRuleValidationError('too_long', `${label}は${max}文字までです`, field);
  }
  return text;
}

function optionalDate(value: unknown, field: string): string | null {
  if (value == null || value === '') return null;
  if (typeof value !== 'string' || Number.isNaN(new Date(value).getTime())) {
    throw new ActionScoreRuleValidationError('invalid_date', '有効期間の日付を確認してください', field);
  }
  return value;
}

function validateBands(value: unknown): ActionScoreBands {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new ActionScoreRuleValidationError('bands_required', '層の境界を入力してください', 'bands');
  }
  const raw = value as Record<string, unknown>;
  const bands = {
    min: Number(raw.min), max: Number(raw.max), normalMin: Number(raw.normalMin), highMin: Number(raw.highMin),
  };
  if (!Object.values(bands).every(Number.isInteger)
    || bands.min < 0 || bands.max > 1_000_000 || bands.max <= bands.min
    || bands.normalMin <= bands.min || bands.highMin <= bands.normalMin || bands.highMin >= bands.max) {
    throw new ActionScoreRuleValidationError(
      'bands_invalid',
      '低い・ふつう・高いの境界を、下限から上限の間で順番に設定してください',
      'bands',
    );
  }
  return bands;
}

const RULE_KEY = /^[a-z0-9][a-z0-9_-]{0,63}$/i;
const EVENT_KEY = /^[a-z][a-z0-9_.-]{0,99}$/i;
const FREQUENCY_KINDS = new Set<ActionScoreFrequencyKind>([
  'unlimited', 'per_day', 'per_subject', 'per_subject_per_day', 'once_per_period',
]);

export function validateActionScoreRuleBundle(value: unknown): ActionScoreRuleBundle {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new ActionScoreRuleValidationError('configuration_required', 'スコアのルールを入力してください');
  }
  const raw = value as Record<string, unknown>;
  if (!Array.isArray(raw.rules) || raw.rules.length > 50) {
    throw new ActionScoreRuleValidationError('rules_invalid', 'ルールは50件までです', 'rules');
  }
  const bands = validateBands(raw.bands);
  const ids = new Set<string>();
  const rules = raw.rules.map((entry, index): ActionScoreRule => {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
      throw new ActionScoreRuleValidationError('rule_invalid', 'ルールの内容を確認してください', `rules.${index}`);
    }
    const rule = entry as Record<string, unknown>;
    const id = requiredText(rule.id, `rules.${index}.id`, 'ルールID', 64);
    if (!RULE_KEY.test(id) || ids.has(id)) {
      throw new ActionScoreRuleValidationError('rule_id_invalid', 'ルールIDは重複しない英数字にしてください', `rules.${index}.id`);
    }
    ids.add(id);
    const name = requiredText(rule.name, `rules.${index}.name`, 'ルール名', 100);
    const eventType = requiredText(rule.eventType, `rules.${index}.eventType`, 'きっかけ', 100);
    if (!EVENT_KEY.test(eventType)) {
      throw new ActionScoreRuleValidationError('event_type_invalid', 'きっかけの形式を確認してください', `rules.${index}.eventType`);
    }
    const source = rule.source == null || rule.source === ''
      ? null
      : requiredText(rule.source, `rules.${index}.source`, '出どころ', 100);
    if (source && !EVENT_KEY.test(source)) {
      throw new ActionScoreRuleValidationError('source_invalid', '出どころの形式を確認してください', `rules.${index}.source`);
    }
    if (rule.operation !== 'delta' && rule.operation !== 'set') {
      throw new ActionScoreRuleValidationError('operation_invalid', '効果は加減点または指定値を選んでください', `rules.${index}.operation`);
    }
    const valueNumber = Number(rule.value);
    if (!Number.isInteger(valueNumber)
      || (rule.operation === 'delta' && (valueNumber === 0 || Math.abs(valueNumber) > 1_000_000))
      || (rule.operation === 'set' && (valueNumber < bands.min || valueNumber > bands.max))) {
      throw new ActionScoreRuleValidationError('value_invalid', '点数を有効な整数で入力してください', `rules.${index}.value`);
    }
    if (!rule.frequency || typeof rule.frequency !== 'object' || Array.isArray(rule.frequency)) {
      throw new ActionScoreRuleValidationError('frequency_required', '回数制限を選んでください', `rules.${index}.frequency`);
    }
    const frequencyRaw = rule.frequency as Record<string, unknown>;
    const kind = frequencyRaw.kind as ActionScoreFrequencyKind;
    const limit = Number(frequencyRaw.limit ?? 1);
    if (!FREQUENCY_KINDS.has(kind) || !Number.isInteger(limit) || limit < 1 || limit > 1_000) {
      throw new ActionScoreRuleValidationError('frequency_invalid', '回数制限を確認してください', `rules.${index}.frequency`);
    }
    if (rule.sameSourceEventOnce !== true) {
      throw new ActionScoreRuleValidationError(
        'idempotency_required',
        '同じ元イベントは1回だけにしてください。この安全設定は外せません',
        `rules.${index}.sameSourceEventOnce`,
      );
    }
    const validFrom = optionalDate(rule.validFrom, `rules.${index}.validFrom`);
    const validUntil = optionalDate(rule.validUntil, `rules.${index}.validUntil`);
    if (validFrom && validUntil && new Date(validFrom) > new Date(validUntil)) {
      throw new ActionScoreRuleValidationError('period_invalid', '有効期間の開始と終了を確認してください', `rules.${index}.validUntil`);
    }
    return {
      id, name, eventType, source, operation: rule.operation, value: valueNumber,
      frequency: { kind, limit }, sameSourceEventOnce: true,
      validFrom, validUntil, enabled: rule.enabled !== false,
    };
  });
  return { rules, bands };
}

function parseVersion(row: VersionRow): ActionScoreRuleVersion {
  const bundle = validateActionScoreRuleBundle({
    rules: JSON.parse(row.rules_json) as unknown,
    bands: { min: row.min_score, max: row.max_score, normalMin: row.normal_min, highMin: row.high_min },
  });
  return {
    id: row.id,
    versionNumber: row.version_number,
    status: row.status,
    createdAt: row.created_at,
    publishedAt: row.published_at,
    ...bundle,
  };
}

async function getRuleSet(db: D1Database, lineAccountId: string): Promise<RuleSetRow | null> {
  return db.prepare(
    `SELECT id, line_account_id, status, current_draft_version_id, current_published_version_id
       FROM action_score_rule_sets WHERE line_account_id = ?`,
  ).bind(lineAccountId).first<RuleSetRow>();
}

async function getVersion(db: D1Database, id: string | null): Promise<ActionScoreRuleVersion | null> {
  if (!id) return null;
  const row = await db.prepare(
    `SELECT id, rule_set_id, version_number, status, rules_json, min_score, max_score,
            normal_min, high_min, created_at, published_at
       FROM action_score_rule_versions WHERE id = ?`,
  ).bind(id).first<VersionRow>();
  return row ? parseVersion(row) : null;
}

export async function getActionScoreRuleConfiguration(
  db: D1Database,
  lineAccountId: string,
): Promise<ActionScoreRuleConfiguration> {
  const owner = await getRuleSet(db, lineAccountId);
  if (!owner) {
    return {
      configured: false,
      status: 'not_configured',
      currentDraftVersionId: null,
      currentPublishedVersionId: null,
      editableVersion: {
        id: null, versionNumber: 1, status: 'draft', createdAt: null, publishedAt: null,
        ...defaultActionScoreRuleBundle(),
      },
      publishedVersion: null,
    };
  }
  const [draft, published] = await Promise.all([
    getVersion(db, owner.current_draft_version_id),
    getVersion(db, owner.current_published_version_id),
  ]);
  const editableVersion = draft ?? (published
    ? { ...published, id: null, versionNumber: published.versionNumber + 1, status: 'draft' as const, createdAt: null, publishedAt: null }
    : { id: null, versionNumber: 1, status: 'draft' as const, createdAt: null, publishedAt: null, ...defaultActionScoreRuleBundle() });
  return {
    configured: Boolean(published),
    status: owner.status,
    currentDraftVersionId: owner.current_draft_version_id,
    currentPublishedVersionId: owner.current_published_version_id,
    editableVersion,
    publishedVersion: published,
  };
}

export async function saveActionScoreRuleDraft(
  db: D1Database,
  input: {
    lineAccountId: string;
    expectedDraftVersionId?: string | null;
    configuration: unknown;
    createdBy?: string | null;
  },
): Promise<ActionScoreRuleConfiguration> {
  const bundle = validateActionScoreRuleBundle(input.configuration);
  const owner = await getRuleSet(db, input.lineAccountId);
  const now = new Date().toISOString();
  if (!owner) {
    if (input.expectedDraftVersionId) {
      throw new ActionScoreRuleValidationError('version_conflict', '別の人が下書きを作りました。再読み込みしてください');
    }
    const setId = crypto.randomUUID();
    const versionId = crypto.randomUUID();
    await db.batch([
      db.prepare(
        `INSERT INTO action_score_rule_sets
           (id, line_account_id, status, created_by, created_at, updated_at)
         VALUES (?, ?, 'draft', ?, ?, ?)`,
      ).bind(setId, input.lineAccountId, input.createdBy ?? null, now, now),
      db.prepare(
        `INSERT INTO action_score_rule_versions
           (id, rule_set_id, version_number, status, rules_json, min_score, max_score,
            normal_min, high_min, created_by, created_at)
         VALUES (?, ?, 1, 'draft', ?, ?, ?, ?, ?, ?, ?)`,
      ).bind(
        versionId, setId, JSON.stringify(bundle.rules), bundle.bands.min, bundle.bands.max,
        bundle.bands.normalMin, bundle.bands.highMin, input.createdBy ?? null, now,
      ),
      db.prepare(
        `UPDATE action_score_rule_sets SET current_draft_version_id = ? WHERE id = ?`,
      ).bind(versionId, setId),
    ]);
    return getActionScoreRuleConfiguration(db, input.lineAccountId);
  }

  if (owner.current_draft_version_id) {
    if (input.expectedDraftVersionId !== owner.current_draft_version_id) {
      throw new ActionScoreRuleValidationError('version_conflict', '編集中の版が変わりました。再読み込みしてください');
    }
    const results = await db.batch([
      db.prepare(
        `UPDATE action_score_rule_versions
            SET rules_json = ?, min_score = ?, max_score = ?, normal_min = ?, high_min = ?
          WHERE id = ? AND rule_set_id = ? AND status = 'draft'`,
      ).bind(
        JSON.stringify(bundle.rules), bundle.bands.min, bundle.bands.max,
        bundle.bands.normalMin, bundle.bands.highMin, owner.current_draft_version_id, owner.id,
      ),
      db.prepare(
        `UPDATE action_score_rule_sets SET updated_at = ?
          WHERE id = ? AND line_account_id = ? AND current_draft_version_id = ?`,
      ).bind(now, owner.id, input.lineAccountId, owner.current_draft_version_id),
    ]);
    if ((results[0].meta?.changes ?? 0) !== 1 || (results[1].meta?.changes ?? 0) !== 1) {
      throw new ActionScoreRuleValidationError('version_conflict', '編集中の版が変わりました。再読み込みしてください');
    }
    return getActionScoreRuleConfiguration(db, input.lineAccountId);
  }

  if (input.expectedDraftVersionId) {
    throw new ActionScoreRuleValidationError('version_conflict', '別の人が新版を作りました。再読み込みしてください');
  }
  const max = await db.prepare(
    `SELECT COALESCE(MAX(version_number), 0) AS value
       FROM action_score_rule_versions WHERE rule_set_id = ?`,
  ).bind(owner.id).first<{ value: number }>();
  const versionNumber = Number(max?.value ?? 0) + 1;
  const versionId = crypto.randomUUID();
  const results = await db.batch([
    db.prepare(
      `INSERT INTO action_score_rule_versions
         (id, rule_set_id, version_number, status, rules_json, min_score, max_score,
          normal_min, high_min, created_by, created_at)
       SELECT ?, id, ?, 'draft', ?, ?, ?, ?, ?, ?, ?
         FROM action_score_rule_sets
        WHERE id = ? AND line_account_id = ? AND current_draft_version_id IS NULL`,
    ).bind(
      versionId, versionNumber, JSON.stringify(bundle.rules), bundle.bands.min, bundle.bands.max,
      bundle.bands.normalMin, bundle.bands.highMin, input.createdBy ?? null, now,
      owner.id, input.lineAccountId,
    ),
    db.prepare(
      `UPDATE action_score_rule_sets SET current_draft_version_id = ?, updated_at = ?
        WHERE id = ? AND line_account_id = ? AND current_draft_version_id IS NULL`,
    ).bind(versionId, now, owner.id, input.lineAccountId),
  ]);
  if ((results[0].meta?.changes ?? 0) !== 1 || (results[1].meta?.changes ?? 0) !== 1) {
    throw new ActionScoreRuleValidationError('version_conflict', '別の人が新版を作りました。再読み込みしてください');
  }
  return getActionScoreRuleConfiguration(db, input.lineAccountId);
}

export async function publishActionScoreRuleDraft(
  db: D1Database,
  input: { lineAccountId: string; draftVersionId: string; publishedBy?: string | null },
): Promise<ActionScoreRuleConfiguration> {
  const owner = await getRuleSet(db, input.lineAccountId);
  if (!owner || owner.current_draft_version_id !== input.draftVersionId) {
    throw new ActionScoreRuleValidationError('version_conflict', '公開する下書きが変わりました。再読み込みしてください');
  }
  const draft = await getVersion(db, input.draftVersionId);
  if (!draft || draft.status !== 'draft') {
    throw new ActionScoreRuleValidationError('draft_not_found', '公開する下書きが見つかりません');
  }
  if (!draft.rules.some((rule) => rule.enabled)) {
    throw new ActionScoreRuleValidationError('enabled_rule_required', '動かすルールを1件以上選んでください', 'rules');
  }
  const now = new Date().toISOString();
  const results = await db.batch([
    db.prepare(
      `UPDATE action_score_rule_versions
          SET status = 'published', published_by = ?, published_at = ?
        WHERE id = ? AND rule_set_id = ? AND status = 'draft'`,
    ).bind(input.publishedBy ?? null, now, draft.id, owner.id),
    db.prepare(
      `UPDATE action_score_rule_sets
          SET status = 'published', current_draft_version_id = NULL,
              current_published_version_id = ?, updated_at = ?
        WHERE id = ? AND line_account_id = ? AND current_draft_version_id = ?`,
    ).bind(draft.id, now, owner.id, input.lineAccountId, draft.id),
  ]);
  if ((results[0].meta?.changes ?? 0) !== 1 || (results[1].meta?.changes ?? 0) !== 1) {
    throw new ActionScoreRuleValidationError('version_conflict', '公開直前に版が変わりました。再読み込みしてください');
  }
  return getActionScoreRuleConfiguration(db, input.lineAccountId);
}

export async function stopActionScoreRules(
  db: D1Database,
  lineAccountId: string,
): Promise<ActionScoreRuleConfiguration> {
  const result = await db.prepare(
    `UPDATE action_score_rule_sets SET status = 'stopped', updated_at = ?
      WHERE line_account_id = ? AND current_published_version_id IS NOT NULL`,
  ).bind(new Date().toISOString(), lineAccountId).run();
  if ((result.meta?.changes ?? 0) !== 1) {
    throw new ActionScoreRuleValidationError('published_version_required', '止める公開版がありません');
  }
  return getActionScoreRuleConfiguration(db, lineAccountId);
}

export function actionScoreBand(score: number, bands: ActionScoreBands): 'low' | 'normal' | 'high' {
  if (score >= bands.highMin) return 'high';
  if (score >= bands.normalMin) return 'normal';
  return 'low';
}

function applyRuleValue(score: number, rule: ActionScoreRule, bands: ActionScoreBands): number {
  const next = rule.operation === 'set' ? rule.value : score + rule.value;
  return Math.max(bands.min, Math.min(bands.max, next));
}

export function testActionScoreRuleBundle(
  bundleValue: unknown,
  input: { currentScore: number; eventType: string; source?: string | null; occurredAt?: string },
): {
  scoreBefore: number;
  scoreAfter: number;
  bandBefore: 'low' | 'normal' | 'high';
  bandAfter: 'low' | 'normal' | 'high';
  matched: Array<{ ruleId: string; ruleName: string; scoreBefore: number; scoreAfter: number }>;
} {
  const bundle = validateActionScoreRuleBundle(bundleValue);
  if (!Number.isInteger(input.currentScore)
    || input.currentScore < bundle.bands.min || input.currentScore > bundle.bands.max) {
    throw new ActionScoreRuleValidationError('current_score_invalid', 'テストする現在点を確認してください', 'currentScore');
  }
  const occurredAt = new Date(input.occurredAt ?? new Date().toISOString());
  if (Number.isNaN(occurredAt.getTime())) {
    throw new ActionScoreRuleValidationError('occurred_at_invalid', 'テストする発生日時を確認してください', 'occurredAt');
  }
  let score = input.currentScore;
  const matched: Array<{ ruleId: string; ruleName: string; scoreBefore: number; scoreAfter: number }> = [];
  for (const rule of bundle.rules) {
    if (!rule.enabled || rule.eventType !== input.eventType || (rule.source && rule.source !== input.source)) continue;
    if (rule.validFrom && occurredAt < new Date(rule.validFrom)) continue;
    if (rule.validUntil && occurredAt > new Date(rule.validUntil)) continue;
    const before = score;
    score = applyRuleValue(score, rule, bundle.bands);
    matched.push({ ruleId: rule.id, ruleName: rule.name, scoreBefore: before, scoreAfter: score });
  }
  return {
    scoreBefore: input.currentScore,
    scoreAfter: score,
    bandBefore: actionScoreBand(input.currentScore, bundle.bands),
    bandAfter: actionScoreBand(score, bundle.bands),
    matched,
  };
}

export async function getActionScoreBands(db: D1Database, lineAccountId: string): Promise<ActionScoreBands> {
  const config = await getActionScoreRuleConfiguration(db, lineAccountId);
  return { ...(config.publishedVersion ?? config.editableVersion).bands };
}

function localDayKey(occurredAt: string, timeZone: string): string {
  const date = new Date(occurredAt);
  if (Number.isNaN(date.getTime())) throw new ActionScoreRuleValidationError('occurred_at_invalid', '発生日時を確認してください');
  try {
    return new Intl.DateTimeFormat('en-CA', {
      timeZone, year: 'numeric', month: '2-digit', day: '2-digit',
    }).format(date);
  } catch {
    throw new ActionScoreRuleValidationError('account_timezone_invalid', 'LINEアカウントのタイムゾーンを確認してください');
  }
}

function frequencyKey(
  rule: ActionScoreRule,
  input: { subjectKey?: string | null; occurredAt: string },
  timeZone: string,
): string | null {
  if (rule.frequency.kind === 'unlimited') return null;
  const day = () => localDayKey(input.occurredAt, timeZone);
  if (rule.frequency.kind === 'per_day') return `day:${day()}`;
  if (!input.subjectKey) {
    throw new ActionScoreRuleValidationError('subject_key_required', `${rule.name}の対象IDがありません`);
  }
  if (rule.frequency.kind === 'per_subject') return `subject:${input.subjectKey}`;
  if (rule.frequency.kind === 'per_subject_per_day') return `subject:${input.subjectKey}:day:${day()}`;
  return `period:${input.subjectKey}`;
}

export interface ActionScoreApplication {
  historyId: string;
  ruleId: string;
  ruleVersionId: string;
  scoreBefore: number;
  scoreAfter: number;
  bandBefore: 'low' | 'normal' | 'high';
  bandAfter: 'low' | 'normal' | 'high';
  replayed: boolean;
}

export async function applyPublishedActionScoreRules(
  db: D1Database,
  input: {
    lineAccountId: string;
    friendId: string;
    eventType: string;
    source: string;
    sourceEventId: string;
    subjectKey?: string | null;
    occurredAt: string;
  },
): Promise<{ configured: boolean; status: 'legacy' | ActionScoreRuleSetStatus; applications: ActionScoreApplication[] }> {
  if (!input.lineAccountId || !input.friendId || !input.eventType || !input.source || !input.sourceEventId) {
    return { configured: false, status: 'legacy', applications: [] };
  }
  const owner = await getRuleSet(db, input.lineAccountId);
  if (!owner?.current_published_version_id) {
    return { configured: false, status: 'legacy', applications: [] };
  }
  if (owner.status !== 'published') {
    return { configured: true, status: owner.status, applications: [] };
  }
  const version = await getVersion(db, owner.current_published_version_id);
  if (!version || version.status !== 'published') {
    throw new ActionScoreRuleValidationError('published_version_missing', '公開中のスコアルール版が見つかりません');
  }
  const friend = await db.prepare(
    `SELECT f.id, COALESCE(f.score, 0) AS score, COALESCE(a.timezone, 'Asia/Tokyo') AS timezone
       FROM friends f JOIN line_accounts a ON a.id = f.line_account_id
      WHERE f.id = ? AND f.line_account_id = ?`,
  ).bind(input.friendId, input.lineAccountId).first<{ id: string; score: number; timezone: string }>();
  if (!friend) throw new ActionScoreRuleValidationError('friend_not_found', '対象の友だちが見つかりません');
  const occurredAt = new Date(input.occurredAt);
  if (Number.isNaN(occurredAt.getTime())) {
    throw new ActionScoreRuleValidationError('occurred_at_invalid', '発生日時を確認してください');
  }
  const applications: ActionScoreApplication[] = [];
  for (const rule of version.rules) {
    if (!rule.enabled || rule.eventType !== input.eventType || (rule.source && rule.source !== input.source)) continue;
    if (rule.validFrom && occurredAt < new Date(rule.validFrom)) continue;
    if (rule.validUntil && occurredAt > new Date(rule.validUntil)) continue;
    const ruleFrequencyKey = frequencyKey(rule, input, friend.timezone);
    const idempotencyKey = `action-score:${rule.id}:${input.source}:${input.sourceEventId}`;
    const historyId = crypto.randomUUID();
    const createdAt = new Date().toISOString();
    const result = await db.prepare(
       `WITH target AS (
         SELECT id, COALESCE(score, 0) AS score_before FROM friends
          WHERE id = ? AND line_account_id = ?
            AND (? IS NULL OR (
              SELECT COUNT(*) FROM friend_scores
               WHERE line_account_id = ? AND friend_id = ? AND rule_key = ? AND frequency_key = ?
            ) < ?)
       ), calculated AS (
         SELECT id, score_before,
                MAX(?, MIN(?, CASE WHEN ? = 'set' THEN ? ELSE score_before + ? END)) AS score_after
           FROM target
       )
       INSERT OR IGNORE INTO friend_scores
         (id, friend_id, scoring_rule_id, score_change, reason, created_at,
          line_account_id, event_type, source, source_event_id, subject_key, frequency_key,
          rule_key, rule_version_id, idempotency_key, operation, score_before, score_after, occurred_at)
       SELECT ?, id, NULL, score_after - score_before, ?, ?,
              ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, score_before, score_after, ?
         FROM calculated`,
    ).bind(
      input.friendId, input.lineAccountId,
      ruleFrequencyKey, input.lineAccountId, input.friendId, rule.id, ruleFrequencyKey, rule.frequency.limit,
      version.bands.min, version.bands.max, rule.operation, rule.value, rule.value,
      historyId, `${input.eventType} → ${rule.name}`, createdAt,
      input.lineAccountId, input.eventType, input.source, input.sourceEventId,
      input.subjectKey ?? null, ruleFrequencyKey, rule.id, version.id,
      idempotencyKey, rule.operation, input.occurredAt,
    ).run();
    const row = await db.prepare(
      `SELECT id, score_before, score_after FROM friend_scores
        WHERE line_account_id = ? AND idempotency_key = ?`,
    ).bind(input.lineAccountId, idempotencyKey).first<{ id: string; score_before: number; score_after: number }>();
    if (!row) {
      // 同時に別イベントが入って上限へ達した場合も、超過分は静かに止める。
      if (ruleFrequencyKey && (result.meta?.changes ?? 0) === 0) {
        const count = await db.prepare(
          `SELECT COUNT(*) AS value FROM friend_scores
            WHERE line_account_id = ? AND friend_id = ? AND rule_key = ? AND frequency_key = ?`,
        ).bind(input.lineAccountId, input.friendId, rule.id, ruleFrequencyKey).first<{ value: number }>();
        if (Number(count?.value ?? 0) >= rule.frequency.limit) continue;
      }
      throw new ActionScoreRuleValidationError('score_write_failed', 'スコア履歴を保存できませんでした');
    }
    applications.push({
      historyId: row.id,
      ruleId: rule.id,
      ruleVersionId: version.id!,
      scoreBefore: row.score_before,
      scoreAfter: row.score_after,
      bandBefore: actionScoreBand(row.score_before, version.bands),
      bandAfter: actionScoreBand(row.score_after, version.bands),
      replayed: (result.meta?.changes ?? 0) === 0,
    });
  }
  return { configured: true, status: owner.status, applications };
}

export async function processActionScoreInactivity(
  db: D1Database,
  options: { now?: string; limit?: number } = {},
): Promise<{
  candidates: number;
  applied: number;
  transitions: Array<{ lineAccountId: string; friendId: string; applications: ActionScoreApplication[] }>;
}> {
  const now = new Date(options.now ?? new Date().toISOString());
  if (Number.isNaN(now.getTime())) throw new ActionScoreRuleValidationError('now_invalid', '基準日時を確認してください');
  const cutoff = new Date(now.getTime() - 30 * 24 * 60 * 60_000).toISOString();
  const limit = Math.max(1, Math.min(options.limit ?? 200, 500));
  const rows = await db.prepare(
    `WITH latest AS (
       SELECT f.id AS friend_id, f.line_account_id,
              COALESCE(MAX(ee.occurred_at), f.created_at) AS last_activity_at
         FROM friends f
         JOIN action_score_rule_sets s
           ON s.line_account_id = f.line_account_id
          AND s.status = 'published' AND s.current_published_version_id IS NOT NULL
         JOIN action_score_rule_versions v
           ON v.id = s.current_published_version_id AND v.status = 'published'
         LEFT JOIN engagement_events ee
           ON COALESCE(ee.actor_friend_id, ee.subject_friend_id) = f.id
        WHERE f.is_following = 1
          AND v.rules_json LIKE '%"eventType":"inactivity_30d"%'
        GROUP BY f.id, f.line_account_id, f.created_at
     )
     SELECT friend_id, line_account_id, last_activity_at
       FROM latest WHERE datetime(last_activity_at) <= datetime(?)
      ORDER BY last_activity_at ASC LIMIT ?`,
  ).bind(cutoff, limit).all<{ friend_id: string; line_account_id: string; last_activity_at: string }>();
  let applied = 0;
  const transitions: Array<{ lineAccountId: string; friendId: string; applications: ActionScoreApplication[] }> = [];
  for (const row of rows.results ?? []) {
    const result = await applyPublishedActionScoreRules(db, {
      lineAccountId: row.line_account_id,
      friendId: row.friend_id,
      eventType: 'inactivity_30d',
      source: 'scheduler',
      sourceEventId: `inactivity:${row.friend_id}:${row.last_activity_at}`,
      subjectKey: row.last_activity_at,
      occurredAt: now.toISOString(),
    });
    applied += result.applications.filter((item) => !item.replayed).length;
    if (result.applications.some((item) => !item.replayed && item.bandBefore !== item.bandAfter)) {
      transitions.push({
        lineAccountId: row.line_account_id,
        friendId: row.friend_id,
        applications: result.applications,
      });
    }
  }
  return { candidates: rows.results?.length ?? 0, applied, transitions };
}

export async function getActionScoreReconciliationIssues(
  db: D1Database,
  lineAccountId: string,
  limit = 100,
): Promise<Array<{ friendId: string; currentScore: number; expectedScore: number; lastHistoryId: string }>> {
  const result = await db.prepare(
    `WITH latest AS (
       SELECT fs.friend_id, fs.id, fs.score_after,
              ROW_NUMBER() OVER (PARTITION BY fs.friend_id ORDER BY fs.created_at DESC, fs.id DESC) AS position
         FROM friend_scores fs
        WHERE fs.line_account_id = ? AND fs.score_after IS NOT NULL
     )
     SELECT f.id AS friend_id, COALESCE(f.score, 0) AS current_score,
            latest.score_after AS expected_score, latest.id AS history_id
       FROM latest JOIN friends f ON f.id = latest.friend_id AND f.line_account_id = ?
      WHERE latest.position = 1 AND COALESCE(f.score, 0) <> latest.score_after
      ORDER BY f.id LIMIT ?`,
  ).bind(lineAccountId, lineAccountId, Math.max(1, Math.min(limit, 500))).all<{
    friend_id: string; current_score: number; expected_score: number; history_id: string;
  }>();
  return (result.results ?? []).map((row) => ({
    friendId: row.friend_id,
    currentScore: row.current_score,
    expectedScore: row.expected_score,
    lastHistoryId: row.history_id,
  }));
}
