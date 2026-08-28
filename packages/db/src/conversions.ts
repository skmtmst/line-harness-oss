import { jstNow } from './utils.js';
import { resolveAffiliateAttribution } from './affiliate-attribution.js';
// =============================================================================
// Conversion Points & Events — CV Tracking
// =============================================================================

export type ConversionMeasureMethod = 'url_reach' | 'webhook' | 'manual';

export interface ConversionPoint {
  id: string;
  name: string;
  event_type: string;
  value: number | null;
  /** どうやって数えるか。既定は manual（人が記録する） */
  measure_method: ConversionMeasureMethod;
  /** url_reach のときの対象URL。前方一致で判定する */
  target_url: string | null;
  /** 同じ人を何度でも数えるか（1）、一人一回だけか（0） */
  count_repeat: number;
  /** 成果を紐づける日数。NULL なら全体の既定（90日）を使う */
  attribution_days: number | null;
  /** 集計対象を1アカウントに絞る場合。NULL なら全アカウント */
  line_account_id: string | null;
  status: 'active' | 'stopped';
  stopped_at: string | null;
  updated_at: string;
  created_at: string;
}

export interface ConversionEvent {
  id: string;
  conversion_point_id: string;
  friend_id: string;
  user_id: string | null;
  affiliate_code: string | null;
  metadata: string | null;
  created_at: string;
  affiliate_id: string | null;
  attributed_ref_code: string | null;
  /** Approval state for affiliate-attributed CVs (ASP Phase 2). NULL if non-attributed. */
  approval_status: 'pending' | 'approved' | 'rejected' | null;
  approved_at: string | null;
  point_name_snapshot: string | null;
  event_type_snapshot: string | null;
  value_snapshot: number | null;
  idempotency_key: string | null;
}

// ── Conversion Points CRUD ──────────────────────────────────────────────────

export async function getConversionPoints(
  db: D1Database,
  opts: { lineAccountId?: string | null } = {},
): Promise<ConversionPoint[]> {
  const scoped = 'lineAccountId' in opts;
  const result = await db
    .prepare(
      `SELECT * FROM conversion_points
        ${scoped ? 'WHERE line_account_id IS ?' : ''}
        ORDER BY status = 'active' DESC, created_at DESC`,
    )
    .bind(...(scoped ? [opts.lineAccountId ?? null] : []))
    .all<ConversionPoint>();
  return result.results;
}

export interface ConversionPointUsage {
  conversionPointId: string;
  kind: 'analytics_funnel';
  consumerId: string;
  consumerName: string;
  href: string;
}

/**
 * 成果地点を設定として参照している場所を、構造化された列だけから集める。
 *
 * JSON文字列の全文検索は、似たIDや説明文まで拾うため正本にしない。旧ファネルは
 * `funnel_steps.kind` と `match_json.conversionPointId`、V6ファネルは公開版の
 * `steps_json[].match.conversionPointId` を見る。同じファネルが移行前後の両方に
 * 残っていても、画面では1件にまとめる。
 */
export async function getConversionPointUsage(
  db: D1Database,
  opts: { lineAccountId?: string | null } = {},
): Promise<ConversionPointUsage[]> {
  const scoped = 'lineAccountId' in opts;
  const accountCondition = scoped ? 'AND f.line_account_id IS ?' : '';
  const accountValues = scoped ? [opts.lineAccountId ?? null] : [];
  const [legacy, versioned] = await Promise.all([
    db.prepare(
      `SELECT
         json_extract(fs.match_json, '$.conversionPointId') AS conversion_point_id,
         f.id AS consumer_id,
         f.name AS consumer_name
       FROM funnel_steps fs
       JOIN funnels f ON f.id = fs.funnel_id
       WHERE fs.kind = 'conversion'
         AND json_type(fs.match_json, '$.conversionPointId') = 'text'
         ${accountCondition}`,
    ).bind(...accountValues).all<{ conversion_point_id: string; consumer_id: string; consumer_name: string }>(),
    db.prepare(
      `WITH latest AS (
         SELECT funnel_id, MAX(version_number) AS version_number
         FROM analytics_funnel_versions
         GROUP BY funnel_id
       )
       SELECT
         json_extract(step.value, '$.match.conversionPointId') AS conversion_point_id,
         f.id AS consumer_id,
         f.name AS consumer_name
       FROM analytics_funnel_versions v
       JOIN latest l
         ON l.funnel_id = v.funnel_id AND l.version_number = v.version_number
       JOIN funnels f ON f.id = v.funnel_id
       CROSS JOIN json_each(v.steps_json) AS step
       WHERE json_extract(step.value, '$.kind') = 'conversion'
         AND json_type(step.value, '$.match.conversionPointId') = 'text'
         ${accountCondition}`,
    ).bind(...accountValues).all<{ conversion_point_id: string; consumer_id: string; consumer_name: string }>(),
  ]);

  const result: ConversionPointUsage[] = [];
  const seen = new Set<string>();
  for (const row of [...legacy.results, ...versioned.results]) {
    const key = `${row.conversion_point_id}:analytics_funnel:${row.consumer_id}`;
    if (seen.has(key)) continue;
    seen.add(key);
    result.push({
      conversionPointId: row.conversion_point_id,
      kind: 'analytics_funnel',
      consumerId: row.consumer_id,
      consumerName: row.consumer_name,
      href: '/analytics?tab=funnel',
    });
  }
  return result;
}

