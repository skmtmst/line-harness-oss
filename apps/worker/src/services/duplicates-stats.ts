import { sqlIdSet } from '@line-crm/db/id-queries';
import { IDENTITY_KEY_SQL } from '../lib/identity-key.js';

const MSG_UNIT_YEN = 3;

export interface PerAccountStat {
  account_id: string;
  account_name: string;
  friends: number;
  dups: number;
  dup_rate: number;
}

export interface PairwiseOverlap {
  from_account_id: string;
  to_account_id: string;
  overlap: number;
}

export interface DuplicatesStats {
  total_following: number;
  unique_people: number;
  friend_dups: number;
  duplicate_groups: number;
  wasted_per_broadcast_yen: number;
  msg_unit_yen: number;
  per_account: PerAccountStat[];
  pairwise_overlap: PairwiseOverlap[];
  /** D1 からこの写しを計算した ISO 形式の日時。 */
  computed_at: string;
  /** 統合ユーザーの送信実績から数えた余分な通数。取得不能は null。 */
  overlapping_delivery_count: number | null;
}

/** 連続表示の走査を避けるため、同じ isolate 内で TTL の間だけ集計をキャッシュする。要求ごとに生成される env.DB の参照をキーにしない。設定不備を隠さないよう空・0の結果は保存せず、恒久キャッシュにもせず、試験ごとに解除できるようにする。 */
const CACHE_TTL_MS = 5 * 60 * 1000;
let cached: { stats: DuplicatesStats; at: number; scopeKey: string } | null = null;

/** 試験同士へ状態を漏らさないよう、isolate 内キャッシュを解除する。 */
export function _resetCacheForTest(): void {
  cached = null;
}

const TOTALS_SQL = `
  WITH ident AS (
    SELECT friends.id, friends.line_account_id, (${IDENTITY_KEY_SQL}) AS ident_key
    FROM friends
    JOIN line_accounts ON line_accounts.id = friends.line_account_id
    WHERE friends.is_following = 1 AND line_accounts.is_active = 1
  ),
  groups AS (
    SELECT ident_key, COUNT(DISTINCT line_account_id) AS span, COUNT(*) AS row_cnt
    FROM ident GROUP BY ident_key HAVING span > 1
  )
  SELECT
    (SELECT COUNT(*) FROM friends
       JOIN line_accounts ON line_accounts.id = friends.line_account_id
       WHERE friends.is_following = 1 AND line_accounts.is_active = 1) AS total_following,
    (SELECT COUNT(*) FROM groups)                                       AS duplicate_groups,
    (SELECT COALESCE(SUM(row_cnt - 1), 0) FROM groups)                  AS friend_dups
`;

const PER_ACCOUNT_SQL = `
  WITH ident AS (
    SELECT friends.id, friends.line_account_id, (${IDENTITY_KEY_SQL}) AS ident_key
    FROM friends
    JOIN line_accounts ON line_accounts.id = friends.line_account_id
    WHERE friends.is_following = 1 AND line_accounts.is_active = 1
  ),
  spans AS (
    SELECT ident_key, COUNT(DISTINCT line_account_id) AS span
    FROM ident GROUP BY ident_key
  )
  SELECT
    la.id   AS account_id,
    la.name AS account_name,
    COUNT(i.id)                                                           AS friends,
    COALESCE(SUM(CASE WHEN s.span > 1 THEN 1 ELSE 0 END), 0)             AS dups
  FROM line_accounts la
  LEFT JOIN ident i ON i.line_account_id = la.id
  LEFT JOIN spans s ON s.ident_key = i.ident_key
  WHERE la.is_active = 1
  GROUP BY la.id, la.name
  ORDER BY (1.0 * COALESCE(SUM(CASE WHEN s.span > 1 THEN 1 ELSE 0 END), 0) /
            NULLIF(COUNT(i.id), 0)) DESC,
           la.name ASC
`;

// 索引のない CTE の自己 JOIN は D1 の CPU 上限を超えやすいため、重複グループの所属だけを取得し、方向別の組合せを JS で計算する。
const PAIRWISE_RAW_SQL = `
  WITH ident AS (
    SELECT friends.id, friends.line_account_id, (${IDENTITY_KEY_SQL}) AS ident_key
    FROM friends
    JOIN line_accounts ON line_accounts.id = friends.line_account_id
    WHERE friends.is_following = 1 AND line_accounts.is_active = 1
  ),
  dup_keys AS (
    SELECT ident_key
    FROM ident
    GROUP BY ident_key
    HAVING COUNT(DISTINCT line_account_id) > 1
  )
  SELECT i.ident_key, i.line_account_id
  FROM ident i
  JOIN dup_keys dk ON dk.ident_key = i.ident_key
`;

/**
 * 可視アカウントへの絞り (-14)。
 *
 * 絞り無し(undefined)は従来どおり全アカウント。空配列は「見られる
 * アカウントが無い」= 0件の集計になる（`IN ` は不正SQLなので
 * `1 = 0` に倒す）。
 */
function accountFilterClause(column: string, accountIds: string[] | undefined): string {
  if (accountIds === undefined) return '';
  if (accountIds.length === 0) return 'AND 1 = 0';
  return `AND ${column} IN (${sqlIdSet(accountIds).sql})`;
}

