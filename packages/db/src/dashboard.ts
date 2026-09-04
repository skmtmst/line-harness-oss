/**
 * ダッシュボードが1回で読む数。
 *
 * 設計（Pen.dev `V2 1-1 ダッシュボード`）は1画面に10か所以上の数を出す。
 * 画面から個別に叩くと往復が増えるうえ、カードごとに数の基準日がずれる。
 * 「有効友だちは今朝の値、未対応は今の値」のような画面は読み違えのもとなので、
 * 1回のリクエストでまとめて返す。
 */

/** 期間の指定。設計の「今日 / 過去7日 / 過去28日」に対応する。 */
export type DashboardPeriod = 'today' | 'last7' | 'last28';

export type DashboardSectionState = 'ok' | 'empty' | 'unavailable' | 'stale' | 'estimated';

export interface DashboardSectionStatus {
  status: DashboardSectionState;
  /** The latest time represented by this section. */
  asOf: string;
  /** Human-readable fixed period key; the UI maps it to Japanese labels. */
  period: DashboardPeriod | 'latest' | 'last7-fixed' | 'this-month';
}

export interface DashboardOverview {
  period: DashboardPeriod;
  /** 集計した時刻（JST）。カードごとの基準日がずれていないことの証拠になる。 */
  generatedAt: string;
  friends: {
    /** 有効＝ブロックされておらず、非表示にもしていない。 */
    active: number;
    total: number;
    /** 相手からブロック／自分で非表示／その両方。 */
    blockedByThem: number;
    hiddenByUs: number;
    blockedBoth: number;
  };
  inbox: {
    unanswered: number;
    inProgress: number;
    resolved: number;
    /** 未対応のうち、最も古いものからの経過時間（分）。無ければ null。 */
    oldestUnansweredMinutes: number | null;
    /**
     * 受信してから最初に返すまでの平均（分）。過去7日ぶん。
     *
     * 107 を当てた日より前の往復は記録が無いので入らない。
     * 記録が1件も無ければ null。0 を出すと「即答している」と読めてしまう。
     */
    averageFirstReplyMinutes: number | null;
  };
  delivery: {
    /** 期間内に送った通数。 */
    sent: number;
    /**
     * こちらから送った数（プッシュ）と、受信への応答（リプライ）。
     *
     * LINEは課金の数え方が違うので、まとめると枠の減りを読み違える。
     * source（028）で分かれる。auto_reply と manual が応答。
     */
    push: number;
    reply: number;
    /** 期間内の一斉配信の件数。 */
    broadcasts: number;
    /** 今月の送信上限。LINE から取れないときは null。 */
    quotaLimit: number | null;
    /** 今月すでに使った数。取れないときは null。 */
    quotaUsed: number | null;
  };
  /** 友だち数の推移。古い順。 */
  trend: Array<{
    date: string;
    added: number;
    blocked: number;
    /** その日の終わりの有効友だち数。 */
    active: number;
    /**
     * 日次記録が無く、いまの友だちから逆算した日。
     *
     * 退会して行ごと消えた友だちは数に出ないので、実態より少なく見える。
     * 画面はこの日を実線で結ばない。正しい記録と同じ見た目にすると、
     * 見た人が違いに気づけない。
     */
    estimated: boolean;
    sources: Array<{ name: string; count: number }>;
  }>;
  conversions: {
    /** 期間内の成果の件数。 */
    total: number;
    /** 成果地点ごとの内訳。多い順に5件まで。 */
    byPoint: Array<{ name: string; count: number }>;
  };
  /** Individual sections that failed; callers must not present these as real zeroes. */
  partialFailures: string[];
  operations: {
    scenarios: { active: number; paused: number };
    migrations: { active: number; completed: number };
    bookings: { pending: number; upcoming: number };
    inflowTop: Array<{ name: string; count: number }>;
    funnelAlerts: number;
    automationFailures: number;
  };
  /**
   * Availability metadata kept alongside the legacy numeric shape.
   * Consumers must check this before rendering a numeric zero.
   */
  sections: {
    friends: DashboardSectionStatus;
    inbox: DashboardSectionStatus;
    delivery: DashboardSectionStatus;
    quota: DashboardSectionStatus;
    trend: DashboardSectionStatus;
    conversions: DashboardSectionStatus;
    operations: DashboardSectionStatus;
  };
}

/** JST の「いまの日付」。D1 は UTC なので、日付の境目を跨ぐ集計は必ずずれる。 */
function jstDate(offsetDays = 0): string {
  const now = new Date(Date.now() + 9 * 60 * 60 * 1000 + offsetDays * 24 * 60 * 60 * 1000);
  return now.toISOString().slice(0, 10);
}

function nextDate(day: string): string {
  return new Date(Date.parse(`${day}T00:00:00Z`) + 86_400_000).toISOString().slice(0, 10);
}

function nextMonth(month: string): string {
  const [year, rawMonth] = month.split('-').map(Number);
  return new Date(Date.UTC(year, rawMonth, 1)).toISOString().slice(0, 7);
}

/** 期間の始まり（JSTの日付）。 */
export function periodStart(period: DashboardPeriod): string {
  if (period === 'today') return jstDate(0);
  if (period === 'last7') return jstDate(-6);
  return jstDate(-27);
}

/** 期間に含まれる日数。推移の折れ線の点の数になる。 */
export function periodDays(period: DashboardPeriod): number {
  if (period === 'today') return 1;
  if (period === 'last7') return 7;
  return 28;
}