export async function getConversionPointById(
  db: D1Database,
  id: string,
): Promise<ConversionPoint | null> {
  return db
    .prepare(`SELECT * FROM conversion_points WHERE id = ?`)
    .bind(id)
    .first<ConversionPoint>();
}

export interface ConversionPointOptions {
  measureMethod?: ConversionMeasureMethod;
  targetUrl?: string | null;
  countRepeat?: boolean;
  attributionDays?: number | null;
  lineAccountId?: string | null;
}

export interface CreateConversionPointInput extends ConversionPointOptions {
  name: string;
  eventType: string;
  value?: number | null;
}

export async function createConversionPoint(
  db: D1Database,
  input: CreateConversionPointInput,
): Promise<ConversionPoint> {
  const id = crypto.randomUUID();
  const now = jstNow();

  await db
    .prepare(
      `INSERT INTO conversion_points
         (id, name, event_type, value, measure_method, target_url,
          count_repeat, attribution_days, line_account_id, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(
      id,
      input.name,
      input.eventType,
      input.value ?? null,
      input.measureMethod ?? 'manual',
      input.targetUrl ?? null,
      input.countRepeat === false ? 0 : 1,
      input.attributionDays ?? null,
      input.lineAccountId ?? null,
      now,
    )
    .run();

  return (await getConversionPointById(db, id))!;
}

export interface UpdateConversionPointInput extends ConversionPointOptions {
  name?: string;
  eventType?: string;
  value?: number | null;
}

/**
 * 成果地点を書き換える。送られた項目だけを触る。
 *
 * 全項目を上書きする形にしないのは、画面が「計測方法だけ変える」
 * ような部分更新をするため。既存値を読んでから丸ごと書き戻すと、
 * 同時に別の項目を変えた分を巻き戻してしまう。
 */
export async function updateConversionPoint(
  db: D1Database,
  id: string,
  input: UpdateConversionPointInput,
): Promise<ConversionPoint | null> {
  const sets: string[] = [];
  const values: unknown[] = [];
  const put = (column: string, value: unknown) => {
    sets.push(`${column} = ?`);
    values.push(value);
  };
  if (input.name !== undefined) put('name', input.name);
  if (input.eventType !== undefined) put('event_type', input.eventType);
  if ('value' in input) put('value', input.value ?? null);
  if (input.measureMethod !== undefined) put('measure_method', input.measureMethod);
  if ('targetUrl' in input) put('target_url', input.targetUrl ?? null);
  if (input.countRepeat !== undefined) put('count_repeat', input.countRepeat ? 1 : 0);
  if ('attributionDays' in input) put('attribution_days', input.attributionDays ?? null);
  if ('lineAccountId' in input) put('line_account_id', input.lineAccountId ?? null);
  if (sets.length === 0) return getConversionPointById(db, id);
  put('updated_at', jstNow());
  values.push(id);
  await db
    .prepare(`UPDATE conversion_points SET ${sets.join(', ')} WHERE id = ?`)
    .bind(...values)
    .run();
  return getConversionPointById(db, id);
}

/**
 * このURLに到達したときに数える成果地点を探す。
 *
 * target_url の前方一致で見る。完全一致にすると、クエリ文字列
 * （?utm_source=... など）が付いた瞬間に数えられなくなる。
 * 逆に部分一致にすると、URLの途中にたまたま含まれるだけで数えてしまう。
 *
 * lineAccountId は「絞っていない地点（NULL）」と「このアカウントの地点」
 * の両方を拾う。
 */
export async function getUrlReachConversionPoints(
  db: D1Database,
  url: string,
  lineAccountId: string | null,
): Promise<ConversionPoint[]> {
  const result = await db
    .prepare(
      `SELECT * FROM conversion_points
        WHERE measure_method = 'url_reach'
          AND status = 'active'
          AND target_url IS NOT NULL
          AND target_url != ''
          AND ? LIKE target_url || '%'
          AND (line_account_id IS NULL OR line_account_id = ?)`,
    )
    .bind(url, lineAccountId)
    .all<ConversionPoint>();
  return result.results;
}

export async function stopConversionPoint(
  db: D1Database,
  id: string,
): Promise<void> {
  await db
    .prepare(`UPDATE conversion_points SET status = 'stopped', stopped_at = ?, updated_at = ? WHERE id = ?`)
    .bind(jstNow(), jstNow(), id)
    .run();
}

// ── Conversion Events ───────────────────────────────────────────────────────

export interface TrackConversionInput {
  conversionPointId: string;
  friendId: string;
  userId?: string | null;
  affiliateCode?: string | null;
  metadata?: string | null;
  idempotencyKey?: string | null;
}

/**
 * 成果を1件記録する。
 *
 * 成果地点の設定によって、記録せずに既存の1件を返すことがある
 * （count_repeat = 0 のとき）。呼び出し側から見て「必ず新しい行が増える」
 * とは限らない点に注意。重複を弾くのは呼び出し側ではなく、設定を持っている
 * ここの責任にしている。呼び出し口が複数あるため、各所で同じ判定を
 * 書くと必ずどこかで漏れる。
 */
export async function trackConversion(
  db: D1Database,
  input: TrackConversionInput,
): Promise<ConversionEvent> {
  const id = crypto.randomUUID();
  const now = jstNow();

  const point = await getConversionPointById(db, input.conversionPointId);
  if (!point) throw new Error('conversion_point_not_found');
  if (point.status === 'stopped') throw new Error('conversion_point_stopped');

  if (input.idempotencyKey) {
    const existing = await db
      .prepare(`SELECT * FROM conversion_events WHERE idempotency_key = ?`)
      .bind(input.idempotencyKey)
      .first<ConversionEvent>();
    if (existing) return existing;
  }

  // 一人一回だけ数える地点で、すでに記録があるなら、それを返して終わる。
  // 例外にしないのは、二重に踏むのは利用者にとって普通の行動で、
  // 呼び出し側に異常として扱わせるとログが埋まるため。
  if (point.count_repeat === 0) {
    const existing = await db
      .prepare(
        `SELECT * FROM conversion_events
          WHERE conversion_point_id = ? AND friend_id = ?
          ORDER BY created_at ASC LIMIT 1`,
      )
      .bind(input.conversionPointId, input.friendId)
      .first<ConversionEvent>();
    if (existing) return existing;
  }

  // Resolve last-touch affiliate attribution before inserting the event.
  // 地点ごとに期間を狭めたい場合があるので attribution_days を渡す
  // （NULL なら全体の既定 90 日）。
  const attr = await resolveAffiliateAttribution(db, input.friendId, undefined, {
    windowDays: point.attribution_days ?? undefined,
  });

  // Affiliate-attributed CVs enter the approval queue as 'pending'; non-attributed
  // CVs leave approval_status NULL (the approval flow only applies to attributed rows).
  const approvalStatus = attr ? 'pending' : null;

  await db
    .prepare(
      `INSERT OR IGNORE INTO conversion_events
       (id, conversion_point_id, friend_id, user_id, affiliate_code, metadata, created_at,
        affiliate_id, attributed_ref_code, approval_status, point_name_snapshot,
        event_type_snapshot, value_snapshot, idempotency_key)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(
      id,
      input.conversionPointId,
      input.friendId,
      input.userId ?? null,
      input.affiliateCode ?? null,
      input.metadata ?? null,
      now,
      attr?.affiliateId ?? null,
      attr?.refCode ?? null,
      approvalStatus,
      point.name,
      point.event_type,
      point.value,
      input.idempotencyKey ?? null,
    )
    .run();

  const created = await db
    .prepare(`SELECT * FROM conversion_events WHERE id = ?`)
    .bind(id)
    .first<ConversionEvent>();
  if (created) return created;
  return (await db
    .prepare(`SELECT * FROM conversion_events WHERE idempotency_key = ?`)
    .bind(input.idempotencyKey)
    .first<ConversionEvent>())!;
}

export async function getConversionEvents(
  db: D1Database,
  opts: {
    scope: { allowedAccountIds: readonly string[]; includeUnassigned: boolean };
    conversionPointId?: string;
    friendId?: string;
    affiliateCode?: string;
    startDate?: string;
    endDate?: string;
    limit?: number;
    offset?: number;
  },
): Promise<ConversionEvent[]> {
  const conditions: string[] = [];
  const values: unknown[] = [];

  if (opts.scope.allowedAccountIds.length > 0) {
    conditions.push(`(cp.line_account_id IN (${opts.scope.allowedAccountIds.map(() => '?').join(',')})${opts.scope.includeUnassigned ? ' OR cp.line_account_id IS NULL' : ''})`);
    values.push(...opts.scope.allowedAccountIds);
  } else {
    conditions.push(opts.scope.includeUnassigned ? 'cp.line_account_id IS NULL' : '1 = 0');
  }

  if (opts.conversionPointId) {
    conditions.push('ce.conversion_point_id = ?');
    values.push(opts.conversionPointId);
  }
  if (opts.friendId) {
    conditions.push('ce.friend_id = ?');
    values.push(opts.friendId);
  }
  if (opts.affiliateCode) {
    conditions.push('ce.affiliate_code = ?');
    values.push(opts.affiliateCode);
  }
  if (opts.startDate) {
    conditions.push('ce.created_at >= ?');
    values.push(opts.startDate);
  }
  if (opts.endDate) {
    conditions.push('ce.created_at <= ?');
    values.push(opts.endDate);
  }

  const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
  const limit = opts.limit ?? 100;
  const offset = opts.offset ?? 0;

  values.push(limit, offset);

  const result = await db
    .prepare(
      `SELECT ce.* FROM conversion_events ce
       JOIN conversion_points cp ON cp.id = ce.conversion_point_id
       ${where} ORDER BY ce.created_at DESC LIMIT ? OFFSET ?`,
    )
    .bind(...values)
    .all<ConversionEvent>();
  return result.results;
}

export interface ConversionReport {
  conversionPointId: string;
  conversionPointName: string;
  eventType: string;
  totalCount: number;
  totalValue: number;
}

export async function getConversionReport(
  db: D1Database,
  opts: { startDate?: string; endDate?: string; lineAccountId?: string | null } = {},
): Promise<ConversionReport[]> {
  const eventConditions: string[] = [];
  const eventValues: unknown[] = [];
  const pointConditions: string[] = [];
  const pointValues: unknown[] = [];

  if (opts.startDate) {
    eventConditions.push('ce.created_at >= ?');
    eventValues.push(opts.startDate);
  }
  if (opts.endDate) {
    eventConditions.push('ce.created_at <= ?');
    eventValues.push(opts.endDate);
  }
  if ('lineAccountId' in opts) {
    pointConditions.push('cp.line_account_id IS ?');
    pointValues.push(opts.lineAccountId ?? null);
  }

  const joinConditions = eventConditions.length > 0 ? `AND ${eventConditions.join(' AND ')}` : '';
  const where = pointConditions.length > 0 ? `WHERE ${pointConditions.join(' AND ')}` : '';

  const result = await db
    .prepare(
      `SELECT
         cp.id as conversion_point_id,
         cp.name as conversion_point_name,
         cp.event_type,
         COUNT(ce.id) as total_count,
         COALESCE(SUM(CASE WHEN ce.id IS NULL THEN 0 ELSE COALESCE(ce.value_snapshot, cp.value, 0) END), 0) as total_value
       FROM conversion_points cp
       LEFT JOIN conversion_events ce ON ce.conversion_point_id = cp.id ${joinConditions}
       ${where}
       GROUP BY cp.id
       ORDER BY total_count DESC`,
    )
    .bind(...eventValues, ...pointValues)
    .all<{
      conversion_point_id: string;
      conversion_point_name: string;
      event_type: string;
      total_count: number;
      total_value: number;
    }>();

  return result.results.map((r) => ({
    conversionPointId: r.conversion_point_id,
    conversionPointName: r.conversion_point_name,
    eventType: r.event_type,
    totalCount: r.total_count,
    totalValue: r.total_value,
  }));
}
