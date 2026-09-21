import { DEFAULT_TENANT_ID } from '@line-crm/shared';
import { jstNow } from './utils.js';
import { resolveConversionPointTenantId } from './conversions.js';
import { encryptWebhookSecret, resolveWebhookSecret, type WebhookKeyInput } from './webhooks.js';

export type ConversionDefinitionStatus = 'active' | 'stopped' | 'draft';
/**
 * N-268: 画面で区別する成果地点の状態。status 列そのものではなく、
 * 設定の壊れ(入力不良)や外部受信の停止(起点停止)も含めて導出する。
 *
 * - draft          : 作成だけして公開していない。計測には乗らない。
 * - stopped        : 運用者が止めた。
 * - invalid        : 計測中扱いだが設定が足りず、実際には数えられない。
 * - sourceStopped  : 地点は計測中だが、外部からの受信(起点)を止めている。
 * - active         : 上のどれにも当たらない、実際に計測できる状態。
 */
export type ConversionDefinitionState = 'active' | 'draft' | 'stopped' | 'invalid' | 'sourceStopped';
/** `state` クエリで追加で受ける、状態と直交する絞り込み。 */
export type ConversionDefinitionFilter = ConversionDefinitionState | 'unused';
export type ConversionDefinitionSort = 'count_desc' | 'value_desc' | 'updated_desc' | 'name_asc';
export type ConversionDeduplicationMode = 'every' | 'once_per_friend' | 'window';
export type ConversionValueMode = 'source' | 'fixed' | 'none';
export type ConversionReversalPolicy = 'source_cancelled' | 'manual' | 'none';
export type ConversionDefinitionUsageKind =
  | 'affiliate_offer'
  | 'analytics'
  | 'auto_reply'
  | 'scenario'
  | 'nen_campaign'
  | 'mileage_rule'
  | 'automation'
  | 'ad_platform';

export const CONVERSION_DEFINITION_USAGE_KINDS: readonly ConversionDefinitionUsageKind[] = [
  'affiliate_offer',
  'analytics',
  'auto_reply',
  'scenario',
  'nen_campaign',
  'mileage_rule',
  'automation',
  'ad_platform',
];

export type ConversionDefinitionScope = {
  allowedAccountIds: readonly string[];
  includeUnassigned: boolean;
};

export type ConversionDefinitionRange = {
  from: string;
  to: string;
  timeZone: 'Asia/Tokyo';
};

export type ConversionDefinitionListInput = {
  scope: ConversionDefinitionScope;
  lineAccountId?: string;
  query?: string;
  status?: ConversionDefinitionStatus;
  /** N-268: 導出した状態での絞り込み。status よりこちらが正確。 */
  state?: ConversionDefinitionFilter;
  sourceType?: string;
  range: ConversionDefinitionRange;
  cursor: number;
  limit: number;
  sort: ConversionDefinitionSort;
};

export type ConversionDefinitionUsage = {
  id: string;
  conversionPointId: string;
  definitionVersion: number;
  lineAccountId: string;
  refKind: ConversionDefinitionUsageKind;
  refId: string;
  refVersionId: string | null;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
  /** 表示用の利用先名。参照先が未解決の場合はIDを返す。 */
  usageName: string;
};

export type ConversionDefinitionListItem = {
  id: string;
  name: string;
  sourceType: string;
  value: number | null;
  measureMethod: string;
  targetUrl: string | null;
  countRepeat: boolean;
  attributionDays: number | null;
  sourceConfig: Record<string, unknown>;
  deduplicationMode: ConversionDeduplicationMode;
  deduplicationWindowDays: number | null;
  valueMode: ConversionValueMode;
  reversalPolicy: ConversionReversalPolicy;
  lineAccountId: string | null;
  status: ConversionDefinitionStatus;
  /** N-268: 画面表示用の導出状態。 */
  state: ConversionDefinitionState;
  /** 入力不良・起点停止のとき、直すべき中身を運用者の言葉で返す。 */
  stateReason: string | null;
  /** N-270: 外部受信の設定状況。秘密値そのものは絶対に返さない。 */
  ingest: { configured: boolean; disabledAt: string | null };
  version: number;
  usageCount: number;
  usageNames: string[];
  metrics: {
    recordedCount: number;
    netCount: number;
    reversedCount: number | null;
    netValue: number;
    reversalState: 'available' | 'unavailable';
    reversalReason: string;
    cancellationCount: number | null;
    cancellationValue: number | null;
  };
  stoppedAt: string | null;
  createdAt: string;
  updatedAt: string;
};

type DefinitionRow = {
  id: string;
  name: string;
  event_type: string;
  value: number | null;
  measure_method: string;
  target_url: string | null;
  count_repeat: number;
  attribution_days: number | null;
  source_config_json: string;
  deduplication_mode: ConversionDeduplicationMode;
  deduplication_window_days: number | null;
  value_mode: ConversionValueMode;
  reversal_policy: ConversionReversalPolicy;
  line_account_id: string | null;
  status: ConversionDefinitionStatus;
  version: number;
  stopped_at: string | null;
  created_at: string;
  updated_at: string;
  ingest_secret_encrypted: string | null;
  ingest_disabled_at: string | null;
  recorded_count: number;
  net_value: number;
  usage_count: number;
};

type UsageRow = {
  id: string;
  conversion_point_id: string;
  definition_version: number;
  line_account_id: string;
  ref_kind: ConversionDefinitionUsageKind;
  ref_id: string;
  ref_version_id: string | null;
  created_by: string;
  created_at: string;
  updated_at: string;
};

function usageName(row: { ref_kind: ConversionDefinitionUsageKind; ref_id: string }): string {
  const labels: Record<ConversionDefinitionUsageKind, string> = {
    affiliate_offer: '案件', analytics: '分析', auto_reply: '自動応答', scenario: 'シナリオ',
    nen_campaign: 'NEN配信', mileage_rule: 'マイル', automation: 'オートメーション', ad_platform: '広告連携',
  };
  return `${labels[row.ref_kind] ?? '利用先'}（${row.ref_id}）`;
}

export class ConversionDefinitionError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly status: 400 | 404 | 409 = 409,
  ) {
    super(message);
    this.name = 'ConversionDefinitionError';
  }
}

/**
 * 利用先の実在確認(N-258)。
 *
 * `ref_kind` ごとの参照表を決め打ちし、存在しないIDや別アカウントの
 * オブジェクトを利用先として保存させない。画面が出す候補と同じ台帳を
 * サーバー側でも確かめる。アカウント列を持たない参照(NEN配信)は
 * アカウントに属さない共通設定なので、存在だけを見る。
 */
const USAGE_REF_CHECKS: Record<ConversionDefinitionUsageKind, { sql: string; accountScoped: boolean }> = {
  affiliate_offer: { sql: `SELECT id FROM affiliate_offers WHERE id = ? AND (line_account_id IS NULL OR line_account_id = ?)`, accountScoped: true },
  analytics: { sql: `SELECT id FROM funnels WHERE id = ? AND (line_account_id IS NULL OR line_account_id = ?)`, accountScoped: true },
  auto_reply: { sql: `SELECT id FROM auto_replies WHERE id = ? AND (line_account_id IS NULL OR line_account_id = ?)`, accountScoped: true },
  scenario: { sql: `SELECT id FROM scenarios WHERE id = ? AND (line_account_id IS NULL OR line_account_id = ?)`, accountScoped: true },
  nen_campaign: { sql: `SELECT campaign_key AS id FROM nen_campaign_settings WHERE campaign_key = ?`, accountScoped: false },
  mileage_rule: { sql: `SELECT id FROM mileage_rules WHERE id = ? AND (line_account_id IS NULL OR line_account_id = ?)`, accountScoped: true },
  automation: { sql: `SELECT id FROM automations WHERE id = ? AND (line_account_id IS NULL OR line_account_id = ?)`, accountScoped: true },
  ad_platform: { sql: `SELECT id FROM ad_platforms WHERE id = ? AND (line_account_id IS NULL OR line_account_id = ?)`, accountScoped: true },
};

async function assertUsageRefExists(
  db: D1Database,
  usage: { refKind: ConversionDefinitionUsageKind; refId: string },
  lineAccountId: string,
): Promise<void> {
  const check = USAGE_REF_CHECKS[usage.refKind];
  const binds = check.accountScoped ? [usage.refId, lineAccountId] : [usage.refId];
  const found = await db.prepare(check.sql).bind(...binds).first<{ id: string }>();
  if (!found) {
    throw new ConversionDefinitionError(
      'usage_ref_not_found',
      '利用先が見つかりません。消えた・別のアカウントの利用先は選べません。一覧を読み直してください',
      400,
    );
  }
}

function accountWhere(
  alias: string,
  scope: ConversionDefinitionScope,
  requested: string | undefined,
): { sql: string; values: unknown[] } {
  const column = `${alias}line_account_id`;
  if (requested) {
    return {
      sql: `(${column} = ?${scope.includeUnassigned ? ` OR ${column} IS NULL` : ''})`,
      values: [requested],
    };
  }
  if (scope.allowedAccountIds.length > 0) {
    return {
      sql: `(${column} IN (${scope.allowedAccountIds.map(() => '?').join(',')})${scope.includeUnassigned ? ` OR ${column} IS NULL` : ''})`,
      values: [...scope.allowedAccountIds],
    };
  }
  return { sql: scope.includeUnassigned ? `${column} IS NULL` : '1 = 0', values: [] };
}

/**
 * N-268: 「入力不良」の SQL 条件。作成口では弾いているが、旧口
 * (/api/conversions/points) や途中の版で欠けた設定が残り得る。
 * ここで導出しないと「計測中」と出ながら実際には数えられない行が
 * 埋もれる。
 */
const INVALID_CONFIG_SQL = `(
  (cp.measure_method = 'url_reach' AND (cp.target_url IS NULL OR cp.target_url = ''))
  OR (cp.value_mode = 'fixed' AND cp.value IS NULL)
  OR (cp.deduplication_mode = 'window' AND (cp.deduplication_window_days IS NULL
    OR cp.deduplication_window_days < 1 OR cp.deduplication_window_days > 365))
)`;

/** N-270: 「起点停止」= 地点は動いているが外部受信を明示的に止めている。 */
const SOURCE_STOPPED_SQL = `(cp.measure_method = 'webhook' AND cp.ingest_disabled_at IS NOT NULL)`;

/** N-267: 「どこからも使われていない」は利用先台帳の不存在で判定する。 */
const UNUSED_SQL = `NOT EXISTS (SELECT 1 FROM conversion_definition_usages u WHERE u.conversion_point_id = cp.id)`;

/**
 * N-268: state 絞り込みを SQL へそのまま落とす。導出状態の並びは
 * serializeDefinition 側の deriveDefinitionState と必ず一致させる。
 */