interface CountRow {
  n: number;
}

async function count(db: D1Database, sql: string, ...binds: unknown[]): Promise<number> {
  const row = await db
    .prepare(sql)
    .bind(...binds)
    .first<CountRow>();
  return row?.n ?? 0;
}

/**
 * 友だちの内訳。
 *
 * `is_following = 0` は相手がブロックしたか友だちをやめた状態、
 * `is_hidden = 1` はこちらで非表示にした状態。両方立つこともある。
 * 設計の「相手から / 自分から / 相互」はこの2列の組み合わせで出る。
 */
async function friendBreakdown(
  db: D1Database,
  accountId: string | null,
  explicitScope?: { sql: string; binds: string[] },
): Promise<DashboardOverview['friends']> {
  const where = explicitScope ? `WHERE ${explicitScope.sql}` : accountId ? 'WHERE line_account_id = ?' : '';
  const binds = explicitScope?.binds ?? (accountId ? [accountId] : []);
  const row = await db
    .prepare(
      `SELECT
         COUNT(*) AS total,
         SUM(CASE WHEN is_following = 1 AND is_hidden = 0 THEN 1 ELSE 0 END) AS active,
         SUM(CASE WHEN is_following = 0 AND is_hidden = 0 THEN 1 ELSE 0 END) AS blocked_by_them,
         SUM(CASE WHEN is_following = 1 AND is_hidden = 1 THEN 1 ELSE 0 END) AS hidden_by_us,
         SUM(CASE WHEN is_following = 0 AND is_hidden = 1 THEN 1 ELSE 0 END) AS blocked_both
       FROM friends ${where}`,
    )
    .bind(...binds)
    .first<{
      total: number;
      active: number;
      blocked_by_them: number;
      hidden_by_us: number;
      blocked_both: number;
    }>();
  return {
    total: row?.total ?? 0,
    active: row?.active ?? 0,
    blockedByThem: row?.blocked_by_them ?? 0,
    hiddenByUs: row?.hidden_by_us ?? 0,
    blockedBoth: row?.blocked_both ?? 0,
  };
}

export type AccountStatsScope =
  | { allowedAccountIds: readonly string[]; includeUnassigned: boolean }
  | { allTenants: true };

function accountScopeSql(scope: AccountStatsScope, column: string): { sql: string; binds: string[] } {
  if ('allTenants' in scope) return { sql: '1 = 1', binds: [] };
  const placeholders = scope.allowedAccountIds.map(() => '?').join(', ');
  if (placeholders) {
    return {
      sql: `(${column} IN (${placeholders})${scope.includeUnassigned ? ` OR ${column} IS NULL` : ''})`,
      binds: [...scope.allowedAccountIds],
    };
  }
  return { sql: scope.includeUnassigned ? `${column} IS NULL` : '1 = 0', binds: [] };
}

async function inboxState(db: D1Database, scope: AccountStatsScope): Promise<DashboardOverview['inbox']> {
  const account = accountScopeSql(scope, 'f.line_account_id');
  const row = await db
    .prepare(
      `SELECT
         SUM(CASE WHEN status = 'unread' THEN 1 ELSE 0 END) AS unanswered,
         SUM(CASE WHEN status = 'in_progress' THEN 1 ELSE 0 END) AS in_progress,
         SUM(CASE WHEN status = 'resolved' THEN 1 ELSE 0 END) AS resolved,
         MIN(CASE WHEN status = 'unread' THEN last_message_at END) AS oldest
       FROM chats c
       JOIN friends f ON f.id = c.friend_id
       WHERE ${account.sql}`,
    )
    .bind(...account.binds)
    .first<{ unanswered: number; in_progress: number; resolved: number; oldest: string | null }>();

  // 受信から初回返信までの平均。JSTの過去7日。
  // 記録が無い往復（107より前）は WHERE で外れる。
  let averageFirstReply: number | null = null;
  try {
    const avg = await db
      .prepare(
        `SELECT AVG((julianday(first_replied_at) - julianday(last_incoming_at)) * 24 * 60) AS m
           FROM chats c
           JOIN friends f ON f.id = c.friend_id
          WHERE first_replied_at IS NOT NULL
            AND last_incoming_at IS NOT NULL
            AND first_replied_at > last_incoming_at
            AND first_replied_at >= ?
            AND ${account.sql}`,
      )
      .bind(jstDate(-6), ...account.binds)
      .first<{ m: number | null }>();
    averageFirstReply = avg?.m == null ? null : Math.round(avg.m);
  } catch {
    // 107 がまだ当たっていない環境。平均だけ出ない。
  }

  let oldestMinutes: number | null = null;
  if (row?.oldest) {
    const diff = Date.now() - new Date(row.oldest).getTime();
    // 未来の時刻が入っていることがある（時計ずれ）。負の経過時間は意味がないので落とす。
    oldestMinutes = diff > 0 ? Math.floor(diff / 60000) : 0;
  }
  return {
    unanswered: row?.unanswered ?? 0,
    inProgress: row?.in_progress ?? 0,
    resolved: row?.resolved ?? 0,
    oldestUnansweredMinutes: oldestMinutes,
    averageFirstReplyMinutes: averageFirstReply,
  };
}

/** 日次記録の1行。 */
export interface FriendDailySnapshot {
  date: string;
  line_account_id: string;
  active: number;
  total: number;
  blocked_by_them: number;
  hidden_by_us: number;
  added: number;
  blocked: number;
}

