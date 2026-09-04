import { jstNow } from './utils.js';
import { FRIEND_ADD_WINNER_SUBQUERY } from './affiliate-report.js';
import { generateRefSlug } from './affiliate-links.js';
// =============================================================================
// Affiliates — Affiliate & Tracking System
// =============================================================================

export interface Affiliate {
  id: string;
  tenant_id: string;
  line_account_id: string | null;
  name: string;
  code: string;
  commission_rate: number;
  is_active: number;
  created_at: string;
  friend_id: string | null;
  /** 連絡先。報酬の連絡に使う。NULL なら未登録 */
  email: string | null;
  /** 成果が確定するまでの保留日数。NULL なら即確定 */
  hold_days: number | null;
  /** 支払いサイクルの覚書。計算には使わない */
  payout_cycle: string | null;
  /** 成果が出たときに本人へ知らせるか */
  notify_on_conversion: number;
}

/** 認証利用者が読める紹介者の所属範囲。tenant と account の両方を必須にする。 */
export interface AffiliateScope {
  tenantId: string;
  allowedLineAccountIds: string[];
  includeUnassigned?: boolean;
}

function affiliateScopeSql(scope: AffiliateScope, alias = ''): {
  sql: string;
  binds: unknown[];
} {
  const column = (name: string) => `${alias}${name}`;
  const accountParts: string[] = [];
  const binds: unknown[] = [scope.tenantId];
  if (scope.allowedLineAccountIds.length > 0) {
    accountParts.push(
      `${column('line_account_id')} IN (${scope.allowedLineAccountIds.map(() => '?').join(', ')})`,
    );
    binds.push(...scope.allowedLineAccountIds);
  }
  if (scope.includeUnassigned) accountParts.push(`${column('line_account_id')} IS NULL`);
  return {
    sql: `${column('tenant_id')} = ? AND (${accountParts.join(' OR ') || '0 = 1'})`,
    binds,
  };
}

export interface AffiliateClick {
  id: string;
  affiliate_id: string;
  url: string | null;
  ip_address: string | null;
  created_at: string;
}

// ── Affiliate CRUD ──────────────────────────────────────────────────────────

export async function getAffiliates(
  db: D1Database,
  scope?: AffiliateScope,
): Promise<Affiliate[]> {
  const scoped = scope ? affiliateScopeSql(scope) : null;
  const result = await db
    .prepare(
      `SELECT * FROM affiliates${scoped ? ` WHERE ${scoped.sql}` : ''} ORDER BY created_at DESC`,
    )
    .bind(...(scoped?.binds ?? []))
    .all<Affiliate>();
  return result.results;
}

export async function getAffiliateById(
  db: D1Database,
  id: string,
  scope?: AffiliateScope,
): Promise<Affiliate | null> {
  const scoped = scope ? affiliateScopeSql(scope) : null;
  return db
    .prepare(`SELECT * FROM affiliates WHERE id = ?${scoped ? ` AND ${scoped.sql}` : ''}`)
    .bind(id, ...(scoped?.binds ?? []))
    .first<Affiliate>();
}

export async function getAffiliateByCode(
  db: D1Database,
  code: string,
): Promise<Affiliate | null> {
  return db
    .prepare(`SELECT * FROM affiliates WHERE code = ?`)
    .bind(code)
    .first<Affiliate>();
}

export interface CreateAffiliateInput {
  tenantId: string;
  lineAccountId: string;
  name: string;
  code: string;
  commissionRate?: number;
  /** Optional LINE friend UUID to bind for self-serve (LIFF) affiliates. */
  friendId?: string | null;
}

export async function createAffiliate(
  db: D1Database,
  input: CreateAffiliateInput,
): Promise<Affiliate> {
  const id = crypto.randomUUID();
  const now = jstNow();

  await db
    .prepare(
      `INSERT INTO affiliates
         (id, tenant_id, line_account_id, name, code, commission_rate, is_active, created_at, friend_id)
       VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?)`,
    )
    .bind(
      id,
      input.tenantId,
      input.lineAccountId,
      input.name,
      input.code,
      input.commissionRate ?? 0,
      now,
      input.friendId ?? null,
    )
    .run();

  return (await getAffiliateById(db, id))!;
}

export interface CreateAffiliateWithRandomCodeInput {
  tenantId: string;
  lineAccountId: string;
  name: string;
  commissionRate?: number;
  /** Optional LINE friend UUID to bind (enforced 1:1 by the partial UNIQUE index). */
  friendId?: string | null;
}