function stateFilterSql(state: ConversionDefinitionFilter): string {
  switch (state) {
    case 'draft': return `cp.status = 'draft'`;
    case 'stopped': return `cp.status = 'stopped'`;
    case 'invalid': return `cp.status = 'active' AND ${INVALID_CONFIG_SQL}`;
    case 'sourceStopped': return `cp.status = 'active' AND ${SOURCE_STOPPED_SQL}`;
    case 'unused': return UNUSED_SQL;
    default:
      // 「動いている」は入力不良・起点停止を除いた実際に計測できる行だけ。
      return `cp.status = 'active' AND NOT ${INVALID_CONFIG_SQL} AND NOT ${SOURCE_STOPPED_SQL}`;
  }
}

function definitionWhere(
  input: Pick<ConversionDefinitionListInput, 'scope' | 'lineAccountId' | 'query' | 'status' | 'sourceType' | 'state'>,
  includeState = true,
): { sql: string; values: unknown[] } {
  const account = accountWhere('cp.', input.scope, input.lineAccountId);
  const clauses = [account.sql];
  const values = [...account.values];
  const query = input.query?.trim();
  if (query) {
    clauses.push('cp.name LIKE ? ESCAPE \'\\\'');
    values.push(`%${query.replaceAll('\\', '\\\\').replaceAll('%', '\\%').replaceAll('_', '\\_')}%`);
  }
  if (includeState && input.state) {
    clauses.push(stateFilterSql(input.state));
  } else if (includeState && input.status) {
    clauses.push('cp.status = ?');
    values.push(input.status);
  }
  if (input.sourceType?.trim()) {
    clauses.push('cp.event_type = ?');
    values.push(input.sourceType.trim());
  }
  return { sql: clauses.join(' AND '), values };
}

function metricsCte(range: ConversionDefinitionRange): { sql: string; values: unknown[] } {
  return {
    sql: `WITH period_metrics AS (
      SELECT conversion_point_id,
             COUNT(*) AS recorded_count,
             COALESCE(SUM(COALESCE(value_snapshot, 0)), 0) AS net_value
        FROM conversion_events
       -- N-269: created_at は JST ISO(T付き)と datetime() 書式が混在する。
       -- 文字列の大小比較だと 'T' > ' ' で期間末のISO行が抜けるため、
       -- 保存されたJST暦日の先頭10文字で日単位に比較する。
       WHERE substr(created_at, 1, 10) >= ? AND substr(created_at, 1, 10) <= ?
       GROUP BY conversion_point_id
    ), usage_counts AS (
      SELECT conversion_point_id, COUNT(*) AS usage_count
        FROM conversion_definition_usages
       GROUP BY conversion_point_id
    )`,
    // 暦日の先頭10文字(YYYY-MM-DD)で比較する。時刻・書式差を含めない。
    values: [range.from.slice(0, 10), range.to.slice(0, 10)],
  };
}

function selectDefinitionsSql(): string {
  return `SELECT cp.id, cp.name, cp.event_type, cp.value, cp.measure_method, cp.target_url,
                 cp.count_repeat, cp.attribution_days, cp.source_config_json,
                 cp.deduplication_mode, cp.deduplication_window_days, cp.value_mode,
                 cp.reversal_policy, cp.line_account_id, cp.status,
                 cp.version, cp.stopped_at, cp.created_at, cp.updated_at,
                 cp.ingest_secret_encrypted, cp.ingest_disabled_at,
                 COALESCE(pm.recorded_count, 0) AS recorded_count,
                 COALESCE(pm.net_value, 0) AS net_value,
                 COALESCE(uc.usage_count, 0) AS usage_count
            FROM conversion_points cp
       LEFT JOIN period_metrics pm ON pm.conversion_point_id = cp.id
       LEFT JOIN usage_counts uc ON uc.conversion_point_id = cp.id`;
}

function orderBy(sort: ConversionDefinitionSort): string {
  if (sort === 'value_desc') return 'cp.value DESC, cp.updated_at DESC, cp.id ASC';
  if (sort === 'name_asc') return 'cp.name ASC, cp.id ASC';
  if (sort === 'updated_desc') return 'cp.updated_at DESC, cp.id ASC';
  return 'recorded_count DESC, cp.updated_at DESC, cp.id ASC';
}

type CancellationMetric = { count: number; value: number };

async function cancellationMetrics(db: D1Database, from: string, to: string): Promise<Map<string, CancellationMetric>> {
  const tables = await db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name IN ('affiliate_adjustments','affiliate_reward_entries')").all<{ name: string }>();
  if (tables.results.length < 2) return new Map();
  const rows = await db.prepare(`SELECT ce.conversion_point_id,
      COUNT(*) AS cancellation_count,
      COALESCE(SUM(ABS(aa.amount_minor)), 0) AS cancellation_value
    FROM affiliate_adjustments aa
    JOIN affiliate_reward_entries re ON re.id = aa.source_entry_id
    JOIN conversion_events ce ON ce.id = re.conversion_event_id
    WHERE aa.reason_type = 'cancel'
      AND substr(aa.created_at, 1, 10) >= ? AND substr(aa.created_at, 1, 10) <= ?
    GROUP BY ce.conversion_point_id`).bind(from.slice(0, 10), to.slice(0, 10)).all<{ conversion_point_id: string; cancellation_count: number; cancellation_value: number }>();
  return new Map(rows.results.map((row) => [row.conversion_point_id, { count: Number(row.cancellation_count), value: Number(row.cancellation_value) }]));
}

/**
 * N-268: 表示状態の導出。stateFilterSql と同じ優先順で決める。
 * 入力不良は「何が足りないか」を reason へ入れて、詳細画面がそのまま
 * 直す場所を示せるようにする。
 */
export function deriveDefinitionState(row: Pick<DefinitionRow,
  'status' | 'measure_method' | 'target_url' | 'value' | 'value_mode'
  | 'deduplication_mode' | 'deduplication_window_days' | 'ingest_disabled_at'>
): { state: ConversionDefinitionState; stateReason: string | null } {
  if (row.status === 'draft') {
    return { state: 'draft', stateReason: 'まだ公開していません。公開するまで計測しません' };
  }
  if (row.status === 'stopped') {
    return { state: 'stopped', stateReason: null };
  }
  if (row.measure_method === 'url_reach' && !row.target_url) {
    return { state: 'invalid', stateReason: '到達URLが決まっていません' };
  }
  if (row.value_mode === 'fixed' && row.value === null) {
    return { state: 'invalid', stateReason: '1件あたりの金額が決まっていません' };
  }
  if (row.deduplication_mode === 'window'
    && (row.deduplication_window_days === null || row.deduplication_window_days < 1 || row.deduplication_window_days > 365)) {
    return { state: 'invalid', stateReason: '数えない日数が正しくありません' };
  }
  if (row.measure_method === 'webhook' && row.ingest_disabled_at) {
    return { state: 'sourceStopped', stateReason: '外部からの受信を止めています' };
  }
  return { state: 'active', stateReason: null };
}