/**
 * 日次記録で「未割り当て」を表す専用キー。
 *
 * 空文字は旧仕様の全社合計行なので再利用しない。
 */
const UNASSIGNED_SNAPSHOT_ACCOUNT_ID = '__unassigned__';

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
): Promise<void> {
  const day = date ?? jstDate(0);
  if (accountId === null) {
    const accounts = await db
      .prepare('SELECT id FROM line_accounts')
      .all<{ id: string }>();
    await Promise.all([
      ...accounts.results.map((account) => recordFriendSnapshot(db, account.id, day)),
      recordFriendSnapshot(db, UNASSIGNED_SNAPSHOT_ACCOUNT_ID, day),
    ]);
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
const TREND_DAYS = 7;

/** 旧全社合計行（空文字）を必ず除き、記録用の未割り当てキーを可視範囲に変換する。 */
function snapshotScopeSql(scope: AccountStatsScope): { sql: string; binds: string[] } {
  if ('allTenants' in scope) return { sql: 'line_account_id <> ?', binds: [''] };
  const accountIds = [
    ...scope.allowedAccountIds,
    ...(scope.includeUnassigned ? [UNASSIGNED_SNAPSHOT_ACCOUNT_ID] : []),
  ];
  if (accountIds.length === 0) return { sql: '1 = 0', binds: [] };
  return {
    sql: `line_account_id IN (${accountIds.map(() => '?').join(', ')})`,
    binds: accountIds,
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
async function friendTrend(
  db: D1Database,
  scope: AccountStatsScope,
): Promise<DashboardOverview['trend']> {
  const days = TREND_DAYS;
  const start = jstDate(-(TREND_DAYS - 1));
  const snapshotScope = snapshotScopeSql(scope);

  const recorded = await db
    .prepare(
      `SELECT date, SUM(active) AS active, SUM(added) AS added, SUM(blocked) AS blocked
         FROM friend_daily_snapshots
        WHERE ${snapshotScope.sql} AND date >= ?
        GROUP BY date
        ORDER BY date`,
    )
    .bind(...snapshotScope.binds, start)
    .all<{ date: string; active: number; added: number; blocked: number }>();
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
  const sourceRows = await db.prepare(
    `SELECT substr(f.created_at, 1, 10) AS d,
            COALESCE(er.name, '経路不明') AS name,
            COUNT(*) AS n
       FROM friends f
       LEFT JOIN entry_routes er ON er.ref_code = f.ref_code
      WHERE f.created_at >= ? AND ${accountScopeSql(scope, 'f.line_account_id').sql}
      GROUP BY d, name
      ORDER BY n DESC`,
  ).bind(...binds).all<{ d: string; name: string; n: number }>();
  const sourcesByDate = new Map<string, Array<{ name: string; count: number }>>();
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
  return out.reverse();
}

async function conversionSummary(
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

/**
 * ダッシュボードの数をまとめて取る。
 *
 * どれか1つが取れなくても画面全体を落とさない。表が無い環境（機能を切っている、
 * マイグレーションがまだ）でも、取れたところだけ出したい。
 */
export async function getDashboardOverview(
  db: D1Database,
  period: DashboardPeriod,
  scope: AccountStatsScope,
): Promise<DashboardOverview> {
  const start = periodStart(period);
  const partialFailures: string[] = [];
  const safe = async <T>(name: string, run: Promise<T>, fallback: T): Promise<T> => {
    try {
      return await run;
    } catch (error) {
      partialFailures.push(name);
      console.error(`[dashboard] ${name} failed`, error);
      return fallback;
    }
  };
  const friendAccount = accountScopeSql(scope, 'f.line_account_id');
  const messageAccount = accountScopeSql(scope, 'ml.line_account_id');
  const bookingAccount = accountScopeSql(scope, 'line_account_id');
  const migrationFrom = accountScopeSql(scope, 'from_account_id');
  const migrationTo = accountScopeSql(scope, 'to_account_id');
  const broadcastAccount = accountScopeSql(scope, 'b.line_account_id');
  const broadcastJsonAccount = accountScopeSql(scope, 'value');
  const broadcastScope = `(${broadcastAccount.sql} OR (
    b.target_type = 'multi-account-dedup' AND b.account_ids IS NOT NULL
    AND EXISTS (SELECT 1 FROM json_each(b.account_ids) WHERE ${broadcastJsonAccount.sql})
  ))`;
  const emptyOperations: DashboardOverview['operations'] = {
    scenarios: { active: 0, paused: 0 }, migrations: { active: 0, completed: 0 },
    bookings: { pending: 0, upcoming: 0 }, inflowTop: [], funnelAlerts: 0,
    automationFailures: 0,
  };
  const operationsPromise = Promise.all([
    db.prepare(
      `SELECT SUM(CASE WHEN fs.status='active' THEN 1 ELSE 0 END) active,
              SUM(CASE WHEN fs.status='paused' THEN 1 ELSE 0 END) paused
         FROM friend_scenarios fs JOIN friends f ON f.id=fs.friend_id
        WHERE ${friendAccount.sql}`,
    ).bind(...friendAccount.binds).first<{ active: number | null; paused: number | null }>(),
    db.prepare(
      `SELECT SUM(CASE WHEN status IN ('pending','in_progress') THEN 1 ELSE 0 END) active,
              SUM(CASE WHEN status='completed' THEN 1 ELSE 0 END) completed
         FROM account_migrations
        WHERE (${migrationFrom.sql} OR ${migrationTo.sql})`,
    ).bind(...migrationFrom.binds, ...migrationTo.binds).first<{ active: number | null; completed: number | null }>(),
    db.prepare(
      `SELECT SUM(CASE WHEN status='requested' THEN 1 ELSE 0 END) pending,
              SUM(CASE WHEN status IN ('requested','confirmed') AND starts_at >= ? THEN 1 ELSE 0 END) upcoming
         FROM bookings WHERE ${bookingAccount.sql}`,
    ).bind(new Date().toISOString(), ...bookingAccount.binds).first<{ pending: number | null; upcoming: number | null }>(),
    db.prepare(
      `SELECT COALESCE(er.name, '経路不明') name, COUNT(*) count
         FROM friends f LEFT JOIN entry_routes er ON er.ref_code=f.ref_code
        WHERE f.created_at >= ? AND ${friendAccount.sql}
        GROUP BY name ORDER BY count DESC LIMIT 3`,
    ).bind(start, ...friendAccount.binds).all<{ name: string; count: number }>(),
    count(db,
      `WITH funnel AS (
         SELECT f.ref_code, COUNT(DISTINCT f.id) additions, COUNT(ce.id) conversions
           FROM friends f LEFT JOIN conversion_events ce ON ce.friend_id=f.id
          WHERE f.created_at >= ? AND ${friendAccount.sql}
          GROUP BY f.ref_code
       ) SELECT COUNT(*) n FROM funnel WHERE additions >= 3 AND conversions = 0`,
      start, ...friendAccount.binds),
    count(db,
      `SELECT COUNT(*) n FROM automation_logs al
        JOIN friends f ON f.id=al.friend_id
       WHERE al.status IN ('partial','failed') AND al.created_at >= ? AND ${friendAccount.sql}`,
      start, ...friendAccount.binds),
  ]).then(([scenarios, migrations, bookings, inflow, funnelAlerts, automationFailures]) => ({
    scenarios: { active: scenarios?.active ?? 0, paused: scenarios?.paused ?? 0 },
    migrations: { active: migrations?.active ?? 0, completed: migrations?.completed ?? 0 },
    bookings: { pending: bookings?.pending ?? 0, upcoming: bookings?.upcoming ?? 0 },
    inflowTop: inflow.results,
    funnelAlerts,
    automationFailures,
  }));

  const [friends, inbox, trend, conversions, sent, broadcasts, operations] = await Promise.all([
    safe('friends', friendBreakdown(db, null, accountScopeSql(scope, 'line_account_id')), {
      active: 0,
      total: 0,
      blockedByThem: 0,
      hiddenByUs: 0,
      blockedBoth: 0,
    }),
    safe('inbox', inboxState(db, scope), {
      unanswered: 0,
      inProgress: 0,
      resolved: 0,
      oldestUnansweredMinutes: null,
      averageFirstReplyMinutes: null,
    }),
    // 推移だけは period を渡さない。上の切り替えに関わらず直近7日で見る。
    safe('trend', friendTrend(db, scope), []),
    safe('conversions', conversionSummary(db, period, scope), { total: 0, byPoint: [] }),
    // プッシュ（こちらから）と リプライ（受信への応答）を分ける。
    // source は 028 で入っている。auto_reply と manual が応答。
    db
      .prepare(
        `SELECT
           COUNT(*) AS sent,
           SUM(CASE WHEN source IN ('auto_reply','manual') THEN 1 ELSE 0 END) AS reply
         FROM messages_log ml
          WHERE direction = 'outgoing' AND ml.created_at >= ? AND ${messageAccount.sql}`,
      )
      .bind(start, ...messageAccount.binds)
      .first<{ sent: number; reply: number }>()
      .then((value) => value)
      .catch((error) => { partialFailures.push('delivery'); console.error('[dashboard] delivery failed', error); return null; }),
    safe('broadcasts', count(
      db,
      `SELECT COUNT(*) AS n FROM broadcasts b
        WHERE status = 'sent' AND b.created_at >= ? AND ${broadcastScope}`,
      start, ...broadcastAccount.binds, ...broadcastJsonAccount.binds,
    ), 0),
    safe('operations', operationsPromise, emptyOperations),
  ]);

  const generatedAt = new Date(Date.now() + 9 * 60 * 60 * 1000).toISOString().replace('Z', '+09:00');
  const status = (
    names: string | string[],
    empty: boolean,
    sectionPeriod: DashboardSectionStatus['period'],
  ): DashboardSectionStatus => ({
    status: (Array.isArray(names) ? names : [names]).some((name) => partialFailures.includes(name))
      ? 'unavailable'
      : empty ? 'empty' : 'ok',
    asOf: generatedAt,
    period: sectionPeriod,
  });
  const trendStatus = status('trend', trend.length === 0, 'last7-fixed');
  if (trendStatus.status === 'ok' && trend.some((point) => point.estimated)) {
    trendStatus.status = 'estimated';
  }

  return {
    period,
    generatedAt,
    friends,
    inbox,
    delivery: {
      sent: sent?.sent ?? 0,
      push: (sent?.sent ?? 0) - (sent?.reply ?? 0),
      reply: sent?.reply ?? 0,
      broadcasts,
      // LINE の送信上限は Messaging API から取る。ここは DB だけを見る層なので
      // 触らない。呼び出し側（ルート）が埋める。
      quotaLimit: null,
      quotaUsed: null,
    },
    trend,
    conversions,
    partialFailures,
    operations,
    sections: {
      friends: status('friends', friends.total === 0, 'latest'),
      inbox: status('inbox', inbox.unanswered + inbox.inProgress + inbox.resolved === 0, 'latest'),
      delivery: status(['delivery', 'broadcasts'], (sent?.sent ?? 0) === 0 && broadcasts === 0, period),
      quota: { status: 'unavailable', asOf: generatedAt, period: 'this-month' },
      trend: trendStatus,
      conversions: status('conversions', conversions.total === 0, period),
      operations: status(
        'operations',
        operations.scenarios.active + operations.scenarios.paused
          + operations.migrations.active + operations.migrations.completed
          + operations.bookings.pending + operations.bookings.upcoming
          + operations.funnelAlerts + operations.automationFailures === 0
          && operations.inflowTop.length === 0,
        period,
      ),
    },
  };
}

/** 受信箱の上部に出す数（設計 `V2 2-1 受信箱` の KPIs）。 */
export interface InboxStats {
  /** 返信を待っている人。 */
  waiting: number;
  /** 返信を待っている会話のうち、最も長い待ち時間（分）。 */
  oldestWaitingMinutes: number | null;
  /** 受信から初回返信までの平均（分）。記録が無ければ null。 */
  averageFirstReplyMinutes: number | null;
  /** そのうち1時間以上待たせているもの。 */
  waitingOverAnHour: number;
  /** 自分が担当しているもの（対応中）。 */
  mine: number;
  /** 今日の受信。 */
  todayInbound: number;
  todayByChannel: { line: number; email: number };
  /**
   * 担当者ごとの未読数。担当がまだ決まっていない会話は operatorId/name が null。
   *
   * 一覧はページ送りされるため、画面側で見えている行を数えてはいけない。
   * 0件の担当者はこの配列に現れず、担当者一覧と結合する画面側が実値0として描く。
   */
  assigneeUnread: Array<{
    operatorId: string | null;
    operatorName: string | null;
    unread: number;
  }>;
}

/**
 * 受信箱の集計。
 *
 * 設計の4枚目「平均の初回返信」は、返信までの時間を記録していないので出せない。
 * 代わりに「1時間以上待たせている件数」を1枚目の内訳として出す。
 * どちらも「放置に気づく」ための数で、役割は同じ。
 */
export async function getInboxStats(
  db: D1Database,
  operatorId: string | null,
  scope: AccountStatsScope,
): Promise<InboxStats> {
  const hourAgo = new Date(Date.now() - 3600_000).toISOString();
  const today = jstDate(0);

  const friendScope = accountScopeSql(scope, 'f.line_account_id');
  const messageScope = accountScopeSql(scope, 'line_account_id');
  const waiting = await db
    .prepare(
      `SELECT
         COUNT(*) AS n,
         SUM(CASE WHEN last_message_at < ? THEN 1 ELSE 0 END) AS over_hour,
         CAST((julianday('now') - julianday(MIN(last_message_at))) * 1440 AS INTEGER) AS oldest_minutes
       FROM chats c JOIN friends f ON f.id = c.friend_id
       WHERE c.status = 'unread' AND ${friendScope.sql}`,
    )
    .bind(hourAgo, ...friendScope.binds)
    .first<{ n: number; over_hour: number; oldest_minutes: number | null }>();

  const mine = operatorId
    ? await count(
        db,
        `SELECT COUNT(*) AS n FROM chats c JOIN friends f ON f.id = c.friend_id WHERE c.status = 'in_progress' AND c.operator_id = ? AND ${friendScope.sql}`,
        operatorId, ...friendScope.binds,
      )
    : await count(db, `SELECT COUNT(*) AS n FROM chats c JOIN friends f ON f.id = c.friend_id WHERE c.status = 'in_progress' AND ${friendScope.sql}`, ...friendScope.binds);

  const assigneeUnreadRows = await db
    .prepare(
      `SELECT c.operator_id, o.name AS operator_name, COUNT(*) AS unread
         FROM chats c
         JOIN friends f ON f.id = c.friend_id
         LEFT JOIN operators o ON o.id = c.operator_id
        WHERE c.status = 'unread' AND ${friendScope.sql}
        GROUP BY c.operator_id, o.name
        ORDER BY CASE WHEN c.operator_id IS NULL THEN 0 ELSE 1 END,
                 o.name ASC, c.operator_id ASC`,
    )
    .bind(...friendScope.binds)
    .all<{ operator_id: string | null; operator_name: string | null; unread: number }>();

  // source は 'line' 以外にメール由来などが入る。line 以外をまとめてメール扱いに
  // すると、将来 source が増えたときに黙って混ざる。line と email だけを数える。
  const byChannel = await db
    .prepare(
      `SELECT
         SUM(CASE WHEN source = 'line' OR source IS NULL THEN 1 ELSE 0 END) AS line_n,
         SUM(CASE WHEN source = 'email' THEN 1 ELSE 0 END) AS email_n,
         COUNT(*) AS total
       FROM messages_log
        WHERE direction = 'incoming' AND created_at >= ? AND created_at < ? AND ${messageScope.sql}`,
    )
    .bind(today, nextDate(today), ...messageScope.binds)
    .first<{ line_n: number; email_n: number; total: number }>();

  const inbox = await inboxState(db, scope);

  return {
    averageFirstReplyMinutes: inbox.averageFirstReplyMinutes,
    waiting: waiting?.n ?? 0,
    oldestWaitingMinutes: waiting?.oldest_minutes ?? null,
    waitingOverAnHour: waiting?.over_hour ?? 0,
    mine,
    todayInbound: byChannel?.total ?? 0,
    todayByChannel: { line: byChannel?.line_n ?? 0, email: byChannel?.email_n ?? 0 },
    assigneeUnread: assigneeUnreadRows.results.map((row) => ({
      operatorId: row.operator_id,
      operatorName: row.operator_name,
      unread: Number(row.unread),
    })),
  };
}

/** 友だち画面の上部に出す数（設計 `V2 2-2 友だち` の KPIs）。 */
export interface FriendStats {
  active: number;
  total: number;
  blockedByThem: number;
  hiddenByUs: number;
  unanswered: number;
  resolved: number;
  /** 今月に追加された人数と、前月同期比。 */
  addedThisMonth: number;
  addedLastMonth: number;
}

/**
 * 友だち画面の集計。
 *
 * ダッシュボードの overview と数え方を揃えている。同じ「有効友だち」が
 * 画面によって違う数だと、どちらが正しいのか分からなくなる。
 */
export async function getFriendStats(
  db: D1Database,
  scope: AccountStatsScope,
): Promise<FriendStats> {
  const friendScope = accountScopeSql(scope, 'line_account_id');
  const breakdownScope = accountScopeSql(scope, 'line_account_id');
  const breakdown = await friendBreakdown(db, null, breakdownScope);
  const inbox = await inboxState(db, scope);

  // JST の月の頭。月をまたぐ集計は UTC のままだと9時間ずれる。
  const now = new Date(Date.now() + 9 * 3600_000);
  const thisMonth = `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}`;
  const prev = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1));
  const lastMonth = `${prev.getUTCFullYear()}-${String(prev.getUTCMonth() + 1).padStart(2, '0')}`;

  const bindsFor = (month: string) => [`${month}-01`, `${nextMonth(month)}-01`, ...friendScope.binds];
  const [addedThisMonth, addedLastMonth] = await Promise.all([
    count(db, `SELECT COUNT(*) AS n FROM friends WHERE created_at >= ? AND created_at < ? AND ${friendScope.sql}`, ...bindsFor(thisMonth)),
    count(db, `SELECT COUNT(*) AS n FROM friends WHERE created_at >= ? AND created_at < ? AND ${friendScope.sql}`, ...bindsFor(lastMonth)),
  ]);

  return {
    active: breakdown.active,
    total: breakdown.total,
    // 設計は「相手から / 自分から」の2つ。相互は相手からに含める
    // （相手にブロックされている事実は変わらないため）。
    blockedByThem: breakdown.blockedByThem + breakdown.blockedBoth,
    hiddenByUs: breakdown.hiddenByUs,
    unanswered: inbox.unanswered,
    resolved: inbox.resolved,
    addedThisMonth,
    addedLastMonth,
  };
}

/** 一斉配信の一覧に出す数（設計 `V2 4-2 一斉配信` の KPIs）。 */
export interface BroadcastStats {
  /** 今月の配信件数と、そのうち予約中。 */
  thisMonth: number;
  scheduled: number;
  /** 過去28日の到達と失敗。 */
  delivered: number;
  failed: number;
  /** 過去28日の平均開封率（%）。取れないときは null。 */
  openRate: number | null;
}

/**
 * 一斉配信の集計。
 *
 * 開封率は broadcast_insights から。LINEは20人未満の配信だと開封数を返さない
 * ので、その配信は平均から外す。0として混ぜると平均が不当に下がる。
 */
export async function getBroadcastStats(db: D1Database): Promise<BroadcastStats> {
  const monthStart = jstDate(0).slice(0, 7);
  const since = jstDate(-27);

  const [counts, reach] = await Promise.all([
    db
      .prepare(
        `SELECT
           SUM(CASE WHEN substr(created_at, 1, 7) = ? THEN 1 ELSE 0 END) AS this_month,
           SUM(CASE WHEN status = 'scheduled' THEN 1 ELSE 0 END) AS scheduled
         FROM broadcasts`,
      )
      .bind(monthStart)
      .first<{ this_month: number; scheduled: number }>(),
    db
      .prepare(
        `SELECT
           COALESCE(SUM(success_count), 0) AS delivered,
           COALESCE(SUM(total_count - success_count), 0) AS failed
         FROM broadcasts
          WHERE status = 'sent' AND created_at >= ?`,
      )
      .bind(since)
      .first<{ delivered: number; failed: number }>(),
  ]);

  let openRate: number | null = null;
  try {
    const row = await db
      .prepare(
        // open_rate は取り込み時に計算済み。ここで割り直すと、
        // 分母の取り方が2か所に分かれて食い違う。
        `SELECT AVG(open_rate) * 100 AS rate
           FROM broadcast_insights
          WHERE delivered >= 20 AND open_rate IS NOT NULL`,
      )
      .first<{ rate: number | null }>();
    openRate = row?.rate === null || row?.rate === undefined ? null : Math.round(row.rate * 10) / 10;
  } catch {
    // broadcast_insights がまだ無い環境もある。開封率だけ出ない。
  }

  return {
    thisMonth: counts?.this_month ?? 0,
    scheduled: counts?.scheduled ?? 0,
    delivered: reach?.delivered ?? 0,
    failed: reach?.failed ?? 0,
    openRate,
  };
}

/**
 * 一覧画面の上部に出す数。
 *
 * タグ・テンプレート・シナリオ・リマインダは、設計上どれも
 * 「Head ＋ KPI4枚 ＋ 本体」という同じ形をしている。画面ごとに
 * 別の関数にすると、同じ数え方（今月・稼働中・未使用）が散らばって、
 * あとで定義がずれる。1本にまとめる。
 */
export interface ListStats {
  tags: { total: number; unused: number; taggedFriends: number; assignedThisMonth: number };
  marks: {
    total: number;
    inUse: number;
    unanswered: number;
    inProgress: number;
    resolved: number;
    /** 過去7日でマークを変えた回数（110）。 */
    changedLast7: number;
  };
  searches: { total: number; limit: number };
  templates: {
    total: number;
    inUse: number;
    sentThisMonth: number;
    unused90d: number;
    /** テンプレート由来の短縮URLの平均クリック率（%）。取れなければ null。 */
    clickRate: number | null;
  };
  scenarios: {
    total: number;
    active: number;
    subscribers: number;
    completed: number;
    /** 今週（過去7日）のシナリオ由来の送信。 */
    sentThisWeek: number;
  };
  reminders: { total: number; active: number; waiting: number; sentThisMonth: number };
}

export async function getListStats(db: D1Database, scope: AccountStatsScope): Promise<ListStats> {
  const monthStart = jstDate(0).slice(0, 7);
  const ninetyDaysAgo = jstDate(-90);
  const friendScope = accountScopeSql(scope, 'f.line_account_id');
  const messageScope = accountScopeSql(scope, 'line_account_id');
  const scenarioScope = accountScopeSql(scope, 'line_account_id');
  const reminderScope = accountScopeSql(scope, 'line_account_id');
  const markScope = 'allTenants' in scope
    ? { sql: '1 = 1', binds: [] as string[] }
    : scope.allowedAccountIds.length > 0
      ? {
          sql: `(sms.line_account_id IN (${scope.allowedAccountIds.map(() => '?').join(', ')}) OR sms.line_account_id IS NULL)`,
          binds: [...scope.allowedAccountIds],
        }
      : { sql: 'sms.line_account_id IS NULL', binds: [] as string[] };

  const safe = async <T>(run: () => Promise<T>, fallback: T): Promise<T> => {
    try {
      return await run();
    } catch {
      // 機能を切っている環境では表が無い。その画面の数だけ 0 になる。
      return fallback;
    }
  };

  const [tags, marks, searches, templates, scenarios, reminders] = await Promise.all([
    safe(async () => {
      const row = await db
        .prepare(
          `SELECT
             (SELECT COUNT(*) FROM tags) AS total,
             (SELECT COUNT(*) FROM tags WHERE id NOT IN (SELECT DISTINCT tag_id FROM friend_tags)) AS unused,
             (SELECT COUNT(DISTINCT ft.friend_id) FROM friend_tags ft JOIN friends f ON f.id = ft.friend_id WHERE ${friendScope.sql}) AS tagged,
             (SELECT COUNT(*) FROM friend_tags ft JOIN friends f ON f.id = ft.friend_id WHERE ft.assigned_at >= ? AND ft.assigned_at < ? AND ${friendScope.sql}) AS this_month`,
        )
        .bind(...friendScope.binds, `${monthStart}-01`, `${nextMonth(monthStart)}-01`, ...friendScope.binds)
        .first<{ total: number; unused: number; tagged: number; this_month: number }>();
      return {
        total: row?.total ?? 0,
        unused: row?.unused ?? 0,
        taggedFriends: row?.tagged ?? 0,
        assignedThisMonth: row?.this_month ?? 0,
      };
    }, { total: 0, unused: 0, taggedFriends: 0, assignedThisMonth: 0 }),

    safe(async () => {
      const row = await db
        .prepare(
          `SELECT
             (SELECT COUNT(DISTINCT sm.id)
                FROM support_marks sm
                LEFT JOIN support_mark_scopes sms ON sms.mark_id = sm.id
               WHERE sm.archived_at IS NULL AND ${markScope.sql}) AS total,
             (SELECT COUNT(DISTINCT f.support_mark_id) FROM friends f WHERE f.support_mark_id IS NOT NULL AND ${friendScope.sql}) AS in_use`,
        )
        .bind(...markScope.binds, ...friendScope.binds)
        .first<{ total: number; in_use: number }>();
      const inbox = await inboxState(db, scope);
      // 変更履歴も、対象の友だちが属するアカウントで絞る。
      const changed = await db
        .prepare(
          `SELECT COUNT(*) AS n
             FROM operation_audit oa
             JOIN friends f ON f.id = oa.friend_id
            WHERE oa.target_kind = 'support_mark'
              AND oa.action = 'changed'
              AND substr(oa.created_at, 1, 10) >= ?
              AND ${friendScope.sql}`,
        )
        .bind(jstDate(-6), ...friendScope.binds)
        .first<{ n: number }>();
      const changedLast7 = changed?.n ?? 0;
      return {
        total: row?.total ?? 0,
        inUse: row?.in_use ?? 0,
        unanswered: inbox.unanswered,
        inProgress: inbox.inProgress,
        resolved: inbox.resolved,
        changedLast7,
      };
    }, { total: 0, inUse: 0, unanswered: 0, inProgress: 0, resolved: 0, changedLast7: 0 }),

    safe(async () => {
      // 上限50は画面に出すためだけの値。DB側に制約は無い。
      // 実際に増えすぎたら、ここではなく保存時に止める話になる。
      const total = await count(db, `SELECT COUNT(*) AS n FROM saved_searches`);
      return { total, limit: 50 };
    }, { total: 0, limit: 50 }),

    safe(async () => {
      const row = await db
        .prepare(
          `SELECT
             (SELECT COUNT(*) FROM templates) AS total,
             -- テンプレート由来だけを数える。template_id_at_send は 038 で入っている。
             -- 全送信を出すと、テンプレートを使っていない手動返信まで混ざる。
             (SELECT COUNT(*) FROM messages_log
               WHERE direction = 'outgoing'
                 AND template_id_at_send IS NOT NULL
                 AND created_at >= ? AND created_at < ? AND ${messageScope.sql}) AS sent`,
        )
        .bind(`${monthStart}-01`, `${nextMonth(monthStart)}-01`, ...messageScope.binds)
        .first<{ total: number; sent: number }>();
      // 「使用中」は、シナリオのステップか自動応答から参照されているもの。
      const used = await count(
        db,
        `SELECT COUNT(DISTINCT template_id) AS n FROM (
           SELECT template_id FROM scenario_steps WHERE template_id IS NOT NULL
           UNION ALL
           SELECT template_id FROM auto_replies WHERE template_id IS NOT NULL
         )`,
      );
      // テンプレート由来の短縮URLのクリック率（110）。
      //
      // 分母は「そのテンプレートを含む送信の数」ではなく、
      // 短縮URLが押された回数 ÷ テンプレート由来の送信数。
      // 1通に複数のURLが入ると100%を超えうるので、上限を100にする。
      let clickRate: number | null = null;
      try {
        const clicks = await count(
          db,
          `SELECT COALESCE(SUM(click_count), 0) AS n FROM tracked_links
            WHERE template_id IS NOT NULL AND ${accountScopeSql(scope, 'line_account_id').sql}`,
          ...accountScopeSql(scope, 'line_account_id').binds,
        );
        const sent = row?.sent ?? 0;
        clickRate = sent > 0 ? Math.min(100, Math.round((clicks / sent) * 1000) / 10) : null;
      } catch {
        // 110 がまだ当たっていない環境。クリック率だけ出ない。
      }
      return {
        total: row?.total ?? 0,
        inUse: used,
        sentThisMonth: row?.sent ?? 0,
        unused90d: Math.max(0, (row?.total ?? 0) - used),
        clickRate,
      };
    }, { total: 0, inUse: 0, sentThisMonth: 0, unused90d: 0, clickRate: null }),

    safe(async () => {
      const row = await db
        .prepare(
          `SELECT
             (SELECT COUNT(*) FROM scenarios WHERE ${scenarioScope.sql}) AS total,
             (SELECT COUNT(*) FROM scenarios WHERE is_active = 1 AND ${scenarioScope.sql}) AS active,
             (SELECT COUNT(*) FROM friend_scenarios fs JOIN friends f ON f.id = fs.friend_id WHERE fs.status = 'active' AND ${friendScope.sql}) AS subscribers,
             (SELECT COUNT(*) FROM friend_scenarios fs JOIN friends f ON f.id = fs.friend_id WHERE fs.status = 'completed' AND ${friendScope.sql}) AS completed`,
        )
        .bind(...scenarioScope.binds, ...scenarioScope.binds, ...friendScope.binds, ...friendScope.binds)
        .first<{ total: number; active: number; subscribers: number; completed: number }>();
      // シナリオ由来の送信。source は 028 で入っている。
      const sentThisWeek = await count(
        db,
        `SELECT COUNT(*) AS n FROM messages_log
          WHERE source = 'scenario' AND created_at >= ? AND ${messageScope.sql}`,
        jstDate(-6), ...messageScope.binds,
      );
      return {
        total: row?.total ?? 0,
        active: row?.active ?? 0,
        subscribers: row?.subscribers ?? 0,
        completed: row?.completed ?? 0,
        sentThisWeek,
      };
    }, { total: 0, active: 0, subscribers: 0, completed: 0, sentThisWeek: 0 }),

    safe(async () => {
      const row = await db
        .prepare(
          `SELECT
             (SELECT COUNT(*) FROM reminders WHERE deleted_at IS NULL AND ${reminderScope.sql}) AS total,
             (SELECT COUNT(*) FROM reminders WHERE deleted_at IS NULL AND is_active = 1 AND ${reminderScope.sql}) AS active,
             (SELECT COUNT(*) FROM friend_reminders fr JOIN friends f ON f.id = fr.friend_id WHERE fr.status = 'active' AND ${friendScope.sql}) AS waiting`,
        )
        .bind(...reminderScope.binds, ...reminderScope.binds, ...friendScope.binds)
        .first<{ total: number; active: number; waiting: number }>();
      // リマインダ由来の送信。source は 028 で入っている。
      const sentThisMonth = await count(
        db,
        `SELECT COUNT(*) AS n FROM messages_log
          WHERE source = 'reminder' AND created_at >= ? AND created_at < ? AND ${messageScope.sql}`,
        `${monthStart}-01`, `${nextMonth(monthStart)}-01`, ...messageScope.binds,
      );
      return {
        total: row?.total ?? 0,
        active: row?.active ?? 0,
        waiting: row?.waiting ?? 0,
        sentThisMonth,
      };
    }, { total: 0, active: 0, waiting: 0, sentThisMonth: 0 }),
  ]);

  void ninetyDaysAgo;
  return { tags, marks, searches, templates, scenarios, reminders };
}
