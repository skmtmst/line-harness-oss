import { sqlIdSet } from '../id-queries.js';
import { type ConversionDefinitionUsageKind, type ConversionDefinitionScope, type ConversionDefinitionFilter, type ConversionDefinitionListInput, type ConversionDefinitionRange, type ConversionDefinitionSort, type CancellationMetric, type DefinitionRow, type ConversionDefinitionState, type ConversionDefinitionListItem, type UsageRow, type ConversionDefinitionUsage } from './types.js';



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

export function usageName(row: { ref_kind: ConversionDefinitionUsageKind; ref_id: string }): string {
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
export const USAGE_REF_CHECKS: Record<ConversionDefinitionUsageKind, { sql: string; accountScoped: boolean }> = {
  affiliate_offer: { sql: `SELECT id FROM affiliate_offers WHERE id = ? AND (line_account_id IS NULL OR line_account_id = ?)`, accountScoped: true },
  analytics: { sql: `SELECT id FROM funnels WHERE id = ? AND (line_account_id IS NULL OR line_account_id = ?)`, accountScoped: true },
  auto_reply: { sql: `SELECT id FROM auto_replies WHERE id = ? AND (line_account_id IS NULL OR line_account_id = ?)`, accountScoped: true },
  scenario: { sql: `SELECT id FROM scenarios WHERE id = ? AND (line_account_id IS NULL OR line_account_id = ?)`, accountScoped: true },
  nen_campaign: { sql: `SELECT campaign_key AS id FROM nen_campaign_settings WHERE campaign_key = ?`, accountScoped: false },
  mileage_rule: { sql: `SELECT id FROM mileage_rules WHERE id = ? AND (line_account_id IS NULL OR line_account_id = ?)`, accountScoped: true },
  automation: { sql: `SELECT id FROM automations WHERE id = ? AND (line_account_id IS NULL OR line_account_id = ?)`, accountScoped: true },
  ad_platform: { sql: `SELECT id FROM ad_platforms WHERE id = ? AND (line_account_id IS NULL OR line_account_id = ?)`, accountScoped: true },
};

export async function assertUsageRefExists(
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

export function accountWhere(
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
      sql: `(${column} IN (${sqlIdSet(scope.allowedAccountIds).sql})${scope.includeUnassigned ? ` OR ${column} IS NULL` : ''})`,
      values: scope.allowedAccountIds.length ? sqlIdSet(scope.allowedAccountIds).binds : [],
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
export const INVALID_CONFIG_SQL = `(
  (cp.measure_method = 'url_reach' AND (cp.target_url IS NULL OR cp.target_url = ''))
  OR (cp.value_mode = 'fixed' AND cp.value IS NULL)
  OR (cp.deduplication_mode = 'window' AND (cp.deduplication_window_days IS NULL
    OR cp.deduplication_window_days < 1 OR cp.deduplication_window_days > 365))
)`;

/** N-270: 「起点停止」= 地点は動いているが外部受信を明示的に止めている。 */
export const SOURCE_STOPPED_SQL = `(cp.measure_method = 'webhook' AND cp.ingest_disabled_at IS NOT NULL)`;

/** N-267: 「どこからも使われていない」は利用先台帳の不存在で判定する。 */
export const UNUSED_SQL = `NOT EXISTS (SELECT 1 FROM conversion_definition_usages u WHERE u.conversion_point_id = cp.id)`;

/**
 * N-268: state 絞り込みを SQL へそのまま落とす。導出状態の並びは
 * serializeDefinition 側の deriveDefinitionState と必ず一致させる。
 */
export function stateFilterSql(state: ConversionDefinitionFilter): string {
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

export function definitionWhere(
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

export function metricsCte(range: ConversionDefinitionRange): { sql: string; values: unknown[] } {
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

export function selectDefinitionsSql(): string {
  return `SELECT cp.id, cp.folder_id, cp.name, cp.event_type, cp.value, cp.measure_method, cp.target_url,
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

export function orderBy(sort: ConversionDefinitionSort): string {
  if (sort === 'value_desc') return 'cp.value DESC, cp.updated_at DESC, cp.id ASC';
  if (sort === 'name_asc') return 'cp.name ASC, cp.id ASC';
  if (sort === 'updated_desc') return 'cp.updated_at DESC, cp.id ASC';
  return 'recorded_count DESC, cp.updated_at DESC, cp.id ASC';
}

export async function cancellationMetrics(db: D1Database, from: string, to: string): Promise<Map<string, CancellationMetric>> {
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
 * #819: 成果イベントの取消台帳(conversion_event_reversals)の集計。
 * 最新の追記が 'reverse' の成果だけを「取り消し中」として数える。
 * 'restore' が最後に来たものは数え直しの対象に戻る。
 * 台帳がまだ無い環境(移行前)では空を返して既存表示を壊さない。
 */
export async function reversalMetrics(db: D1Database, from: string, to: string): Promise<Map<string, CancellationMetric>> {
  const table = await db
    .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name = 'conversion_event_reversals'")
    .first<{ name: string }>();
  if (!table) return new Map();
  const rows = await db.prepare(`SELECT ce.conversion_point_id,
      COUNT(*) AS reversal_count,
      COALESCE(SUM(COALESCE(ce.value_snapshot, 0)), 0) AS reversal_value
    FROM conversion_event_reversals r
    JOIN conversion_events ce ON ce.id = r.conversion_event_id
   WHERE r.kind = 'reverse'
     AND r.rowid = (
       SELECT r2.rowid
         FROM conversion_event_reversals r2
        WHERE r2.conversion_event_id = ce.id
        ORDER BY r2.created_at DESC, r2.rowid DESC
        LIMIT 1
     )
     AND substr(r.created_at, 1, 10) >= ? AND substr(r.created_at, 1, 10) <= ?
   GROUP BY ce.conversion_point_id`).bind(from.slice(0, 10), to.slice(0, 10)).all<{ conversion_point_id: string; reversal_count: number; reversal_value: number }>();
  return new Map(rows.results.map((row) => [row.conversion_point_id, { count: Number(row.reversal_count), value: Number(row.reversal_value) }]));
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

export function serializeDefinition(row: DefinitionRow, cancellation?: CancellationMetric, reversal?: CancellationMetric): ConversionDefinitionListItem {
  const derived = deriveDefinitionState(row);
  // #819: 取消は追記台帳(reversal)とアフィリエイト調整(cancellation)の両方から来る。
  // 純数・純額は両方を引いた値にする。
  const reversedTotal = (reversal?.count ?? 0) + (cancellation?.count ?? 0);
  const reversedValue = (reversal?.value ?? 0) + (cancellation?.value ?? 0);
  return {
    id: row.id,
    name: row.name,
    folderId: row.folder_id ?? null,
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
      netCount: Number(row.recorded_count) - (reversal?.count ?? 0),
      reversedCount: reversedTotal > 0 || reversal || cancellation ? reversedTotal : null,
      reversedValue: reversal || cancellation ? reversedValue : null,
      netValue: Number(row.net_value) - reversedValue,
      reversalState: reversal || cancellation ? 'available' : 'unavailable',
      reversalReason: reversal || cancellation ? '取消イベント台帳から集計' : '取消イベント台帳はまだ接続されていません',
      cancellationCount: cancellation?.count ?? null,
      cancellationValue: cancellation?.value ?? null,
    },
    stoppedAt: row.stopped_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function serializeUsage(row: UsageRow): ConversionDefinitionUsage {
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