/** 1配信の本文が複数通でも、本人の1友だち分は正規の送信として残す。 */
export async function countOverlappingDeliveries(
  db: D1Database,
  accountIds?: string[],
): Promise<number | null> {
  try {
    const row = await db.prepare(`
      WITH delivered AS (
        SELECT friends.user_id, m.broadcast_id, friends.id, COUNT(*) AS messages
        FROM messages_log m JOIN friends ON friends.id = m.friend_id
        JOIN users u ON u.id = friends.user_id
        WHERE m.direction = 'outgoing' AND m.broadcast_id IS NOT NULL
          AND (m.delivery_type IS NULL OR m.delivery_type != 'test')
          ${accountFilterClause('friends.line_account_id', accountIds)}
        GROUP BY friends.user_id, m.broadcast_id, friends.id
      ), overlaps AS (
        SELECT SUM(messages) - MAX(messages) AS extra
        FROM delivered GROUP BY user_id, broadcast_id
      )
      SELECT COALESCE(SUM(extra), 0) AS count FROM overlaps
    `).bind(...(accountIds?.length ? sqlIdSet(accountIds).binds : [])).first<{ count: number }>();
    return typeof row?.count === 'number' ? row.count : null;
  } catch {
    // 実績未接続・未取得を0通と見せない。本文や個人情報は記録しない。
    return null;
  }
}

export async function computeDuplicatesStats(
  db: D1Database,
  options: { forceRefresh?: boolean; accountIds?: string[] } = {},
): Promise<DuplicatesStats> {
  const accountIds = options.accountIds;
  const scopeKey = accountIds === undefined ? '' : [...accountIds].sort().join(',');
  if (!options.forceRefresh && cached && cached.scopeKey === scopeKey && Date.now() - cached.at < CACHE_TTL_MS) {
    return cached.stats;
  }

  // 同じ WHERE 文が1つのSQLに複数ある（TOTALSは2か所）ため、
  // 置き換えたか所の数だけ binds を繰り返す。
  const FRIEND_SCOPE_WHERE = 'WHERE friends.is_following = 1 AND line_accounts.is_active = 1';
  const scopedWithBinds = (sql: string, column: string, extraSites = 0): { sql: string; binds: unknown[] } => {
    const sites = sql.split(FRIEND_SCOPE_WHERE).length - 1 + extraSites;
    const clause = accountFilterClause(column, accountIds);
    return {
      sql: sql.split(FRIEND_SCOPE_WHERE).join(`${FRIEND_SCOPE_WHERE} ${clause}`),
      binds: Array.from({ length: sites }, () => accountIds?.length ? sqlIdSet(accountIds).binds : []).flat(),
    };
  };
  const totalsQuery = scopedWithBinds(TOTALS_SQL, 'line_accounts.id');
  const perAccountQuery = (() => {
    const base = scopedWithBinds(PER_ACCOUNT_SQL, 'line_accounts.id', 1);
    return {
      sql: base.sql.replace(
        'WHERE la.is_active = 1',
        `WHERE la.is_active = 1 ${accountFilterClause('la.id', accountIds)}`,
      ),
      binds: base.binds,
    };
  })();
  const pairwiseQuery = scopedWithBinds(PAIRWISE_RAW_SQL, 'line_accounts.id');

  const totals = await db
    .prepare(totalsQuery.sql)
    .bind(...totalsQuery.binds)
    .first<{ total_following: number; duplicate_groups: number; friend_dups: number }>();

  const total_following = totals?.total_following ?? 0;
  const duplicate_groups = totals?.duplicate_groups ?? 0;
  const friend_dups = totals?.friend_dups ?? 0;
  const unique_people = total_following - friend_dups;

  const perAccountResult = await db
    .prepare(perAccountQuery.sql)
    .bind(...perAccountQuery.binds)
    .all<{ account_id: string; account_name: string; friends: number; dups: number }>();

  const per_account: PerAccountStat[] = (perAccountResult.results ?? []).map((row) => ({
    account_id: row.account_id,
    account_name: row.account_name,
    friends: row.friends,
    dups: row.dups,
    dup_rate: row.friends > 0 ? row.dups / row.friends : 0,
  }));

  // D1 の CPU 負荷を抑えるため、索引のない自己 JOIN でなく、重複グループの本人とアカウントの組を取得して JS で行列化する。
  const pairwiseRawResult = await db
    .prepare(pairwiseQuery.sql)
    .bind(...pairwiseQuery.binds)
    .all<{ ident_key: string; line_account_id: string }>();

  const groups = new Map<string, Set<string>>();
  for (const row of pairwiseRawResult.results ?? []) {
    let accounts = groups.get(row.ident_key);
    if (!accounts) {
      accounts = new Set();
      groups.set(row.ident_key, accounts);
    }
    accounts.add(row.line_account_id);
  }

  const overlapMap = new Map<string, Map<string, number>>();
  for (const accounts of groups.values()) {
    const list = [...accounts];
    for (const a of list) {
      let row = overlapMap.get(a);
      if (!row) {
        row = new Map();
        overlapMap.set(a, row);
      }
      for (const b of list) {
        if (a === b) continue;
        row.set(b, (row.get(b) ?? 0) + 1);
      }
    }
  }

  const pairwise_overlap: PairwiseOverlap[] = [];
  for (const [from, byTo] of overlapMap) {
    for (const [to, overlap] of byTo) {
      pairwise_overlap.push({ from_account_id: from, to_account_id: to, overlap });
    }
  }

  const stats: DuplicatesStats = {
    total_following,
    unique_people,
    friend_dups,
    duplicate_groups,
    wasted_per_broadcast_yen: friend_dups * MSG_UNIT_YEN,
    msg_unit_yen: MSG_UNIT_YEN,
    per_account,
    pairwise_overlap,
    computed_at: new Date().toISOString(),
    overlapping_delivery_count: await countOverlappingDeliveries(db, accountIds),
  };

  // 障害や空データを長く隠さないよう、空・0はキャッシュしない。明示再取得が0なら古い非0も破棄し、次の通常要求で古い値へ戻さない。
  if (total_following > 0) {
    cached = { stats, at: Date.now(), scopeKey };
  } else {
    cached = null;
  }

  return stats;
}
