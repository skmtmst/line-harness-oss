import { boundedListLimit, jstNow, nonNegativeListOffset, toJstString } from './utils.js';
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
  /** 画面からの更新・利用先追加で使う楽観ロック版。 */
  version: number;
  /** 重複の数え方。window のときだけ deduplication_window_days を見る。 */
  deduplication_mode: string | null;
  /** window のときの期間日数。NULL なら期間が決まっていない扱い。 */
  deduplication_window_days: number | null;
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

export interface ConversionPointAccountScope {
  allowedLineAccountIds: string[];
  includeUnassigned: boolean;
}

export async function getConversionPoints(
  db: D1Database,
  scope?: ConversionPointAccountScope,
): Promise<ConversionPoint[]> {
  const accountWhere = !scope
    ? ''
    : scope.allowedLineAccountIds.length > 0
      ? `WHERE (line_account_id IN (${scope.allowedLineAccountIds.map(() => '?').join(',')})${scope.includeUnassigned ? ' OR line_account_id IS NULL' : ''})`
      : scope.includeUnassigned
        ? 'WHERE line_account_id IS NULL'
        : 'WHERE 1 = 0';
  const statement = db.prepare(
    `SELECT * FROM conversion_points ${accountWhere} ORDER BY created_at DESC`,
  );
  const result = scope?.allowedLineAccountIds.length
    ? await statement.bind(...scope.allowedLineAccountIds).all<ConversionPoint>()
    : await statement.all<ConversionPoint>();
  return result.results;
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
          count_repeat, attribution_days, line_account_id, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
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
/**
 * この成果地点に成果・利用先が付いているか。旧PUTの直接上書きを
 * 止めるための確認で、定義系の版ガードと同じ役割を持つ。
 */
export async function hasConversionPointActivity(
  db: D1Database,
  id: string,
): Promise<boolean> {
  const event = await db
    .prepare(`SELECT 1 AS hit FROM conversion_events WHERE conversion_point_id = ? LIMIT 1`)
    .bind(id)
    .first<{ hit: number }>();
  if (event) return true;
  const usage = await db
    .prepare(`SELECT 1 AS hit FROM conversion_definition_usages WHERE conversion_point_id = ? LIMIT 1`)
    .bind(id)
    .first<{ hit: number }>();
  return usage !== null;
}

export async function updateConversionPoint(
  db: D1Database,
  id: string,
  input: UpdateConversionPointInput,
  opts?: { expectedVersion?: number },
): Promise<ConversionPoint | null> {
  if (opts?.expectedVersion !== undefined) {
    const current = await getConversionPointById(db, id);
    if (!current) return null;
    if (current.version !== opts.expectedVersion) {
      throw new Error('conversion_point_version_conflict');
    }
  }
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
  sets.push('version = version + 1');
  put('updated_at', jstNow());
  // 版の確認は読み取り時だけでなく書込み時にも行う。同時に更新した
  // 側の片方を必ず弾くため、条件に版を含めた1文で書き換える。
  // 版の指定が無い従来の呼び出しは、以前どおり条件なしで書き換える。
  if (opts?.expectedVersion === undefined) {
    values.push(id);
    await db
      .prepare(`UPDATE conversion_points SET ${sets.join(', ')} WHERE id = ?`)
      .bind(...values)
      .run();
    return getConversionPointById(db, id);
  }
  const result = await db
    .prepare(`UPDATE conversion_points SET ${sets.join(', ')} WHERE id = ? AND version = ?`)
    .bind(...values, id, opts.expectedVersion)
    .run();
  if ((result.meta.changes ?? 0) === 0) {
    const current = await getConversionPointById(db, id);
    if (!current) return null;
    throw new Error('conversion_point_version_conflict');
  }
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

/**
 * 旧口の停止。版の一致を必須にし、稼働中の1文だけを止める。
 * 停止も版を進めるため、続く操作は新しい版でやり直す。
 */
export async function stopConversionPoint(
  db: D1Database,
  id: string,
  expectedVersion: number,
): Promise<ConversionPoint> {
  const now = jstNow();
  const result = await db
    .prepare(`UPDATE conversion_points SET status = 'stopped', stopped_at = ?,
      updated_at = ?, version = version + 1 WHERE id = ? AND version = ? AND status = 'active'`)
    .bind(now, now, id, expectedVersion)
    .run();
  if ((result.meta.changes ?? 0) === 0) {
    const current = await getConversionPointById(db, id);
    if (!current) throw new Error('conversion_point_not_found');
    if (current.status !== 'active') throw new Error('conversion_point_already_stopped');
    throw new Error('conversion_point_version_conflict');
  }
  return (await getConversionPointById(db, id))!;
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
function isUniqueViolation(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /UNIQUE constraint failed/i.test(message);
}

/**
 * 重複の数え方(lifetime / window / every)。定義作成時の対応
 * (every だけ count_repeat = 1、それ以外は 0)と合わせる。
 * 旧口で作った1人1回地点(count_repeat = 0、every のまま)は lifetime。
 * window で期間が決まっていない行は、厳しい側(lifetime)に倒す。
 */
export type ConversionDedupPolicy =
  | { kind: 'every' }
  | { kind: 'lifetime' }
  | { kind: 'window'; windowDays: number };

export function resolveDedupPolicy(point: {
  count_repeat: number;
  deduplication_mode?: string | null;
  deduplication_window_days?: number | null;
}): ConversionDedupPolicy {
  if ((point.deduplication_mode ?? 'every') === 'window') {
    const days = point.deduplication_window_days;
    if (Number.isInteger(days) && (days as number) >= 1 && (days as number) <= 365) {
      return { kind: 'window', windowDays: days as number };
    }
    return { kind: 'lifetime' };
  }
  if (point.deduplication_mode === 'once_per_friend' || point.count_repeat === 0) {
    return { kind: 'lifetime' };
  }
  return { kind: 'every' };
}

const JST_DAY_MS = 86_400_000;

/**
 * 成果の記録先アカウントの一致条件。地点のアカウントが NULL
 * (全アカウント対象)のときだけ交差を許可する。それ以外は地点と
 * 友だちが同じアカウントのときだけ記録できる。両方を見られる職員でも
 * 交差記録はできない。
 */
export function canRecordConversion(
  pointLineAccountId: string | null,
  friendLineAccountId: string | null,
): boolean {
  if (pointLineAccountId === null) return true;
  return pointLineAccountId === friendLineAccountId;
}

/**
 * 同じ冪等キーで送られた中身が同じか。同じ再送は同じ結果を返し、
 * 別内容の使い回しは409で弾く(N-255)。中身の比較は呼び出し側で
 * 文字列化済みの metadata まで含めて行う。
 */
function isSameIdempotencyContent(existing: ConversionEvent, input: TrackConversionInput): boolean {
  return existing.friend_id === input.friendId
    && (existing.user_id ?? null) === (input.userId ?? null)
    && (existing.affiliate_code ?? null) === (input.affiliateCode ?? null)
    && (existing.metadata ?? null) === (input.metadata ?? null);
}

function requireSameIdempotencyContent(existing: ConversionEvent, input: TrackConversionInput): void {
  if (!isSameIdempotencyContent(existing, input)) {
    throw new Error('conversion_idempotency_key_conflict');
  }
}

async function findEventByIdempotencyKey(
  db: D1Database,
  conversionPointId: string,
  idempotencyKey: string,
): Promise<ConversionEvent | null> {
  return db
    .prepare(`SELECT * FROM conversion_events WHERE conversion_point_id = ? AND idempotency_key = ?`)
    .bind(conversionPointId, idempotencyKey)
    .first<ConversionEvent>();
}

async function findClaimedEvent(
  db: D1Database,
  conversionPointId: string,
  friendId: string,
): Promise<ConversionEvent | null> {
  return db.prepare(`SELECT ce.* FROM conversion_event_dedup_claims claim
    JOIN conversion_events ce ON ce.id = claim.last_event_id
    WHERE claim.conversion_point_id = ? AND claim.friend_id = ?
      AND ce.conversion_point_id = claim.conversion_point_id
      AND ce.friend_id = claim.friend_id`)
    .bind(conversionPointId, friendId)
    .first<ConversionEvent>();
}

/**
 * 一括操作など、claimを通さずに直接書かれた成果を拾う。
 *
 * `conversion_event_dedup_claims` は claim を通った計上しか知らない。
 * `friend-bulk-runs` の `add_conversion` は成果表へ直接INSERTするため、
 * claimだけを見ていると「1人1回」の不変条件が破れる。数え方の権威は
 * 成果表そのものに置き、claimはその上の直列化装置として扱う。
 */
async function findBlockingEvent(
  db: D1Database,
  conversionPointId: string,
  friendId: string,
  cutoff: string | null,
): Promise<ConversionEvent | null> {
  return db.prepare(`SELECT * FROM conversion_events
    WHERE conversion_point_id = ? AND friend_id = ?
      AND (? IS NULL OR created_at >= ?)
    ORDER BY created_at ASC, id ASC LIMIT 1`)
    .bind(conversionPointId, friendId, cutoff, cutoff)
    .first<ConversionEvent>();
}

export async function trackConversion(
  db: D1Database,
  input: TrackConversionInput,
  runtime?: { now?: number },
): Promise<ConversionEvent> {
  const id = crypto.randomUUID();
  const nowMs = runtime?.now ?? Date.now();
  const now = toJstString(new Date(nowMs));

  const [point, friend] = await Promise.all([
    getConversionPointById(db, input.conversionPointId),
    db.prepare('SELECT line_account_id FROM friends WHERE id = ?')
      .bind(input.friendId)
      .first<{ line_account_id: string | null }>(),
  ]);
  if (!point) throw new Error('conversion_point_not_found');
  if (!friend) throw new Error('conversion_friend_not_found');
  if (point.status === 'stopped') throw new Error('conversion_point_stopped');
  // 管理API・公開 /t/:linkId・将来のcallerすべてに同じ境界を適用する。
  // 地点が全アカウント対象(NULL)の場合だけ、別accountの友だちを許可する。
  if (!canRecordConversion(point.line_account_id, friend.line_account_id)) {
    throw new Error('conversion_account_mismatch');
  }

  if (input.idempotencyKey) {
    const existing = await findEventByIdempotencyKey(db, input.conversionPointId, input.idempotencyKey);
    if (existing) {
      requireSameIdempotencyContent(existing, input);
      return existing;
    }
  }

  const policy = resolveDedupPolicy(point);

  // Resolve last-touch affiliate attribution before inserting the event.
  // 地点ごとに期間を狭めたい場合があるので attribution_days を渡す
  // （NULL なら全体の既定 90 日）。
  const attr = await resolveAffiliateAttribution(db, input.friendId, undefined, {
    windowDays: point.attribution_days ?? undefined,
  });

  // Affiliate-attributed CVs enter the approval queue as 'pending'; non-attributed
  // CVs leave approval_status NULL (the approval flow only applies to attributed rows).
  const approvalStatus = attr ? 'pending' : null;

  const eventValues = [
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
  ];
  try {
    if (policy.kind === 'every') {
      await db.prepare(`INSERT INTO conversion_events
        (id, conversion_point_id, friend_id, user_id, affiliate_code, metadata, created_at,
         affiliate_id, attributed_ref_code, approval_status, point_name_snapshot,
         event_type_snapshot, value_snapshot, idempotency_key)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
        .bind(...eventValues)
        .run();
    } else {
      const windowDays = policy.kind === 'window' ? policy.windowDays : null;
      const cutoff = policy.kind === 'window'
        ? toJstString(new Date(nowMs - policy.windowDays * JST_DAY_MS))
        : null;
      // claimを取る条件そのものに「数えてはいけない成果が無いこと」を入れる。
      // 一括操作の直接INSERTで入った成果もここで見えるため、claimを通らない
      // 経路があっても二重計上にならない。窓方式は期間内の成果だけを見る。
      // 併せて、claimが指す成果が消えている場合（一括削除の後に残る孤児）は
      // 不在として扱い、同じ1文でclaimを奪い直す。
      const claim = db.prepare(`INSERT INTO conversion_event_dedup_claims
          (conversion_point_id, friend_id, mode, window_days, last_event_id, last_at, updated_at)
        SELECT ?, ?, ?, ?, ?, ?, ?
         WHERE NOT EXISTS (
           SELECT 1 FROM conversion_events
            WHERE conversion_point_id = ? AND friend_id = ?
              AND (? IS NULL OR created_at >= ?)
         )
        ON CONFLICT(conversion_point_id, friend_id) DO UPDATE SET
          mode = excluded.mode,
          window_days = excluded.window_days,
          last_event_id = excluded.last_event_id,
          last_at = excluded.last_at,
          updated_at = excluded.updated_at
        WHERE conversion_event_dedup_claims.mode != excluded.mode
           OR conversion_event_dedup_claims.window_days IS NOT excluded.window_days
           OR (excluded.mode = 'window' AND conversion_event_dedup_claims.last_at < ?)
           OR NOT EXISTS (
                SELECT 1 FROM conversion_events
                 WHERE id = conversion_event_dedup_claims.last_event_id
              )`)
        .bind(
          input.conversionPointId,
          input.friendId,
          policy.kind,
          windowDays,
          id,
          now,
          now,
          input.conversionPointId,
          input.friendId,
          cutoff,
          cutoff,
          cutoff,
        );
      const insertIfClaimed = db.prepare(`INSERT INTO conversion_events
          (id, conversion_point_id, friend_id, user_id, affiliate_code, metadata, created_at,
           affiliate_id, attributed_ref_code, approval_status, point_name_snapshot,
           event_type_snapshot, value_snapshot, idempotency_key)
        SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?
         WHERE EXISTS (
           SELECT 1 FROM conversion_event_dedup_claims
            WHERE conversion_point_id = ? AND friend_id = ? AND last_event_id = ?
         )
           AND NOT EXISTS (
             SELECT 1 FROM conversion_events
              WHERE conversion_point_id = ? AND friend_id = ?
                AND (? IS NULL OR created_at >= ?)
           )`)
        .bind(
          ...eventValues,
          input.conversionPointId,
          input.friendId,
          id,
          input.conversionPointId,
          input.friendId,
          cutoff,
          cutoff,
        );
      const results = await db.batch([claim, insertIfClaimed]);
      if ((results[1]?.meta.changes ?? 0) === 0) {
        if (input.idempotencyKey) {
          const existingByKey = await findEventByIdempotencyKey(
            db,
            input.conversionPointId,
            input.idempotencyKey,
          );
          if (existingByKey) {
            requireSameIdempotencyContent(existingByKey, input);
            return existingByKey;
          }
        }
        const claimed = await findClaimedEvent(db, input.conversionPointId, input.friendId);
        if (claimed) return claimed;
        // claimを通らずに直接書かれた成果は claim からは辿れない。
        // 数え方の権威である成果表を直接見て、既存の1件を返す。
        const blocking = await findBlockingEvent(db, input.conversionPointId, input.friendId, cutoff);
        if (blocking) return blocking;
        throw new Error('conversion_dedup_claim_missing');
      }
    }
  } catch (error) {
    // every地点の同一冪等キー競合、またはclaim取得後のINSERT競合を回収する。
    // batch内の失敗はclaim更新も含めてD1がrollbackする。
    if (isUniqueViolation(error)) {
      if (input.idempotencyKey) {
        const existing = await findEventByIdempotencyKey(db, input.conversionPointId, input.idempotencyKey);
        if (existing) {
          requireSameIdempotencyContent(existing, input);
          return existing;
        }
      }
      const claimed = await findClaimedEvent(db, input.conversionPointId, input.friendId);
      if (claimed) return claimed;
      // every地点は何度でも数えるので、既存の成果で置き換えてはいけない。
      if (policy.kind !== 'every') {
        const blocking = await findBlockingEvent(
          db,
          input.conversionPointId,
          input.friendId,
          policy.kind === 'window'
            ? toJstString(new Date(nowMs - policy.windowDays * JST_DAY_MS))
            : null,
        );
        if (blocking) return blocking;
      }
    }
    throw error;
  }

  const created = await db
    .prepare(`SELECT * FROM conversion_events WHERE id = ?`)
    .bind(id)
    .first<ConversionEvent>();
  if (!created) throw new Error('conversion_event_insert_failed');
  return created;
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
  const limit = boundedListLimit(opts.limit, 100);
  const offset = nonNegativeListOffset(opts.offset);

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
  opts: { startDate?: string; endDate?: string } = {},
): Promise<ConversionReport[]> {
  const conditions: string[] = [];
  const values: unknown[] = [];

  if (opts.startDate) {
    conditions.push('ce.created_at >= ?');
    values.push(opts.startDate);
  }
  if (opts.endDate) {
    conditions.push('ce.created_at <= ?');
    values.push(opts.endDate);
  }

  const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

  const result = await db
    .prepare(
      `SELECT
         cp.id as conversion_point_id,
         cp.name as conversion_point_name,
         cp.event_type,
         COUNT(ce.id) as total_count,
         COALESCE(SUM(CASE WHEN ce.id IS NULL THEN 0 ELSE COALESCE(ce.value_snapshot, cp.value, 0) END), 0) as total_value
       FROM conversion_points cp
       LEFT JOIN conversion_events ce ON ce.conversion_point_id = cp.id ${conditions.length > 0 ? `AND ${conditions.join(' AND ')}` : ''}
       GROUP BY cp.id
       ORDER BY total_count DESC`,
    )
    .bind(...values)
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
