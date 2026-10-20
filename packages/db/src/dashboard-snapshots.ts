import { sqlIdSet } from './id-queries.js';
import { jstDate, nextDate, latestDashboardTime, periodStart } from './dashboard-freshness.js';
import { friendBreakdown, count, accountScopeSql } from './dashboard-inbox.js';
import { type AccountStatsScope, type DashboardOverview, type DashboardPeriod } from './dashboard-types.js';


/**
 * 日次記録で「未割り当て」を表す専用キー。
 *
 * 空文字は旧仕様の全社合計行なので再利用しない。
 */
export const UNASSIGNED_SNAPSHOT_ACCOUNT_ID = '__unassigned__';

/**
 * 1つのLINEアカウント（または未割り当て）のその日の友だち数を記録する。
 *
 * cron から毎日呼ぶ。同じ日に何度呼んでも最後の値で上書きする
 * （日中に呼んでも、その日の終わりに呼び直せば正しくなる）。
 */
export async function recordFriendSnapshot(
  db: D1Database,
  accountId: string | null,
  date?: string,
  limit = 1_000,
): Promise<void> {
  const day = date ?? jstDate(0);
  if (accountId === null) {
    const batchLimit = Number.isFinite(limit)
      ? Math.max(1, Math.min(Math.trunc(limit), 1_000))
      : 1_000;
    const targets = await db
      .prepare(
        `SELECT targets.id
           FROM (
             SELECT id FROM line_accounts
             UNION ALL SELECT ? AS id
           ) targets
           LEFT JOIN friend_daily_snapshots snapshots
             ON snapshots.date = ? AND snapshots.line_account_id = targets.id
          ORDER BY
            CASE WHEN snapshots.updated_at IS NULL THEN 0 ELSE 1 END ASC,
            snapshots.updated_at ASC,
            targets.id ASC
          LIMIT ?`,
      )
      .bind(UNASSIGNED_SNAPSHOT_ACCOUNT_ID, day, batchLimit)
      .all<{ id: string }>();
    await Promise.all(
      targets.results.map((target) => recordFriendSnapshot(db, target.id, day)),
    );
    return;
  }

  const unassigned = accountId === UNASSIGNED_SNAPSHOT_ACCOUNT_ID;
  const accountWhere = unassigned ? 'line_account_id IS NULL' : 'line_account_id = ?';
  const accountBinds = unassigned ? [] : [accountId];
  const counts = await friendBreakdown(db, null, { sql: accountWhere, binds: accountBinds });
  const added = await count(
    db,
    `SELECT COUNT(*) AS n FROM friends WHERE created_at >= ? AND created_at < ? AND ${accountWhere}`,
    day,
    nextDate(day),
    ...accountBinds,
  );

  await db
    .prepare(
      `INSERT INTO friend_daily_snapshots
         (date, line_account_id, active, total, blocked_by_them, hidden_by_us, added, blocked, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, 0, strftime('%Y-%m-%dT%H:%M:%f', 'now', '+9 hours'))
       ON CONFLICT (date, line_account_id) DO UPDATE SET
         active = excluded.active,
         total = excluded.total,
         blocked_by_them = excluded.blocked_by_them,
         hidden_by_us = excluded.hidden_by_us,
         added = excluded.added,
         updated_at = excluded.updated_at`,
    )
    .bind(
      day,
      accountId,
      counts.active,
      counts.total,
      counts.blockedByThem,
      counts.hiddenByUs,
      added,
    )
    .run();
}

/**
 * 推移に出す日数。上の期間切り替えとは連動させない。
 *
 * 以前は「今日 / 過去7日 / 過去28日」に合わせていた。すると「今日」を
 * 選んだときに推移が1行だけになり、増えたのか減ったのかが読めない。
 * 推移は「直近どう動いたか」を見るためのもので、上の切り替えは
 * KPI の集計期間。別のものなので、ここは常に7日にする。
 */
export const TREND_DAYS = 7;

/** 旧全社合計行（空文字）を必ず除き、記録用の未割り当てキーを可視範囲に変換する。 */
export function snapshotScopeSql(scope: AccountStatsScope): { sql: string; binds: string[] } {
  if ('allTenants' in scope) return { sql: 'line_account_id <> ?', binds: [''] };
  const accountIds = [
    ...scope.allowedAccountIds,
    ...(scope.includeUnassigned ? [UNASSIGNED_SNAPSHOT_ACCOUNT_ID] : []),
  ];
  if (accountIds.length === 0) return { sql: '1 = 0', binds: [] };
  return {
    sql: `line_account_id IN (${sqlIdSet(accountIds).sql})`,
    binds: sqlIdSet(accountIds).binds,
  };
}