/**
 * Create an affiliate whose `code` is a random, unguessable base62 slug.
 *
 * Collision retry strategy mirrors createAffiliateLink:
 *  - Attempt 1..3: 6-char slug
 *  - Attempt 4+  : 8-char slug (virtually collision-free)
 *
 * Only a UNIQUE collision on `affiliates.code` triggers a retry. A collision on
 * the `friend_id` partial UNIQUE index (friend already an affiliate) is NOT a
 * code collision, so it is re-thrown for the caller to map to a 409.
 *
 * `_slugGen` is injectable so tests can force a deterministic collision path.
 */
export async function createAffiliateWithRandomCode(
  db: D1Database,
  input: CreateAffiliateWithRandomCodeInput,
  _slugGen: (len: number) => string = generateRefSlug,
): Promise<Affiliate> {
  const id = crypto.randomUUID();
  const now = jstNow();

  let attempt = 0;
  while (true) {
    attempt++;
    const len = attempt <= 3 ? 6 : 8;
    const code = _slugGen(len);

    try {
      await db
        .prepare(
          `INSERT INTO affiliates
             (id, tenant_id, line_account_id, name, code, commission_rate, is_active, created_at, friend_id)
           VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?)`,
        )
        .bind(
          id,
          input.tenantId,
          input.lineAccountId,
          input.name,
          code,
          input.commissionRate ?? 0,
          now,
          input.friendId ?? null,
        )
        .run();

      return (await getAffiliateById(db, id))!;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      // Retry ONLY on a code collision. Any other UNIQUE violation (notably the
      // friend_id partial index) must propagate so the caller can return 409.
      if (
        /UNIQUE constraint failed/i.test(msg) &&
        /affiliates\.code/i.test(msg)
      ) {
        continue;
      }
      throw err;
    }
  }
}

export type UpdateAffiliateInput = Partial<
  Pick<
    Affiliate,
    | 'name'
    | 'commission_rate'
    | 'is_active'
    | 'email'
    | 'hold_days'
    | 'payout_cycle'
    | 'notify_on_conversion'
  >
>;

export async function updateAffiliate(
  db: D1Database,
  id: string,
  updates: UpdateAffiliateInput,
  scope?: AffiliateScope,
): Promise<Affiliate | null> {
  const fields: string[] = [];
  const values: unknown[] = [];

  if (updates.name !== undefined) {
    fields.push('name = ?');
    values.push(updates.name);
  }
  if (updates.commission_rate !== undefined) {
    fields.push('commission_rate = ?');
    values.push(updates.commission_rate);
  }
  if (updates.is_active !== undefined) {
    fields.push('is_active = ?');
    values.push(updates.is_active);
  }
  // 支払いの取り決めは、送られたときだけ触る。空文字は「消す」意味で
  // NULL に寄せる。画面の入力欄を空にした = 未登録に戻す、と読める形にする。
  if ('email' in updates) {
    fields.push('email = ?');
    values.push(updates.email || null);
  }
  if ('hold_days' in updates) {
    fields.push('hold_days = ?');
    values.push(updates.hold_days ?? null);
  }
  if ('payout_cycle' in updates) {
    fields.push('payout_cycle = ?');
    values.push(updates.payout_cycle || null);
  }
  if (updates.notify_on_conversion !== undefined) {
    fields.push('notify_on_conversion = ?');
    values.push(updates.notify_on_conversion);
  }

  if (fields.length === 0) return getAffiliateById(db, id, scope);

  const scoped = scope ? affiliateScopeSql(scope) : null;
  values.push(id, ...(scoped?.binds ?? []));
  await db
    .prepare(
      `UPDATE affiliates SET ${fields.join(', ')} WHERE id = ?${scoped ? ` AND ${scoped.sql}` : ''}`,
    )
    .bind(...values)
    .run();

  return getAffiliateById(db, id, scope);
}

export async function deleteAffiliate(
  db: D1Database,
  id: string,
): Promise<void> {
  await db.prepare(`DELETE FROM affiliates WHERE id = ?`).bind(id).run();
}

// ── Affiliate Clicks ────────────────────────────────────────────────────────

export async function recordAffiliateClick(
  db: D1Database,
  affiliateId: string,
  url?: string | null,
  ipAddress?: string | null,
): Promise<AffiliateClick> {
  const id = crypto.randomUUID();
  const now = jstNow();

  await db
    .prepare(
      `INSERT INTO affiliate_clicks (id, affiliate_id, url, ip_address, created_at)
       VALUES (?, ?, ?, ?, ?)`,
    )
    .bind(id, affiliateId, url ?? null, ipAddress ?? null, now)
    .run();

  return (await db
    .prepare(`SELECT * FROM affiliate_clicks WHERE id = ?`)
    .bind(id)
    .first<AffiliateClick>())!;
}