function serializeDefinition(row: DefinitionRow, cancellation?: CancellationMetric): ConversionDefinitionListItem {
  const derived = deriveDefinitionState(row);
  return {
    id: row.id,
    name: row.name,
    sourceType: row.event_type,
    value: row.value,
    measureMethod: row.measure_method,
    targetUrl: row.target_url,
    countRepeat: row.count_repeat !== 0,
    attributionDays: row.attribution_days,
    sourceConfig: JSON.parse(row.source_config_json || '{}') as Record<string, unknown>,
    deduplicationMode: row.deduplication_mode,
    deduplicationWindowDays: row.deduplication_window_days,
    valueMode: row.value_mode,
    reversalPolicy: row.reversal_policy,
    lineAccountId: row.line_account_id,
    status: row.status,
    state: derived.state,
    stateReason: derived.stateReason,
    ingest: {
      configured: row.ingest_secret_encrypted !== null && row.ingest_secret_encrypted !== undefined,
      disabledAt: row.ingest_disabled_at,
    },
    version: row.version,
    usageCount: Number(row.usage_count),
    usageNames: [],
    metrics: {
      recordedCount: Number(row.recorded_count),
      netCount: Number(row.recorded_count),
      reversedCount: cancellation?.count ?? null,
      netValue: Number(row.net_value) - (cancellation?.value ?? 0),
      reversalState: cancellation ? 'available' : 'unavailable',
      reversalReason: cancellation ? '取消イベント台帳から集計' : '取消イベント台帳はまだ接続されていません',
      cancellationCount: cancellation?.count ?? null,
      cancellationValue: cancellation?.value ?? null,
    },
    stoppedAt: row.stopped_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function serializeUsage(row: UsageRow): ConversionDefinitionUsage {
  return {
    id: row.id,
    conversionPointId: row.conversion_point_id,
    definitionVersion: Number(row.definition_version),
    lineAccountId: row.line_account_id,
    refKind: row.ref_kind,
    refId: row.ref_id,
    refVersionId: row.ref_version_id,
    createdBy: row.created_by,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    usageName: usageName(row),
  };
}

export async function listConversionDefinitions(db: D1Database, input: ConversionDefinitionListInput) {
  const cte = metricsCte(input.range);
  const where = definitionWhere(input);
  const stateWhere = definitionWhere(input, false);
  const limit = Math.min(100, Math.max(1, input.limit));
  const cursor = Math.max(0, input.cursor);

  const [rows, totalRow, stateRows] = await Promise.all([
    db.prepare(`${cte.sql}
      ${selectDefinitionsSql()}
       WHERE ${where.sql}
       ORDER BY ${orderBy(input.sort)}
       LIMIT ? OFFSET ?`)
      .bind(...cte.values, ...where.values, limit, cursor)
      .all<DefinitionRow>(),
    db.prepare(`SELECT COUNT(*) AS total FROM conversion_points cp WHERE ${where.sql}`)
      .bind(...where.values)
      .first<{ total: number }>(),
    /*
     * N-267/N-268: 状態の内訳は「絞り込み全体」から導出する。表示頁の行だけ
     * 数えると打ち切りでずれるため、状態判定に足りる列だけを全件ぶん引いて
     * JS で数える(件数は成果地点数なので実用上の上限内に収まる)。
     */
    db.prepare(`SELECT cp.status, cp.measure_method, cp.target_url, cp.value,
                       cp.value_mode, cp.deduplication_mode, cp.deduplication_window_days,
                       cp.ingest_disabled_at,
                       EXISTS(SELECT 1 FROM conversion_definition_usages u
                               WHERE u.conversion_point_id = cp.id) AS has_usage
                  FROM conversion_points cp
                 WHERE ${stateWhere.sql}`)
      .bind(...stateWhere.values)
      .all<Pick<DefinitionRow, 'status' | 'measure_method' | 'target_url' | 'value' | 'value_mode'
        | 'deduplication_mode' | 'deduplication_window_days' | 'ingest_disabled_at'>
        & { has_usage: number }>(),
  ]);
  const total = Number(totalRow?.total ?? 0);
  const cancellations = await cancellationMetrics(db, input.range.from, input.range.to);
  const stateCounts = { active: 0, draft: 0, stopped: 0, invalid: 0, sourceStopped: 0, unused: 0 };
  for (const row of stateRows.results) {
    stateCounts[deriveDefinitionState(row).state] += 1;
    if (!row.has_usage) stateCounts.unused += 1;
  }
  const usages = rows.results.length === 0 ? [] : (await db.prepare(`SELECT * FROM conversion_definition_usages WHERE conversion_point_id IN (${rows.results.map(() => '?').join(',')}) ORDER BY created_at DESC, id ASC`).bind(...rows.results.map((row) => row.id)).all<UsageRow>()).results;
  const namesByPoint = new Map<string, string[]>();
  for (const usage of usages) {
    const names = namesByPoint.get(usage.conversion_point_id) ?? [];
    names.push(usageName(usage));
    namesByPoint.set(usage.conversion_point_id, names);
  }
  return {
    items: rows.results.map((row) => ({ ...serializeDefinition(row, cancellations.get(row.id)), usageNames: namesByPoint.get(row.id) ?? [] })),
    stateCounts,
    range: input.range,
    pagination: {
      total,
      limit,
      cursor: String(cursor),
      nextCursor: cursor + limit < total ? String(cursor + limit) : null,
    },
  };
}

export async function getConversionDefinitionDetail(
  db: D1Database,
  id: string,
  scope: ConversionDefinitionScope,
) {
  const account = accountWhere('cp.', scope, undefined);
  const row = await db.prepare(`
    WITH period_metrics AS (
      SELECT conversion_point_id, COUNT(*) AS recorded_count,
             COALESCE(SUM(COALESCE(value_snapshot, 0)), 0) AS net_value
        FROM conversion_events GROUP BY conversion_point_id
    ), usage_counts AS (
      SELECT conversion_point_id, COUNT(*) AS usage_count
        FROM conversion_definition_usages GROUP BY conversion_point_id
    )
    ${selectDefinitionsSql()}
     WHERE cp.id = ? AND ${account.sql}`)
    .bind(id, ...account.values)
    .first<DefinitionRow>();
  if (!row) return null;
  const cancellation = (await cancellationMetrics(db, '0000-01-01', '9999-12-31')).get(row.id);
  const usages = await db.prepare(`SELECT * FROM conversion_definition_usages
    WHERE conversion_point_id = ? ORDER BY created_at DESC, id ASC`)
    .bind(id)
    .all<UsageRow>();
  return {
    ...serializeDefinition(row, cancellation),
    currentVersion: {
      id: `${row.id}:v${row.version}`,
      number: row.version,
      sourceType: row.event_type,
      measureMethod: row.measure_method,
      targetUrl: row.target_url,
      countRepeat: row.count_repeat !== 0,
      fixedValue: row.value,
      attributionDays: row.attribution_days,
      publishedAt: row.created_at,
    },
    usages: usages.results.map(serializeUsage),
    usageNames: usages.results.map(serializeUsage).map((usage) => usage.usageName),
  };
}

export type AddConversionDefinitionUsageInput = {
  conversionPointId: string;
  lineAccountId: string;
  expectedVersion: number;
  refKind: ConversionDefinitionUsageKind;
  refId: string;
  refVersionId?: string | null;
  staffId: string;
};

async function getCurrentMatchingUsage(
  db: D1Database,
  input: AddConversionDefinitionUsageInput,
): Promise<UsageRow | null> {
  return db.prepare(`SELECT u.* FROM conversion_definition_usages u
    JOIN conversion_points cp ON cp.id = u.conversion_point_id
    WHERE u.conversion_point_id = ? AND u.line_account_id = ? AND u.ref_kind = ? AND u.ref_id = ?
      AND COALESCE(u.ref_version_id, '') = COALESCE(?, '')
      AND cp.version = ? AND cp.status = 'active'
      AND (cp.line_account_id IS NULL OR cp.line_account_id = ?)`)
    .bind(
      input.conversionPointId,
      input.lineAccountId,
      input.refKind,
      input.refId,
      input.refVersionId ?? null,
      input.expectedVersion,
      input.lineAccountId,
    )
    .first<UsageRow>();
}

async function throwLatestUsageConflict(
  db: D1Database,
  input: AddConversionDefinitionUsageInput,
): Promise<never> {
  const latest = await db.prepare('SELECT version, status, line_account_id FROM conversion_points WHERE id = ?')
    .bind(input.conversionPointId)
    .first<{ version: number; status: ConversionDefinitionStatus; line_account_id: string | null }>();
  if (!latest || (latest.line_account_id !== null && latest.line_account_id !== input.lineAccountId)) {
    throw new ConversionDefinitionError('not_found', '成果地点が見つかりません', 404);
  }
  if (latest.status !== 'active') {
    throw new ConversionDefinitionError('definition_stopped', '停止中の成果地点には利用先を追加できません', 409);
  }
  if (Number(latest.version) !== input.expectedVersion) {
    throw new ConversionDefinitionError('version_conflict', '成果地点が更新されています。読み直してください', 409);
  }
  throw new Error('conversion_definition_usage_insert_failed');
}

export async function addConversionDefinitionUsage(
  db: D1Database,
  input: AddConversionDefinitionUsageInput,
): Promise<{ created: boolean; usage: ConversionDefinitionUsage; currentVersion: number }> {
  const point = await db.prepare('SELECT version, status, line_account_id FROM conversion_points WHERE id = ?')
    .bind(input.conversionPointId)
    .first<{ version: number; status: ConversionDefinitionStatus; line_account_id: string | null }>();
  if (!point || (point.line_account_id !== null && point.line_account_id !== input.lineAccountId)) {
    throw new ConversionDefinitionError('not_found', '成果地点が見つかりません', 404);
  }
  if (point.status !== 'active') {
    throw new ConversionDefinitionError('definition_stopped', '停止中の成果地点には利用先を追加できません', 409);
  }
  if (Number(point.version) !== input.expectedVersion) {
    throw new ConversionDefinitionError('version_conflict', '成果地点が更新されています。読み直してください', 409);
  }

  const existing = await getCurrentMatchingUsage(db, input);
  if (existing) {
    return { created: false, usage: serializeUsage(existing), currentVersion: Number(point.version) };
  }

  // N-258: 実在しない・別アカウントの利用先は保存しない。
  await assertUsageRefExists(db, input, input.lineAccountId);

  const id = crypto.randomUUID();
  const now = jstNow();
  let result: D1Result<unknown>;
  try {
    result = await db.prepare(`INSERT INTO conversion_definition_usages
        (id, conversion_point_id, definition_version, line_account_id, ref_kind, ref_id,
         ref_version_id, created_by, created_at, updated_at)
      SELECT ?, cp.id, cp.version, ?, ?, ?, ?, ?, ?, ?
        FROM conversion_points cp
       WHERE cp.id = ? AND cp.version = ? AND cp.status = 'active'
         AND (cp.line_account_id IS NULL OR cp.line_account_id = ?)`)
      .bind(
        id,
        input.lineAccountId,
        input.refKind,
        input.refId,
        input.refVersionId ?? null,
        input.staffId,
        now,
        now,
        input.conversionPointId,
        input.expectedVersion,
        input.lineAccountId,
      )
      .run();
  } catch (error) {
    if (!(error instanceof Error) || !/UNIQUE constraint failed/i.test(error.message)) throw error;
    const winner = await getCurrentMatchingUsage(db, input);
    if (winner) {
      return { created: false, usage: serializeUsage(winner), currentVersion: input.expectedVersion };
    }
    return throwLatestUsageConflict(db, input);
  }
  if ((result.meta.changes ?? 0) === 0) {
    return throwLatestUsageConflict(db, input);
  }
  const usage = await db.prepare('SELECT * FROM conversion_definition_usages WHERE id = ?')
    .bind(id)
    .first<UsageRow>();
  if (!usage) throw new Error('conversion_definition_usage_insert_failed');
  return { created: true, usage: serializeUsage(usage), currentVersion: input.expectedVersion };
}

export type CreateConversionDefinitionInput = {
  name: string;
  sourceType: string;
  sourceConfig: Record<string, unknown>;
  measureMethod: 'url_reach' | 'webhook' | 'manual';
  targetUrl?: string | null;
  deduplicationMode: ConversionDeduplicationMode;
  deduplicationWindowDays?: number | null;
  valueMode: ConversionValueMode;
  fixedValue?: number | null;
  reversalPolicy: ConversionReversalPolicy;
  attributionDays?: number | null;
  lineAccountId: string;
  usages: Array<Pick<AddConversionDefinitionUsageInput, 'refKind' | 'refId' | 'refVersionId'>>;
  staffId: string;
  /** N-268: true のとき下書きで保存し、公開するまで計測しない。 */
  draft?: boolean;
};

export async function createConversionDefinition(
  db: D1Database,
  input: CreateConversionDefinitionInput,
) {
  const duplicate = await db.prepare(`SELECT id FROM conversion_points
    WHERE line_account_id = ? AND lower(trim(name)) = lower(trim(?)) LIMIT 1`)
    .bind(input.lineAccountId, input.name)
    .first<{ id: string }>();
  if (duplicate) {
    throw new ConversionDefinitionError('duplicate_name', '同じ名前の成果地点があります', 409);
  }
  // N-258: 実在しない・別アカウントの利用先を仮IDのまま保存しない。
  for (const usage of input.usages) {
    await assertUsageRefExists(db, usage, input.lineAccountId);
  }
  const id = crypto.randomUUID();
  const now = jstNow();
  const tenantId = await resolveConversionPointTenantId(db, input.lineAccountId);
  const value = input.valueMode === 'fixed' ? input.fixedValue ?? null : null;
  const statements = [
    db.prepare(`INSERT INTO conversion_points
      (id, name, event_type, value, measure_method, target_url, count_repeat,
       attribution_days, line_account_id, tenant_id, source_config_json, deduplication_mode,
       deduplication_window_days, value_mode, reversal_policy, status, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .bind(
        id, input.name, input.sourceType, value, input.measureMethod,
        input.measureMethod === 'url_reach' ? input.targetUrl ?? null : null,
        input.deduplicationMode === 'every' ? 1 : 0,
        input.attributionDays ?? null, input.lineAccountId, tenantId, JSON.stringify(input.sourceConfig),
        input.deduplicationMode, input.deduplicationMode === 'window'
          ? input.deduplicationWindowDays ?? null : null,
        input.valueMode, input.reversalPolicy, input.draft ? 'draft' : 'active', now, now,
      ),
    ...input.usages.map((usage) => db.prepare(`INSERT INTO conversion_definition_usages
      (id, conversion_point_id, definition_version, line_account_id, ref_kind, ref_id,
       ref_version_id, created_by, created_at, updated_at)
      VALUES (?, ?, 1, ?, ?, ?, ?, ?, ?, ?)`)
      .bind(
        crypto.randomUUID(), id, input.lineAccountId, usage.refKind, usage.refId,
        usage.refVersionId ?? null, input.staffId, now, now,
      )),
  ];
  await db.batch(statements);
  return getConversionDefinitionDetail(db, id, {
    allowedAccountIds: [input.lineAccountId], includeUnassigned: false,
  });
}

export type PreviewConversionDefinitionInput = {
  scope: ConversionDefinitionScope;
  lineAccountId: string;
  sourceType: string;
  /** 保存される起点設定。url_reach のURL一致など、試算にも同じ条件を使う(N-257)。 */
  sourceConfig?: Record<string, unknown>;
  measureMethod?: 'url_reach' | 'webhook' | 'manual';
  targetUrl?: string | null;
  deduplicationMode: ConversionDeduplicationMode;
  deduplicationWindowDays?: number | null;
  valueMode: ConversionValueMode;
  fixedValue?: number | null;
  reversalPolicy?: ConversionReversalPolicy;
  range: ConversionDefinitionRange;
};

/**
 * window方式の「数える」回数を、記録時と同じ規則で過去データへあてはめる。
 *
 * trackConversion の窓は「直近 windowDays 以内に記録済みがあれば書かない」。
 * 試算では過去の成果列を時系列に読み、最後に数えた時刻から
 * windowDays 経ったものだけを数える(先に数えたものが基準になる
 * greedy方式。前の生イベントではなく前の「数えた」イベントとの差で決まる)。
 */
function estimateWindowDedupCount(
  rows: ReadonlyArray<{ friend_id: string; created_at: string }>,
  windowDays: number,
): number {
  const windowMs = windowDays * 86_400_000;
  const lastCounted = new Map<string, number>();
  let count = 0;
  for (const row of rows) {
    const at = new Date(`${row.created_at.replace(' ', 'T')}+09:00`).getTime();
    if (Number.isNaN(at)) continue;
    const last = lastCounted.get(row.friend_id);
    if (last === undefined || at - last > windowMs) {
      lastCounted.set(row.friend_id, at);
      count += 1;
    }
  }
  return count;
}

/**
 * 取消の試算(N-257)。reversalPolicy = source_cancelled のときだけ、
 * 同じ起点条件の過去成果に対する取消台帳の件数を数える。
 * 台帳(affiliate_adjustments 系)が無い環境では 0 を返す。
 */
async function estimateCancellationCount(
  db: D1Database,
  conditionsSql: string,
  conditionValues: unknown[],
  from: string,
  to: string,
): Promise<number> {
  const tables = await db
    .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name IN ('affiliate_adjustments','affiliate_reward_entries')")
    .all<{ name: string }>();
  if (tables.results.length < 2) return 0;
  const row = await db.prepare(`SELECT COUNT(*) AS total
    FROM affiliate_adjustments aa
    JOIN affiliate_reward_entries re ON re.id = aa.source_entry_id
    JOIN conversion_events ce ON ce.id = re.conversion_event_id
    JOIN conversion_points cp ON cp.id = ce.conversion_point_id
    WHERE aa.reason_type = 'cancel'
      AND substr(aa.created_at, 1, 10) >= ? AND substr(aa.created_at, 1, 10) <= ?
      AND ${conditionsSql}`)
    .bind(from.slice(0, 10), to.slice(0, 10), ...conditionValues)
    .first<{ total: number }>();
  return Number(row?.total ?? 0);
}

export async function previewConversionDefinition(
  db: D1Database,
  input: PreviewConversionDefinitionInput,
) {
  const account = accountWhere('cp.', input.scope, input.lineAccountId);
  /*
   * N-257: 試算は「保存したときと同じ条件」で数える。
   *
   * 直す前は起点種別・期間・アカウントだけを見ていたため、url_reach の
   * 対象URLや窓つき重複除外を変えても同じ数字が返っていた。
   * - url_reach: 同じ対象URLを見ていた地点の成果だけを数える。
   * - それ以外の起点: 対象URLを持たない地点の成果だけを数える
   *   (URL条件のある地点の成果を混ぜない)。
   */
  // N-269: 暦日は先頭10文字で比較する(ISOの'T'が空白より大きく、
  // 文字列の大小比較だと期間末の行が抜けるため)。
  const conditions = [`cp.event_type = ?`, `substr(ce.created_at, 1, 10) >= ?`, `substr(ce.created_at, 1, 10) <= ?`];
  const values: unknown[] = [input.sourceType, input.range.from.slice(0, 10), input.range.to.slice(0, 10)];
  if (input.measureMethod === 'url_reach' || input.targetUrl) {
    conditions.push(`cp.target_url = ?`);
    values.push(input.targetUrl ?? '');
  } else {
    conditions.push(`(cp.target_url IS NULL OR cp.target_url = '')`);
  }
  conditions.push(account.sql);
  values.push(...account.values);
  const where = conditions.join(' AND ');

  const row = await db.prepare(`SELECT COUNT(ce.id) AS matched_count,
      COUNT(DISTINCT ce.friend_id) AS unique_friends,
      COALESCE(SUM(COALESCE(ce.value_snapshot, 0)), 0) AS source_value
    FROM conversion_events ce
    JOIN conversion_points cp ON cp.id = ce.conversion_point_id
    WHERE ${where}`)
    .bind(...values)
    .first<{ matched_count: number; unique_friends: number; source_value: number }>();
  const matchedCount = Number(row?.matched_count ?? 0);
  const uniqueFriends = Number(row?.unique_friends ?? 0);

  let estimatedCount: number;
  if (input.deduplicationMode === 'every') {
    estimatedCount = matchedCount;
  } else if (input.deduplicationMode === 'window'
    && Number.isInteger(input.deduplicationWindowDays)
    && (input.deduplicationWindowDays as number) >= 1) {
    // 窓つきは「友だちごと」のまとめではなく時系列が要るので生の行を読む。
    const rows = await db.prepare(`SELECT ce.friend_id, ce.created_at
      FROM conversion_events ce
      JOIN conversion_points cp ON cp.id = ce.conversion_point_id
      WHERE ${where}
      ORDER BY ce.friend_id ASC, ce.created_at ASC, ce.id ASC`)
      .bind(...values)
      .all<{ friend_id: string; created_at: string }>();
    estimatedCount = estimateWindowDedupCount(rows.results, input.deduplicationWindowDays as number);
  } else {
    estimatedCount = uniqueFriends;
  }

  const cancellationCount = input.reversalPolicy === 'source_cancelled'
    ? await estimateCancellationCount(
        db,
        `cp.event_type = ? AND ${input.measureMethod === 'url_reach' || input.targetUrl ? `cp.target_url = ?` : `(cp.target_url IS NULL OR cp.target_url = '')`} AND ${account.sql}`,
        input.measureMethod === 'url_reach' || input.targetUrl
          ? [input.sourceType, input.targetUrl ?? '', ...account.values]
          : [input.sourceType, ...account.values],
        input.range.from,
        input.range.to,
      )
    : 0;

  const excludedReasons: string[] = [];
  if (matchedCount === 0) excludedReasons.push('選んだ起点の過去データがありません');
  // 除外条件は人が読む注記で、記録条件ではない。過去データへ適用できない
  // ことを隠さず画面へ返す(入力したのに試算へ反映されないと見えない)。
  if (typeof input.sourceConfig?.excludedCondition === 'string'
    && input.sourceConfig.excludedCondition.trim()) {
    excludedReasons.push('「数えない条件」は保存後の記録に効く注記のため、試算では全件を対象にしています');
  }

  const sourceAverage = matchedCount > 0 ? Number(row?.source_value ?? 0) / matchedCount : 0;
  const unitValue = input.valueMode === 'fixed'
    ? Number(input.fixedValue ?? 0)
    : input.valueMode === 'source' ? sourceAverage : 0;
  return {
    range: input.range,
    matchedCount,
    estimatedCount,
    estimatedValue: Math.round(estimatedCount * unitValue),
    duplicateExcludedCount: Math.max(0, matchedCount - estimatedCount),
    cancellationCount,
    excludedReasons,
    dailyAverage: Math.round((estimatedCount / 30) * 10) / 10,
    deduplicationWindowDays: input.deduplicationMode === 'window'
      ? input.deduplicationWindowDays ?? null : null,
  };
}

export async function getConversionDefinitionDeleteImpact(
  db: D1Database,
  id: string,
  scope: ConversionDefinitionScope,
) {
  const definition = await getConversionDefinitionDetail(db, id, scope);
  if (!definition) return null;
  const eventRow = await db.prepare('SELECT COUNT(*) AS total FROM conversion_events WHERE conversion_point_id = ?')
    .bind(id).first<{ total: number }>();
  const account = accountWhere('cp.', scope, undefined);
  /*
   * N-261: 差替え候補は同じ種類の成果地点だけを出す。
   * 起点の種類・計測方法・対象URLが違う地点へ利用先を移すと、
   * 利用先が見ているものと別の意味の成果を数え始める。
   * 候補一覧が本実行と同じ条件で絞られていれば、画面で違う種類を
   * 選ぶこと自体が起きない。
   */
  const replacements = await db.prepare(`SELECT cp.id, cp.name, cp.version
    FROM conversion_points cp
    WHERE cp.id <> ? AND cp.status = 'active'
      AND cp.event_type = ? AND cp.measure_method = ? AND cp.target_url IS ?
      AND ${account.sql}
    ORDER BY cp.name ASC LIMIT 20`)
    .bind(
      id,
      definition.sourceType,
      definition.measureMethod,
      definition.targetUrl,
      ...account.values,
    )
    .all<{ id: string; name: string; version: number }>();
  const eventCount = Number(eventRow?.total ?? 0);
  return {
    definition,
    usages: definition.usages,
    eventCount,
    canDelete: definition.usages.length === 0 && eventCount === 0,
    stopImpact: {
      affectedUsageCount: definition.usages.length,
      preservesPastEvents: true,
      preservesUsages: true,
    },
    replacementCandidates: replacements.results.map((row) => ({
      id: row.id, name: row.name, version: Number(row.version),
    })),
  };
}

async function currentDefinitionForMutation(
  db: D1Database,
  id: string,
  scope: ConversionDefinitionScope,
): Promise<{
  id: string; version: number; status: ConversionDefinitionStatus;
  line_account_id: string | null;
  event_type: string; measure_method: string; target_url: string | null;
} | null> {
  const account = accountWhere('cp.', scope, undefined);
  return db.prepare(`SELECT cp.id, cp.version, cp.status, cp.line_account_id,
      cp.event_type, cp.measure_method, cp.target_url
    FROM conversion_points cp WHERE cp.id = ? AND ${account.sql}`)
    .bind(id, ...account.values)
    .first();
}

function requireExpectedDefinition(
  row: { version: number; status: ConversionDefinitionStatus } | null,
  expectedVersion: number,
  options?: { allowDraft?: boolean },
) {
  if (!row) throw new ConversionDefinitionError('not_found', '成果地点が見つかりません', 404);
  if (Number(row.version) !== expectedVersion) {
    throw new ConversionDefinitionError('version_conflict', '成果地点が更新されています。読み直してください', 409);
  }
  if (row.status === 'stopped') {
    throw new ConversionDefinitionError('definition_stopped', '成果地点はすでに停止しています', 409);
  }
  if (row.status === 'draft' && !options?.allowDraft) {
    throw new ConversionDefinitionError('definition_draft', '成果地点はまだ下書きです。公開してから操作してください', 409);
  }
}

export async function stopConversionDefinition(
  db: D1Database,
  input: { id: string; scope: ConversionDefinitionScope; expectedVersion: number; reason?: string | null; staffId: string },
) {
  const current = await currentDefinitionForMutation(db, input.id, input.scope);
  requireExpectedDefinition(current, input.expectedVersion, { allowDraft: true });
  const now = jstNow();
  const usageRow = await db.prepare('SELECT COUNT(*) AS total FROM conversion_definition_usages WHERE conversion_point_id = ?')
    .bind(input.id).first<{ total: number }>();
  const operationId = crypto.randomUUID();
  // D1 batchは1文でも失敗すれば全体をrollbackする。CAS直後のchanges()が1の
  // ときだけログを作るため、競合したbatchは副作用0のまま終わる。
  const results = await db.batch([
    db.prepare(`UPDATE conversion_points SET status = 'stopped', stopped_at = ?,
      updated_at = ?, version = version + 1 WHERE id = ? AND version = ? AND status IN ('active', 'draft')`)
      .bind(now, now, input.id, input.expectedVersion),
    db.prepare(`INSERT INTO conversion_definition_operations
      (id, conversion_point_id, action, replacement_id, affected_usages, reason, performed_by, created_at)
      SELECT ?, ?, 'stop', NULL, ?, ?, ?, ? WHERE changes() = 1`)
      .bind(operationId, input.id, Number(usageRow?.total ?? 0), input.reason ?? null, input.staffId, now),
  ]);
  if ((results[0]?.meta.changes ?? 0) !== 1 || (results[1]?.meta.changes ?? 0) !== 1) {
    throw new ConversionDefinitionError('version_conflict', '成果地点が更新されています。読み直してください', 409);
  }
  return { id: input.id, status: 'stopped' as const, version: input.expectedVersion + 1, stoppedAt: now };
}

/** 編集で差し替える設定。監査の前後比較にもこの形をそのまま使う。 */
type DefinitionConfig = {
  name: string;
  sourceType: string;
  sourceConfig: Record<string, unknown>;
  measureMethod: 'url_reach' | 'webhook' | 'manual';
  targetUrl: string | null;
  deduplicationMode: ConversionDeduplicationMode;
  deduplicationWindowDays: number | null;
  valueMode: ConversionValueMode;
  fixedValue: number | null;
  reversalPolicy: ConversionReversalPolicy;
  attributionDays: number | null;
};

type RevisionRow = {
  id: string;
  version: number;
  status: ConversionDefinitionStatus;
  line_account_id: string | null;
  name: string;
  event_type: string;
  value: number | null;
  measure_method: 'url_reach' | 'webhook' | 'manual';
  target_url: string | null;
  count_repeat: number;
  attribution_days: number | null;
  source_config_json: string;
  deduplication_mode: ConversionDeduplicationMode;
  deduplication_window_days: number | null;
  value_mode: ConversionValueMode;
  reversal_policy: ConversionReversalPolicy;
};

function configOf(row: RevisionRow): DefinitionConfig {
  return {
    name: row.name,
    sourceType: row.event_type,
    sourceConfig: JSON.parse(row.source_config_json || '{}') as Record<string, unknown>,
    measureMethod: row.measure_method,
    targetUrl: row.target_url,
    deduplicationMode: row.deduplication_mode,
    deduplicationWindowDays: row.deduplication_window_days,
    valueMode: row.value_mode,
    fixedValue: row.value,
    reversalPolicy: row.reversal_policy,
    attributionDays: row.attribution_days,
  };
}

export type ReviseConversionDefinitionInput = {
  id: string;
  scope: ConversionDefinitionScope;
  expectedVersion: number;
  reason?: string | null;
  staffId: string;
} & Omit<DefinitionConfig, 'targetUrl' | 'deduplicationWindowDays' | 'fixedValue' | 'attributionDays'>
  & Partial<Pick<DefinitionConfig, 'targetUrl' | 'deduplicationWindowDays' | 'fixedValue' | 'attributionDays'>>;

/**
 * 成果地点を、履歴を保ったまま編集して次の版にする（N-252）。
 *
 * **過去の成果は書き換えない。** 集計は `conversion_events.value_snapshot` を
 * 見ており、計測時の版は `point_version_snapshot` に残る。だから編集しても
 * 過去の集計額は動かない。
 *
 * **利用先は安定ID（`conversion_point_id`）のまま次の版へ付け替える。**
 * 参照が切れないよう、地点の版を上げるのと同じ処理の中で `definition_version`
 * を進める。
 *
 * **後勝ちにしない。** `stopConversionDefinition` と同じ形で、版のCASに勝った
 * ときだけ監査と利用先が動く。負けた側は 409 で、副作用は0のまま終わる
 * （D1 の batch は1文でも失敗すれば全体を rollback する。ここでは失敗ではなく
 * 「0件更新」で表すので、後段の文も同じ条件で自分を止める）。
 */
export async function reviseConversionDefinition(
  db: D1Database,
  input: ReviseConversionDefinitionInput,
) {
  const account = accountWhere('cp.', input.scope, undefined);
  const current = await db.prepare(`SELECT cp.id, cp.version, cp.status, cp.line_account_id,
      cp.name, cp.event_type, cp.value, cp.measure_method, cp.target_url, cp.count_repeat,
      cp.attribution_days, cp.source_config_json, cp.deduplication_mode,
      cp.deduplication_window_days, cp.value_mode, cp.reversal_policy
    FROM conversion_points cp WHERE cp.id = ? AND ${account.sql}`)
    .bind(input.id, ...account.values)
    .first<RevisionRow>();
  // N-268: 下書きも編集できる。版を進めても status は draft のまま。
  requireExpectedDefinition(current, input.expectedVersion, { allowDraft: true });
  const row = current!;

  const name = input.name.trim();
  if (!name) throw new ConversionDefinitionError('required', '成果地点の名前を入れてください', 400);
  // 同じ店の中で名前が重ならないこと。自分自身は除く（名前を変えない編集を弾かない）。
  const duplicate = await db.prepare(`SELECT id FROM conversion_points
    WHERE line_account_id IS ? AND lower(trim(name)) = lower(trim(?)) AND id != ? LIMIT 1`)
    .bind(row.line_account_id, name, input.id)
    .first<{ id: string }>();
  if (duplicate) {
    throw new ConversionDefinitionError('duplicate_name', '同じ名前の成果地点があります', 409);
  }

  const after: DefinitionConfig = {
    name,
    sourceType: input.sourceType,
    sourceConfig: input.sourceConfig,
    measureMethod: input.measureMethod,
    targetUrl: input.measureMethod === 'url_reach' ? input.targetUrl ?? null : null,
    deduplicationMode: input.deduplicationMode,
    deduplicationWindowDays: input.deduplicationMode === 'window'
      ? input.deduplicationWindowDays ?? null : null,
    valueMode: input.valueMode,
    fixedValue: input.valueMode === 'fixed' ? input.fixedValue ?? null : null,
    reversalPolicy: input.reversalPolicy,
    attributionDays: input.attributionDays ?? null,
  };
  const before = configOf(row);
  const toVersion = input.expectedVersion + 1;
  const now = jstNow();
  const revisionId = crypto.randomUUID();
  const usageRow = await db.prepare(`SELECT COUNT(*) AS total FROM conversion_definition_usages
    WHERE conversion_point_id = ? AND definition_version = ?`)
    .bind(input.id, input.expectedVersion).first<{ total: number }>();
  const affectedUsages = Number(usageRow?.total ?? 0);

  const results = await db.batch([
    db.prepare(`UPDATE conversion_points
        SET name = ?, event_type = ?, value = ?, measure_method = ?, target_url = ?,
            count_repeat = ?, attribution_days = ?, source_config_json = ?,
            deduplication_mode = ?, deduplication_window_days = ?, value_mode = ?,
            reversal_policy = ?, updated_at = ?, version = version + 1
      WHERE id = ? AND version = ? AND status = 'active'`)
      .bind(
        after.name, after.sourceType, after.fixedValue, after.measureMethod, after.targetUrl,
        after.deduplicationMode === 'every' ? 1 : 0, after.attributionDays,
        JSON.stringify(after.sourceConfig), after.deduplicationMode,
        after.deduplicationWindowDays, after.valueMode, after.reversalPolicy,
        now, input.id, input.expectedVersion,
      ),
    // CASに勝ったときだけ監査を残す。負けた batch は行を1つも作らない。
    db.prepare(`INSERT INTO conversion_definition_revisions
      (id, conversion_point_id, from_version, to_version, before_config_json,
       after_config_json, affected_usages, reason, performed_by, created_at)
      SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?, ? WHERE changes() = 1`)
      .bind(
        revisionId, input.id, input.expectedVersion, toVersion,
        JSON.stringify(before), JSON.stringify(after), affectedUsages,
        input.reason ?? null, input.staffId, now,
      ),
    /*
     * 利用先を次の版へ付け替える。
     *
     * `changes()` は直前の文（監査のINSERT）を指すので、ここでは使えない。
     * 監査行そのものの有無を条件にする。CASに負けた batch では監査行が
     * 作られないため、この UPDATE も0件で終わり、利用先の版だけが
     * 先に進んでしまうことがない。
     */
    db.prepare(`UPDATE conversion_definition_usages
        SET definition_version = ?, updated_at = ?
      WHERE conversion_point_id = ? AND definition_version = ?
        AND EXISTS (SELECT 1 FROM conversion_definition_revisions
                     WHERE conversion_point_id = ? AND to_version = ?)`)
      .bind(toVersion, now, input.id, input.expectedVersion, input.id, toVersion),
  ]);
  if ((results[0]?.meta.changes ?? 0) !== 1 || (results[1]?.meta.changes ?? 0) !== 1) {
    throw new ConversionDefinitionError('version_conflict', '成果地点が更新されています。読み直してください', 409);
  }
  return {
    id: input.id,
    version: toVersion,
    revisionId,
    movedUsages: Number(results[2]?.meta.changes ?? 0),
    updatedAt: now,
  };
}

export async function replaceConversionDefinitionUsages(
  db: D1Database,
  input: { id: string; replacementId: string; scope: ConversionDefinitionScope; expectedVersion: number; replacementExpectedVersion: number; reason?: string | null; staffId: string },
) {
  if (input.id === input.replacementId) {
    throw new ConversionDefinitionError('invalid_replacement', '別の成果地点を選んでください', 400);
  }
  const [source, replacement] = await Promise.all([
    currentDefinitionForMutation(db, input.id, input.scope),
    currentDefinitionForMutation(db, input.replacementId, input.scope),
  ]);
  // 差し替え元が下書きでも利用先を逃がせる。差し替え先は計測中に限る。
  requireExpectedDefinition(source, input.expectedVersion, { allowDraft: true });
  requireExpectedDefinition(replacement, input.replacementExpectedVersion);
  if (source!.line_account_id !== replacement!.line_account_id) {
    throw new ConversionDefinitionError('account_mismatch', '同じLINEアカウントの成果地点を選んでください', 409);
  }
  /*
   * N-261: 種類の違う成果地点へは差し替えられない。
   * 起点の種類・計測方法・対象URLが一致する地点だけを置き換え先にする。
   * 違う種類へ利用先を移すと、「注文が確定した成果」を見ていた分析が
   * いきなり「ページを見た成果」を数え始めるような取り違えになる。
   * 事前検査だけでは同時更新に負けることがあるので、同じ条件は後段の
   * CAS文の EXISTS にも入れてある。
   */
  if (
    source!.event_type !== replacement!.event_type
    || source!.measure_method !== replacement!.measure_method
    || source!.target_url !== replacement!.target_url
  ) {
    throw new ConversionDefinitionError(
      'incompatible_source_type',
      '同じ種類の成果地点を選んでください。起点・計測方法・対象ページが同じ地点にだけ差し替えられます',
      409,
    );
  }
  const usageRow = await db.prepare('SELECT COUNT(*) AS total FROM conversion_definition_usages WHERE conversion_point_id = ?')
    .bind(input.id).first<{ total: number }>();
  const affectedUsages = Number(usageRow?.total ?? 0);
  const now = jstNow();
  const operationId = crypto.randomUUID();
  // 事前確認は読んだ瞬間の姿でしかない。置換先を別の要求が停止・版更新・削除
  // しても旧地点のCASだけなら通ってしまい、利用先が停止済みや旧版の置換先へ
  // 移る。置換先のID・版・稼働中・同アカウントを旧地点のCAS文そのものへ
  // EXISTSで入れ、同じtransaction内で1文として固定する。
  const results = await db.batch([
    db.prepare(`UPDATE conversion_points AS source SET status = 'stopped', stopped_at = ?,
      updated_at = ?, version = version + 1
      WHERE source.id = ? AND source.version = ? AND source.status IN ('active', 'draft')
        AND EXISTS (
          SELECT 1 FROM conversion_points AS replacement
          WHERE replacement.id = ? AND replacement.version = ?
            AND replacement.status = 'active' AND replacement.id <> source.id
            AND (replacement.line_account_id = source.line_account_id
              OR (replacement.line_account_id IS NULL AND source.line_account_id IS NULL))
            -- N-263: 統括も同じ1文で確かめる。アカウントが一致すれば統括も
            -- 一致するのが筋だが、移行前の行や手直しでズレた行を置換先に
            -- しないよう、ここでも閉じておく。
            AND COALESCE(replacement.tenant_id, ?) = COALESCE(source.tenant_id, ?)
            -- N-261: 種類の一致も同じ1文で確かめる。事前検査とCASの間で
            -- 置換先が別種へ編集されても、ここで0件に倒れて移らない。
            AND replacement.event_type = source.event_type
            AND replacement.measure_method = source.measure_method
            AND replacement.target_url IS source.target_url
        )`)
      .bind(now, now, input.id, input.expectedVersion, input.replacementId, input.replacementExpectedVersion,
        DEFAULT_TENANT_ID, DEFAULT_TENANT_ID),
    db.prepare(`INSERT INTO conversion_definition_operations
      (id, conversion_point_id, action, replacement_id, affected_usages, reason, performed_by, created_at)
      SELECT ?, ?, 'replace', ?, ?, ?, ?, ? WHERE changes() = 1`)
      .bind(operationId, input.id, input.replacementId, affectedUsages, input.reason ?? null, input.staffId, now),
    db.prepare(`DELETE FROM conversion_definition_usages AS source
      WHERE source.conversion_point_id = ? AND EXISTS (
        SELECT 1 FROM conversion_definition_usages target
        WHERE target.conversion_point_id = ? AND target.line_account_id = source.line_account_id
          AND target.ref_kind = source.ref_kind AND target.ref_id = source.ref_id
          AND COALESCE(target.ref_version_id, '') = COALESCE(source.ref_version_id, '')
      ) AND EXISTS (SELECT 1 FROM conversion_definition_operations WHERE id = ?)`)
      .bind(input.id, input.replacementId, operationId),
    db.prepare(`UPDATE conversion_definition_usages SET conversion_point_id = ?,
      definition_version = ?, updated_at = ? WHERE conversion_point_id = ?
      AND EXISTS (SELECT 1 FROM conversion_definition_operations WHERE id = ?)`)
      .bind(input.replacementId, input.replacementExpectedVersion, now, input.id, operationId),
  ]);
  if ((results[0]?.meta.changes ?? 0) !== 1 || (results[1]?.meta.changes ?? 0) !== 1) {
    // 敗者には、旧地点と置換先のどちらを読み直すのかを分けて伝える。
    const latestReplacement = await currentDefinitionForMutation(db, input.replacementId, input.scope);
    if (!latestReplacement) {
      throw new ConversionDefinitionError('replacement_not_found', '置換先の成果地点が見つかりません。読み直してください', 409);
    }
    if (Number(latestReplacement.version) !== input.replacementExpectedVersion
      || latestReplacement.status !== 'active') {
      throw new ConversionDefinitionError('replacement_conflict', '置換先の成果地点が更新されています。読み直してください', 409);
    }
    throw new ConversionDefinitionError('version_conflict', '成果地点が更新されています。読み直してください', 409);
  }
  return {
    id: input.id,
    replacementId: input.replacementId,
    replacedUsageCount: affectedUsages,
    status: 'stopped' as const,
    version: input.expectedVersion + 1,
  };
}

export async function deleteUnusedConversionDefinition(
  db: D1Database,
  input: { id: string; scope: ConversionDefinitionScope; expectedVersion: number; reason?: string | null; staffId: string },
) {
  const current = await currentDefinitionForMutation(db, input.id, input.scope);
  requireExpectedDefinition(current, input.expectedVersion, { allowDraft: true });
  const impact = await getConversionDefinitionDeleteImpact(db, input.id, input.scope);
  if (!impact?.canDelete) {
    throw new ConversionDefinitionError('definition_in_use', '成果または利用先があるため、削除せず停止してください', 409);
  }
  const now = jstNow();
  const operationId = crypto.randomUUID();
  const results = await db.batch([
    db.prepare(`DELETE FROM conversion_points
      WHERE id = ? AND version = ?
        AND NOT EXISTS (SELECT 1 FROM conversion_events WHERE conversion_point_id = ?)
        AND NOT EXISTS (SELECT 1 FROM conversion_definition_usages WHERE conversion_point_id = ?)`)
      .bind(input.id, input.expectedVersion, input.id, input.id),
    db.prepare(`INSERT INTO conversion_definition_operations
      (id, conversion_point_id, action, replacement_id, affected_usages, reason, performed_by, created_at)
      SELECT ?, ?, 'delete', NULL, 0, ?, ?, ? WHERE changes() = 1`)
      .bind(operationId, input.id, input.reason ?? null, input.staffId, now),
  ]);
  if ((results[0]?.meta.changes ?? 0) !== 1 || (results[1]?.meta.changes ?? 0) !== 1) {
    throw new ConversionDefinitionError('version_conflict', '成果地点が更新されています。読み直してください', 409);
  }
  return { id: input.id, deleted: true as const };
}

/**
 * N-268: 下書きを計測中へ。設定は変えずに status だけ進める。
 * 版は他操作と同じく +1 して、同時操作の競合を版の一致で検出する。
 */
export async function publishConversionDefinition(
  db: D1Database,
  input: { id: string; scope: ConversionDefinitionScope; expectedVersion: number; staffId: string },
) {
  const current = await currentDefinitionForMutation(db, input.id, input.scope);
  if (!current) throw new ConversionDefinitionError('not_found', '成果地点が見つかりません', 404);
  if (Number(current.version) !== input.expectedVersion) {
    throw new ConversionDefinitionError('version_conflict', '成果地点が更新されています。読み直してください', 409);
  }
  if (current.status !== 'draft') {
    throw new ConversionDefinitionError('not_draft', '下書きではありません', 409);
  }
  const now = jstNow();
  const result = await db
    .prepare(`UPDATE conversion_points SET status = 'active', updated_at = ?, version = version + 1
      WHERE id = ? AND version = ? AND status = 'draft'`)
    .bind(now, input.id, input.expectedVersion)
    .run();
  if ((result.meta.changes ?? 0) !== 1) {
    throw new ConversionDefinitionError('version_conflict', '成果地点が更新されています。読み直してください', 409);
  }
  return { id: input.id, status: 'active' as const, version: input.expectedVersion + 1 };
}

// ── 外部受信 (N-270) ─────────────────────────────────────────────────────────
//
// 外部システムが POST /api/conversions/ingest/:id へ成果を送るときの
// 地点ごとの受信鍵と受信台帳。鍵は受信Webhookと同じ暗号化形式で保存し、
// 平文を返すのは発行の1回だけ。

type IngestPointRow = {
  id: string;
  status: ConversionDefinitionStatus;
  ingest_secret_encrypted: string | null;
  ingest_disabled_at: string | null;
};

/** 受信鍵の発行・再発行。再発行は古い鍵をその場で無効にする。 */
export async function issueConversionIngestSecret(
  db: D1Database,
  input: {
    id: string;
    scope: ConversionDefinitionScope;
    expectedVersion: number;
    staffId: string;
    keys?: WebhookKeyInput;
  },
) {
  const current = await currentDefinitionForMutation(db, input.id, input.scope);
  requireExpectedDefinition(current, input.expectedVersion);
  const plaintext = `cvwhk_${crypto.randomUUID().replaceAll('-', '')}${crypto.randomUUID().replaceAll('-', '').slice(0, 16)}`;
  const encrypted = await encryptWebhookSecret(plaintext, input.keys);
  const now = jstNow();
  const result = await db
    .prepare(`UPDATE conversion_points SET ingest_secret_encrypted = ?, ingest_disabled_at = NULL,
      updated_at = ?, version = version + 1
      WHERE id = ? AND version = ? AND status = 'active'`)
    .bind(encrypted, now, input.id, input.expectedVersion)
    .run();
  if ((result.meta.changes ?? 0) !== 1) {
    throw new ConversionDefinitionError('version_conflict', '成果地点が更新されています。読み直してください', 409);
  }
  return { id: input.id, secret: plaintext, version: input.expectedVersion + 1 };
}

/**
 * 外部受信の停止・再開。鍵は消さないので、再開すると同じ鍵でまた受けられる。
 * 「止める」は status ではなく ingest_disabled_at で表す。地点自体は
 * 内部起点からの計測を続けられるため。
 */
export async function setConversionIngestDisabled(
  db: D1Database,
  input: {
    id: string;
    scope: ConversionDefinitionScope;
    expectedVersion: number;
    disabled: boolean;
    staffId: string;
  },
) {
  const current = await currentDefinitionForMutation(db, input.id, input.scope);
  requireExpectedDefinition(current, input.expectedVersion);
  const now = jstNow();
  const result = await db
    .prepare(`UPDATE conversion_points SET ingest_disabled_at = ?, updated_at = ?, version = version + 1
      WHERE id = ? AND version = ? AND status = 'active'`)
    .bind(input.disabled ? now : null, now, input.id, input.expectedVersion)
    .run();
  if ((result.meta.changes ?? 0) !== 1) {
    throw new ConversionDefinitionError('version_conflict', '成果地点が更新されています。読み直してください', 409);
  }
  return { id: input.id, disabledAt: input.disabled ? now : null, version: input.expectedVersion + 1 };
}

/** 公開受信口が使う地点の最小限の行。スコープ検査は署名の後で行う。 */
export async function getConversionPointForIngest(
  db: D1Database,
  id: string,
): Promise<IngestPointRow | null> {
  return db.prepare(`SELECT id, status, ingest_secret_encrypted, ingest_disabled_at
    FROM conversion_points WHERE id = ?`).bind(id).first<IngestPointRow>();
}

/**
 * 保存した受信鍵を復号する。照合の直前だけ呼ぶ。
 * 鍵不足・復号失敗は例外(fail-closed)。未設定なら null。
 */
export async function resolveConversionIngestSecret(
  row: IngestPointRow,
  keys?: WebhookKeyInput,
): Promise<string | null> {
  return resolveWebhookSecret(
    { id: row.id, secret: null, secret_encrypted: row.ingest_secret_encrypted },
    keys,
  );
}

export type ConversionIngestionEvent = {
  id: string;
  conversionPointId: string;
  result: 'recorded' | 'duplicate' | 'rejected';
  reason: string | null;
  /**
   * IDEA-19: 検証の受信か。true の受信は成果表へ書かず台帳だけに残るので、
   * 売上・報酬・集計へ混入しない。本番の受信は false。
   */
  isTest: boolean;
  sourceEventId: string | null;
  friendId: string | null;
  payloadShape: Record<string, unknown> | null;
  signatureSha256: string | null;
  createdAt: string;
};

type IngestionEventRow = {
  id: string;
  conversion_point_id: string;
  result: 'recorded' | 'duplicate' | 'rejected';
  reason: string | null;
  is_test: number | null;
  source_event_id: string | null;
  friend_id: string | null;
  payload_shape_json: string | null;
  signature_sha256: string | null;
  created_at: string;
};

/** 受信の成否を1件残す。台帳の失敗で受信処理そのものを止めないよう呼び側で握る。 */
export async function recordConversionIngestionEvent(
  db: D1Database,
  input: {
    conversionPointId: string;
    result: 'recorded' | 'duplicate' | 'rejected';
    reason?: string | null;
    /** IDEA-19: 検証の受信なら true。成果表には書かない受信の目印。 */
    isTest?: boolean;
    sourceEventId?: string | null;
    friendId?: string | null;
    payloadShape?: Record<string, unknown> | null;
    signatureSha256?: string | null;
  },
): Promise<void> {
  await db.prepare(`INSERT INTO conversion_ingestion_events
    (id, conversion_point_id, result, reason, is_test, source_event_id, friend_id,
     payload_shape_json, signature_sha256, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .bind(
      crypto.randomUUID(),
      input.conversionPointId,
      input.result,
      input.reason ?? null,
      input.isTest ? 1 : 0,
      input.sourceEventId ?? null,
      input.friendId ?? null,
      input.payloadShape ? JSON.stringify(input.payloadShape) : null,
      input.signatureSha256 ?? null,
      jstNow(),
    )
    .run();
}

/** 詳細画面・診断用の受信履歴。新しい順。 */
export async function listConversionIngestionEvents(
  db: D1Database,
  input: { id: string; scope: ConversionDefinitionScope; limit?: number },
): Promise<ConversionIngestionEvent[] | null> {
  const current = await currentDefinitionForMutation(db, input.id, input.scope);
  if (!current) return null;
  const limit = Math.min(100, Math.max(1, input.limit ?? 50));
  const rows = await db.prepare(`SELECT * FROM conversion_ingestion_events
    WHERE conversion_point_id = ? ORDER BY created_at DESC, id DESC LIMIT ?`)
    .bind(input.id, limit)
    .all<IngestionEventRow>();
  return rows.results.map((row) => ({
    id: row.id,
    conversionPointId: row.conversion_point_id,
    result: row.result,
    reason: row.reason,
    isTest: row.is_test === 1,
    sourceEventId: row.source_event_id,
    friendId: row.friend_id,
    payloadShape: row.payload_shape_json
      ? JSON.parse(row.payload_shape_json) as Record<string, unknown>
      : null,
    signatureSha256: row.signature_sha256,
    createdAt: row.created_at,
  }));
}

/**
 * IDEA-19: 成果1件ごとの業務状態。
 *
 * - confirmed : 確定。承認が要らない成果は記録と同時にここへ来る。
 * - pending   : 確認待ち。アフィリエイト経由の成果で承認がまだのもの。
 * - rejected  : 確認の結果、却下されたもの。確定成果には数えない。
 * - cancelled : 確定のあと取消(返品・取消調整)が入ったもの。
 */
export type ConversionDefinitionEventStatus =
  | 'confirmed' | 'pending' | 'rejected' | 'cancelled';

export type ConversionDefinitionEventItem = {
  id: string;
  friendId: string;
  /** 友だちの表示名。退会・削除済みなら null(画面はIDに倒す)。 */
  friendName: string | null;
  status: ConversionDefinitionEventStatus;
  /** 生の承認状態。却下理由の列は持たないため null / pending / approved / rejected のみ。 */
  approvalStatus: 'pending' | 'approved' | 'rejected' | null;
  /** 取消台帳に取消が入っているか。 */
  cancelled: boolean;
  /** 計測したときの1件あたりの金額(地点の後からの編集に引きずられない控え)。 */
  value: number | null;
  /** どこから届いた成果か。metadata の source / sourceType を写す。 */
  source: string | null;
  sourceEventId: string | null;
  createdAt: string;
};

type DefinitionEventRow = {
  id: string;
  friend_id: string;
  friend_name: string | null;
  approval_status: 'pending' | 'approved' | 'rejected' | null;
  cancelled: number;
  value_snapshot: number | null;
  metadata: string | null;
  created_at: string;
};

function readEventMetadataSource(metadata: string | null): {
  source: string | null;
  sourceEventId: string | null;
} {
  if (!metadata) return { source: null, sourceEventId: null };
  try {
    const parsed: unknown = JSON.parse(metadata);
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return { source: null, sourceEventId: null };
    }
    const record = parsed as Record<string, unknown>;
    const source = typeof record.source === 'string'
      ? record.source
      : typeof record.sourceType === 'string' ? record.sourceType : null;
    const sourceEventId = typeof record.sourceEventId === 'string' ? record.sourceEventId : null;
    return { source, sourceEventId };
  } catch {
    return { source: null, sourceEventId: null };
  }
}

/**
 * IDEA-19: 成果地点ごとの成果1件ずつの一覧(新しい順)。
 *
 * 「検知・確認待ち・確定・取消」を業務の言葉で画面へ渡すため、
 * 承認状態と取消台帳(affiliate_adjustments の cancel)から状態を導出する。
 * 重複通知・再送は冪等キーで1件に潰れているため、この一覧の確定件数と
 * 集計(netCount)は同じ台帳から数えて一致する。
 *
 * 取消台帳が無い環境(移行293より前の構成)では取消判定を0に倒し、
 * 「取消かどうか分からない」を「取消でない」と偽らないため
 * cancelled 判定だけを無効化して返す。
 */
export async function listConversionDefinitionEvents(
  db: D1Database,
  input: { id: string; scope: ConversionDefinitionScope; limit?: number },
): Promise<ConversionDefinitionEventItem[] | null> {
  const current = await currentDefinitionForMutation(db, input.id, input.scope);
  if (!current) return null;
  const limit = Math.min(100, Math.max(1, input.limit ?? 50));

  const tables = await db
    .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name IN ('affiliate_adjustments','affiliate_reward_entries')")
    .all<{ name: string }>();
  const hasCancellationLedger = tables.results.length === 2;
  const cancelledSql = hasCancellationLedger
    ? `EXISTS(SELECT 1 FROM affiliate_reward_entries re
              JOIN affiliate_adjustments aa ON aa.source_entry_id = re.id
             WHERE re.conversion_event_id = ce.id AND aa.reason_type = 'cancel')`
    : '0';

  const rows = await db
    .prepare(
      `SELECT ce.id, ce.friend_id, f.display_name AS friend_name,
              ce.approval_status, ce.value_snapshot, ce.metadata, ce.created_at,
              ${cancelledSql} AS cancelled
         FROM conversion_events ce
         LEFT JOIN friends f ON f.id = ce.friend_id
        WHERE ce.conversion_point_id = ?
        ORDER BY ce.created_at DESC, ce.id DESC
        LIMIT ?`,
    )
    .bind(input.id, limit)
    .all<DefinitionEventRow>();

  return rows.results.map((row) => {
    const { source, sourceEventId } = readEventMetadataSource(row.metadata);
    const cancelled = row.cancelled === 1;
    return {
      id: row.id,
      friendId: row.friend_id,
      friendName: row.friend_name,
      status: cancelled
        ? 'cancelled'
        : row.approval_status === 'pending'
          ? 'pending'
          : row.approval_status === 'rejected' ? 'rejected' : 'confirmed',
      approvalStatus: row.approval_status,
      cancelled,
      value: row.value_snapshot,
      source,
      sourceEventId,
      createdAt: row.created_at,
    };
  });
}

type ReportRow = {
  conversion_point_id: string;
  conversion_point_name: string;
  event_type: string;
  total_count: number;
  total_value: number;
};

async function reportRows(
  db: D1Database,
  scope: ConversionDefinitionScope | null,
  lineAccountId: string | undefined,
  from: string,
  to: string,
): Promise<ReportRow[]> {
  const account = scope ? accountWhere('cp.', scope, lineAccountId) : { sql: '1 = 1', values: [] as unknown[] };
  const rows = await db.prepare(`SELECT cp.id AS conversion_point_id,
      cp.name AS conversion_point_name, cp.event_type,
      COUNT(ce.id) AS total_count,
      COALESCE(SUM(CASE WHEN ce.id IS NULL THEN 0 ELSE COALESCE(ce.value_snapshot, 0) END), 0) AS total_value
    FROM conversion_points cp
    LEFT JOIN conversion_events ce ON ce.conversion_point_id = cp.id
      AND substr(ce.created_at, 1, 10) >= ? AND substr(ce.created_at, 1, 10) <= ?
    WHERE ${account.sql}
    GROUP BY cp.id
    ORDER BY total_count DESC, cp.id ASC`)
    .bind(from.slice(0, 10), to.slice(0, 10), ...account.values)
    .all<ReportRow>();
  return rows.results;
}

export interface ConversionReport {
  conversionPointId: string;
  conversionPointName: string;
  eventType: string;
  totalCount: number;
  totalValue: number;
}

/**
 * N-269: 旧来の地点別集計(startDate/endDate→地点別行)の薄い互換口。
 *
 * 集計は新レポートと同じ `reportRows` を使うため、暦日の解釈
 * (先頭10文字のJST暦日)とスナップショット固定は新レポートと一致する。
 * `total_*` は取消を引く前の総数で、旧形の「全件数えた値」と同じ意味。
 * scope を省略したときはアカウント絞りを掛けない(旧口の呼び出し互換)。
 */
export async function getConversionReport(
  db: D1Database,
  opts: { startDate?: string; endDate?: string; scope?: ConversionDefinitionScope } = {},
): Promise<ConversionReport[]> {
  const rows = await reportRows(
    db,
    opts.scope ?? null,
    undefined,
    opts.startDate ? `${opts.startDate} 00:00:00` : '0001-01-01 00:00:00',
    opts.endDate ? `${opts.endDate} 23:59:59` : '9999-12-31 23:59:59',
  );
  return rows.map((row) => ({
    conversionPointId: row.conversion_point_id,
    conversionPointName: row.conversion_point_name,
    eventType: row.event_type,
    totalCount: Number(row.total_count),
    totalValue: Number(row.total_value),
  }));
}

export async function getConversionDefinitionReport(
  db: D1Database,
  input: {
    scope: ConversionDefinitionScope;
    lineAccountId?: string;
    range: ConversionDefinitionRange;
    previousRange: ConversionDefinitionRange;
  },
) {
  const [current, previous] = await Promise.all([
    reportRows(db, input.scope, input.lineAccountId, input.range.from, input.range.to),
    reportRows(db, input.scope, input.lineAccountId, input.previousRange.from, input.previousRange.to),
  ]);
  const [currentCancellations, previousCancellations] = await Promise.all([
    cancellationMetrics(db, input.range.from, input.range.to),
    cancellationMetrics(db, input.previousRange.from, input.previousRange.to),
  ]);
  const previousById = new Map(previous.map((row) => [row.conversion_point_id, row]));
  const totals = current.reduce((sum, row) => ({
    count: sum.count + Number(row.total_count) - (currentCancellations.get(row.conversion_point_id)?.count ?? 0),
    value: sum.value + Number(row.total_value) - (currentCancellations.get(row.conversion_point_id)?.value ?? 0),
  }), { count: 0, value: 0 });
  const previousTotals = previous.reduce((sum, row) => ({
    count: sum.count + Number(row.total_count) - (previousCancellations.get(row.conversion_point_id)?.count ?? 0),
    value: sum.value + Number(row.total_value) - (previousCancellations.get(row.conversion_point_id)?.value ?? 0),
  }), { count: 0, value: 0 });
  const account = accountWhere('cp.', input.scope, input.lineAccountId);
  // N-265: 経路別の母数。ref_tracking に残る「その経路を踏んだ友だち数」を
  // 分母にする。created_at は JST ISO(+09:00)と datetime() 書式が混在するため、
  // 保存された暦日の先頭10文字で日単位に比較する(N-269 と同じ扱い)。
  const friendAccount = accountWhere('f.', input.scope, input.lineAccountId);
  const [dailyRows, routeRows, audienceRows] = await Promise.all([
    db.prepare(`SELECT substr(ce.created_at, 1, 10) AS day, cp.id AS conversion_point_id,
                       cp.name AS conversion_point_name, COUNT(*) AS total_count,
                       COALESCE(SUM(COALESCE(ce.value_snapshot, 0)), 0) AS total_value
                  FROM conversion_events ce
                  JOIN conversion_points cp ON cp.id = ce.conversion_point_id
                 WHERE substr(ce.created_at, 1, 10) >= ? AND substr(ce.created_at, 1, 10) <= ? AND ${account.sql}
                 GROUP BY day, cp.id ORDER BY day ASC, cp.id ASC`)
      .bind(input.range.from.slice(0, 10), input.range.to.slice(0, 10), ...account.values)
      .all<{ day: string; conversion_point_id: string; conversion_point_name: string; total_count: number; total_value: number }>(),
    db.prepare(`SELECT ce.conversion_point_id, COALESCE(ce.attributed_ref_code, 'unattributed') AS route_key,
                       COUNT(*) AS total_count,
                       COALESCE(SUM(COALESCE(ce.value_snapshot, 0)), 0) AS total_value
                  FROM conversion_events ce
                  JOIN conversion_points cp ON cp.id = ce.conversion_point_id
                 WHERE substr(ce.created_at, 1, 10) >= ? AND substr(ce.created_at, 1, 10) <= ? AND ${account.sql}
                 GROUP BY ce.conversion_point_id, route_key ORDER BY total_count DESC, route_key ASC`)
      .bind(input.range.from.slice(0, 10), input.range.to.slice(0, 10), ...account.values)
      .all<{ conversion_point_id: string; route_key: string; total_count: number; total_value: number }>(),
    db.prepare(`SELECT rt.ref_code, COUNT(DISTINCT rt.friend_id) AS audience
                  FROM ref_tracking rt
                  JOIN friends f ON f.id = rt.friend_id
                 WHERE substr(rt.created_at, 1, 10) >= ? AND substr(rt.created_at, 1, 10) <= ?
                   AND ${friendAccount.sql}
                 GROUP BY rt.ref_code`)
      .bind(input.range.from.slice(0, 10), input.range.to.slice(0, 10), ...friendAccount.values)
      .all<{ ref_code: string; audience: number }>(),
  ]);
  const audienceByRoute = new Map(audienceRows.results.map((row) => [row.ref_code, Number(row.audience)]));
  const routeMetric = (routeKey: string, netCount: number) => {
    // 未帰属には母数が無い。帰属ありでも期間内の記録がなければ null のまま
    // 返し、画面が「母数の記録なし」と理由を出せるようにする。
    if (routeKey === 'unattributed') return { audience: null, conversionRate: null };
    const audience = audienceByRoute.get(routeKey) ?? null;
    return {
      audience,
      conversionRate: audience !== null && audience > 0
        ? Math.round((netCount / audience) * 1000) / 10
        : null,
    };
  };
  const routesByDefinition = new Map<string, Array<{ routeKey: string; label: string; attributionState: 'attributed' | 'unattributed'; netCount: number; netValue: number; audience: number | null; conversionRate: number | null }>>();
  for (const row of routeRows.results) {
    const netCount = Number(row.total_count);
    const route = { routeKey: row.route_key, label: row.route_key === 'unattributed' ? '未帰属' : row.route_key, attributionState: row.route_key === 'unattributed' ? 'unattributed' as const : 'attributed' as const, netCount, netValue: Number(row.total_value), ...routeMetric(row.route_key, netCount) };
    routesByDefinition.set(row.conversion_point_id, [...(routesByDefinition.get(row.conversion_point_id) ?? []), route]);
  }
  const byDefinition = current.map((row) => {
    const before = previousById.get(row.conversion_point_id);
    return {
      conversionPointId: row.conversion_point_id,
      conversionPointName: row.conversion_point_name,
      sourceType: row.event_type,
      netCount: Number(row.total_count) - (currentCancellations.get(row.conversion_point_id)?.count ?? 0),
      netValue: Number(row.total_value) - (currentCancellations.get(row.conversion_point_id)?.value ?? 0),
      previousNetCount: Number(before?.total_count ?? 0) - (previousCancellations.get(row.conversion_point_id)?.count ?? 0),
      previousNetValue: Number(before?.total_value ?? 0) - (previousCancellations.get(row.conversion_point_id)?.value ?? 0),
      countChange: (Number(row.total_count) - (currentCancellations.get(row.conversion_point_id)?.count ?? 0)) - (Number(before?.total_count ?? 0) - (previousCancellations.get(row.conversion_point_id)?.count ?? 0)),
      cancellationCount: currentCancellations.get(row.conversion_point_id)?.count ?? null,
      cancellationValue: currentCancellations.get(row.conversion_point_id)?.value ?? null,
      routes: routesByDefinition.get(row.conversion_point_id) ?? [],
    };
  });
  const fastestGrowing = byDefinition
    .filter((row) => row.netCount > 0 || row.previousNetCount > 0)
    .sort((a, b) => b.countChange - a.countChange)[0] ?? null;
  return {
    range: input.range,
    previousRange: input.previousRange,
    kpis: {
      recordedCount: totals.count,
      reversedCount: [...currentCancellations.values()].reduce((sum, metric) => sum + metric.count, 0) || null,
      netCount: totals.count,
      netValue: totals.value,
      averageNetValue: totals.count > 0 ? Math.round((totals.value / totals.count) * 100) / 100 : null,
      previousNetCount: previousTotals.count,
      previousNetValue: previousTotals.value,
      countChangeRate: previousTotals.count > 0
        ? Math.round(((totals.count - previousTotals.count) / previousTotals.count) * 10_000) / 100
        : null,
      reversalState: currentCancellations.size > 0 ? 'available' as const : 'unavailable' as const,
      reversalReason: currentCancellations.size > 0 ? '取消イベント台帳から集計' : '取消イベント台帳はまだ接続されていません',
      cancellationCount: [...currentCancellations.values()].reduce((sum, metric) => sum + metric.count, 0) || null,
      cancellationValue: [...currentCancellations.values()].reduce((sum, metric) => sum + metric.value, 0) || null,
      fastestGrowing,
    },
    daily: dailyRows.results.map((row) => ({
      day: row.day,
      conversionPointId: row.conversion_point_id,
      conversionPointName: row.conversion_point_name,
      netCount: Number(row.total_count),
      netValue: Number(row.total_value),
    })),
    byDefinition,
    byRoute: [...routeRows.results].reduce((all, row) => {
      const existing = all.find((item) => item.routeKey === row.route_key);
      if (existing) {
        existing.netCount += Number(row.total_count);
        existing.netValue += Number(row.total_value);
        const metric = routeMetric(row.route_key, existing.netCount);
        existing.audience = metric.audience;
        existing.conversionRate = metric.conversionRate;
        return all;
      }
      const netCount = Number(row.total_count);
      all.push({
      routeKey: row.route_key,
      label: row.route_key === 'unattributed' ? '未帰属' : row.route_key,
      attributionState: row.route_key === 'unattributed' ? 'unattributed' : 'attributed',
      netCount,
      netValue: Number(row.total_value),
      ...routeMetric(row.route_key, netCount),
      });
      return all;
    }, [] as Array<{ routeKey: string; label: string; attributionState: 'attributed' | 'unattributed'; netCount: number; netValue: number; audience: number | null; conversionRate: number | null }>),
  };
}

export async function listConversionDefinitionsForExport(
  db: D1Database,
  input: Omit<ConversionDefinitionListInput, 'cursor' | 'limit'>,
): Promise<{ items: ConversionDefinitionListItem[]; truncated: boolean }> {
  const cte = metricsCte(input.range);
  const where = definitionWhere(input);
  // N-267: 上限そのもの(10000)ではなく +1 件まで読み、切れたことを確実に
  // 検出して呼び出し側へ返す。黙って切るとCSVが未完の一覧に見える。
  const rows = await db.prepare(`${cte.sql}
    ${selectDefinitionsSql()}
     WHERE ${where.sql}
     ORDER BY ${orderBy(input.sort)}
     LIMIT 10001`)
    .bind(...cte.values, ...where.values)
    .all<DefinitionRow>();
  const truncated = rows.results.length > 10000;
  const items = truncated ? rows.results.slice(0, 10000) : rows.results;
  return { items: items.map((row) => serializeDefinition(row)), truncated };
}