/**
 * 友だち数の推移。今日から遡って7日ぶん。
 *
 * 日次記録（friend_daily_snapshots）があればそれを使う。無い日は、
 * いま残っている友だちの登録日から逆算して埋め、`estimated` を立てる。
 *
 * 逆算は正確ではない。退会して行ごと消えた友だちは数に出ないので、
 * 過去に遡るほど実態より少なく見える。記録が始まる前の日を
 * 空白にすると線が途切れて読みにくいので埋めるが、
 * 「これは推定である」ことを画面まで持っていく。
 */
export async function friendTrend(
  db: D1Database,
  scope: AccountStatsScope,
): Promise<{ points: DashboardOverview['trend']; asOf: string | null }> {
  const days = TREND_DAYS;
  const start = jstDate(-(TREND_DAYS - 1));
  const snapshotScope = snapshotScopeSql(scope);

  const recorded = await db
    .prepare(
      `SELECT date, SUM(active) AS active, SUM(added) AS added, SUM(blocked) AS blocked,
              MIN(updated_at) AS updatedAt
         FROM friend_daily_snapshots
        WHERE ${snapshotScope.sql} AND date >= ?
        GROUP BY date
        ORDER BY date`,
    )
    .bind(...snapshotScope.binds, start)
    .all<{ date: string; active: number; added: number; blocked: number; updatedAt: string }>();
  const byDate = new Map(recorded.results.map((r) => [r.date, r]));

  const friends = accountScopeSql(scope, 'line_account_id');
  const binds = [start, ...friends.binds];
  const addedRows = await db
    .prepare(
      `SELECT substr(created_at, 1, 10) AS d, COUNT(*) AS n
         FROM friends
        WHERE created_at >= ? AND ${friends.sql}
        GROUP BY d`,
    )
    .bind(...binds)
    .all<{ d: string; n: number }>();
  const addedByDate = new Map(addedRows.results.map((r) => [r.d, r.n]));
  /*
   * 経路不明（ref_code が経路に結びつかない追加）は name=null で返す。
   * 「経路不明」を経路名として出すと、実在する経路と区別がつかない。
   * 画面は null を `—` として出す。
   */
  const sourceRows = await db.prepare(
    `SELECT substr(f.created_at, 1, 10) AS d,
            er.name AS name,
            COUNT(*) AS n
       FROM friends f
       LEFT JOIN entry_routes er ON er.ref_code = f.ref_code
      WHERE f.created_at >= ? AND ${accountScopeSql(scope, 'f.line_account_id').sql}
      GROUP BY d, name
      ORDER BY n DESC`,
  ).bind(...binds).all<{ d: string; name: string | null; n: number }>();
  const sourcesByDate = new Map<string, Array<{ name: string | null; count: number }>>();
  for (const row of sourceRows.results) {
    const list = sourcesByDate.get(row.d) ?? [];
    list.push({ name: row.name, count: row.n });
    sourcesByDate.set(row.d, list);
  }

  const now = await friendBreakdown(db, null, accountScopeSql(scope, 'line_account_id'));
  const out: DashboardOverview['trend'] = [];
  let running = now.active;
  for (let i = 0; i < days; i += 1) {
    const date = jstDate(-i);
    const hit = byDate.get(date);
    if (hit) {
      out.push({ date, added: hit.added, blocked: hit.blocked, active: hit.active, estimated: false, sources: sourcesByDate.get(date) ?? [] });
    } else {
      out.push({
        date,
        added: addedByDate.get(date) ?? 0,
        blocked: 0,
        active: running,
        estimated: true,
        sources: sourcesByDate.get(date) ?? [],
      });
    }
    running -= addedByDate.get(date) ?? 0;
  }
  return {
    points: out.reverse(),
    // snapshot があるときは、画面を再取得した時刻ではなく保存済みの成功時刻を返す。
    // 全日が推定なら、現在の friends を直接読み終えた時刻が取得成功時刻になる。
    asOf: latestDashboardTime(recorded.results.map((row) => row.updatedAt)) ?? new Date().toISOString(),
  };
}

export async function conversionSummary(
  db: D1Database,
  period: DashboardPeriod,
  scope: AccountStatsScope,
): Promise<DashboardOverview['conversions']> {
  const start = periodStart(period);
  const account = accountScopeSql(scope, 'f.line_account_id');
  const total = await count(
    db,
    `SELECT COUNT(*) AS n FROM conversion_events ce
      JOIN friends f ON f.id = ce.friend_id
     WHERE ce.created_at >= ? AND ${account.sql}`,
    start, ...account.binds,
  );
  const byPoint = await db
    .prepare(
      `SELECT cp.name AS name, COUNT(*) AS count
         FROM conversion_events c
         JOIN conversion_points cp ON cp.id = c.conversion_point_id
         JOIN friends f ON f.id = c.friend_id
        WHERE c.created_at >= ? AND ${account.sql}
        GROUP BY cp.id
        ORDER BY count DESC
        LIMIT 5`,
    )
    .bind(start, ...account.binds)
    .all<{ name: string; count: number }>();
  return { total, byPoint: byPoint.results };
}