// ── Affiliate Report ────────────────────────────────────────────────────────

export interface AffiliateReport {
  affiliateId: string;
  affiliateName: string;
  code: string;
  commissionRate: number;
  /**
   * ref_tracking touches on this affiliate's links — the SAME source as the
   * detail panel's "クリック (ref_tracking)" card (getAffiliateReportV2.clicks),
   * so the list column and the expanded detail always agree.
   */
  totalClicks: number;
  /**
   * Conversions attributed to this affiliate via EITHER the affiliate_id
   * snapshot (ASP ref-code path) OR the legacy affiliate_code match. The OR keeps
   * each conversion_events row counted at most once per affiliate (a row matching
   * both predicates for the same affiliate is not double-counted).
   */
  totalConversions: number;
  totalRevenue: number;
  /**
   * Approved conversions paid at the fixed amount configured on each offer.
   * Percentage-based affiliates continue to calculate their reward in the web
   * layer from totalRevenue and commissionRate.
   */
  confirmedReward: number;
  /** Number of affiliate_links (ref_codes) belonging to this affiliate. */
  linkCount: number;
  /** Friends whose add-time last-touch attribution is this affiliate. */
  friendAdds: number;
}

export async function getAffiliateReport(
  db: D1Database,
  affiliateId?: string,
  opts: { startDate?: string; endDate?: string; scope?: AffiliateScope } = {},
): Promise<AffiliateReport[]> {
  const conditions: string[] = [];
  const values: unknown[] = [];

  if (affiliateId) {
    conditions.push('a.id = ?');
    values.push(affiliateId);
  }
  if (opts.scope) {
    const scoped = affiliateScopeSql(opts.scope, 'a.');
    conditions.push(scoped.sql);
    values.push(...scoped.binds);
  }

  const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

  // Build date conditions for subqueries using parameterized queries.
  //   clicks  → ref_tracking.created_at (rt), compared by julianday so mixed
  //             JST/UTC timestamp formats sort by true instant (matches v2).
  //   cv      → conversion_events.created_at (ce).
  let clickDateCond = '';
  let cvDateCond = '';
  const clickDateBinds: unknown[] = [];
  const cvDateBinds: unknown[] = [];
  if (opts.startDate) {
    clickDateCond += ` AND julianday(rt.created_at) >= julianday(?)`;
    cvDateCond += ` AND ce.created_at >= ?`;
    clickDateBinds.push(opts.startDate);
    cvDateBinds.push(opts.startDate);
  }
  if (opts.endDate) {
    clickDateCond += ` AND julianday(rt.created_at) <= julianday(?)`;
    cvDateCond += ` AND ce.created_at <= ?`;
    clickDateBinds.push(opts.endDate);
    cvDateBinds.push(opts.endDate);
  }

  // ── friend_adds: single pass over friends → winner affiliate → COUNT ────────
  // Resolves each friend's add-time last-touch winner with the SAME expression
  // as getAffiliateReportV2's friendAdds (FRIEND_ADD_WINNER_SUBQUERY, 90-day
  // window / julianday / self-click excluded / last-touch). One scan of friends
  // buckets by winning affiliate_id; the outer LEFT JOIN attaches per-affiliate
  // counts without an IN(?,…) fan-out. Date filter (if any) bounds add time by
  // julianday to match the per-affiliate report exactly (not raw string compare).
  const friendAddWindowConds: string[] = [];
  const friendAddBinds: unknown[] = [];
  if (opts.startDate) {
    friendAddWindowConds.push('julianday(f.created_at) >= julianday(?)');
    friendAddBinds.push(opts.startDate);
  }
  if (opts.endDate) {
    friendAddWindowConds.push('julianday(f.created_at) <= julianday(?)');
    friendAddBinds.push(opts.endDate);
  }
  const friendAddWhere =
    friendAddWindowConds.length > 0 ? `WHERE ${friendAddWindowConds.join(' AND ')}` : '';
  const friendAddsCte = `
    SELECT winner_affiliate_id AS affiliate_id, COUNT(*) AS friend_adds
      FROM (
        SELECT (${FRIEND_ADD_WINNER_SUBQUERY}) AS winner_affiliate_id
          FROM friends f
          ${friendAddWhere}
      )
     WHERE winner_affiliate_id IS NOT NULL
     GROUP BY winner_affiliate_id`;

  // D1 bind order must match the ? placeholders left-to-right in the SQL.
  // The subqueries each reference their own set of date params, so we must
  // supply them for each subquery occurrence (clicks, conversions, revenue),
  // followed by the friend_adds CTE and finally the outer WHERE clause.
  const dateBindsForRevenue = [...cvDateBinds]; // revenue subquery reuses cv date conditions
  const dateBindsForConfirmedReward = [...cvDateBinds];
  const allBinds = [
    ...clickDateBinds,   // for total_clicks subquery
    ...cvDateBinds,      // for total_conversions subquery
    ...dateBindsForRevenue, // for total_revenue subquery
    ...dateBindsForConfirmedReward, // for confirmed_reward subquery
    ...friendAddBinds,   // for the friend_adds CTE date window
    ...values,           // for the outer WHERE clause
  ];

  const result = await db
    .prepare(
      `WITH friend_adds AS (${friendAddsCte})
       SELECT
         a.id as affiliate_id,
         a.name as affiliate_name,
         a.code,
         a.commission_rate,
         (SELECT COUNT(*)
            FROM ref_tracking rt
            JOIN affiliate_links al ON al.ref_code = rt.ref_code
           WHERE al.affiliate_id = a.id
             AND al.line_account_id IS a.line_account_id${clickDateCond}) as total_clicks,
         (SELECT COUNT(*) FROM conversion_events ce
          WHERE (ce.affiliate_id = a.id OR ce.affiliate_code = a.code)
            AND EXISTS (
              SELECT 1 FROM friends cef
               WHERE cef.id = ce.friend_id
                 AND cef.line_account_id IS a.line_account_id
            )
            AND EXISTS (
              SELECT 1 FROM conversion_points cep
               WHERE cep.id = ce.conversion_point_id
                 AND cep.line_account_id IS a.line_account_id
            )${cvDateCond}) as total_conversions,
         (SELECT COALESCE(SUM(cp.value), 0) FROM conversion_events ce
          JOIN conversion_points cp ON cp.id = ce.conversion_point_id
          JOIN friends cef ON cef.id = ce.friend_id
          WHERE (ce.affiliate_id = a.id OR ce.affiliate_code = a.code)
            AND cef.line_account_id IS a.line_account_id
            AND cp.line_account_id IS a.line_account_id${cvDateCond}) as total_revenue,
         (SELECT COALESCE(SUM(off.reward_amount), 0)
            FROM conversion_events ce
            JOIN friends cef ON cef.id = ce.friend_id
            JOIN affiliate_links al
              ON al.ref_code = ce.attributed_ref_code
             AND al.affiliate_id = a.id
            JOIN affiliate_offers off ON off.id = al.offer_id
           WHERE (ce.affiliate_id = a.id OR ce.affiliate_code = a.code)
             AND cef.line_account_id IS a.line_account_id
             AND EXISTS (
               SELECT 1 FROM conversion_points cep
                WHERE cep.id = ce.conversion_point_id
                  AND cep.line_account_id IS a.line_account_id
             )
             AND al.line_account_id IS a.line_account_id
             AND off.line_account_id IS a.line_account_id
             AND COALESCE(ce.approval_status, 'pending') = 'approved'${cvDateCond}) as confirmed_reward,
         (SELECT COUNT(*) FROM affiliate_links al
           WHERE al.affiliate_id = a.id
             AND al.line_account_id IS a.line_account_id) as link_count,
         COALESCE(fa.friend_adds, 0) as friend_adds
       FROM affiliates a
       LEFT JOIN friend_adds fa ON fa.affiliate_id = a.id
       ${where}
       ORDER BY total_conversions DESC`,
    )
    .bind(...allBinds)
    .all<{
      affiliate_id: string;
      affiliate_name: string;
      code: string;
      commission_rate: number;
      total_clicks: number;
      total_conversions: number;
      total_revenue: number;
      confirmed_reward: number;
      link_count: number;
      friend_adds: number;
    }>();

  return result.results.map((r) => ({
    affiliateId: r.affiliate_id,
    affiliateName: r.affiliate_name,
    code: r.code,
    commissionRate: r.commission_rate,
    totalClicks: r.total_clicks,
    totalConversions: r.total_conversions,
    totalRevenue: r.total_revenue,
    confirmedReward: r.confirmed_reward,
    linkCount: r.link_count,
    friendAdds: r.friend_adds,
  }));
}
