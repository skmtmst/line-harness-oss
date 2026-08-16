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
  };
  delivery: {
    /** 期間内に送った通数。 */
    sent: number;
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
  }>;
  conversions: {
    /** 期間内の成果の件数。 */
    total: number;
    /** 成果地点ごとの内訳。多い順に5件まで。 */
    byPoint: Array<{ name: string; count: number }>;
  };
}

/** JST の「いまの日付」。D1 は UTC なので、日付の境目を跨ぐ集計は必ずずれる。 */
function jstDate(offsetDays = 0): string {
  const now = new Date(Date.now() + 9 * 60 * 60 * 1000 + offsetDays * 24 * 60 * 60 * 1000);
  return now.toISOString().slice(0, 10);
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
): Promise<DashboardOverview['friends']> {
  const where = accountId ? 'WHERE line_account_id = ?' : '';
  const binds = accountId ? [accountId] : [];
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

async function inboxState(db: D1Database): Promise<DashboardOverview['inbox']> {
  const row = await db
    .prepare(
      `SELECT
         SUM(CASE WHEN status = 'unread' THEN 1 ELSE 0 END) AS unanswered,
         SUM(CASE WHEN status = 'in_progress' THEN 1 ELSE 0 END) AS in_progress,
         SUM(CASE WHEN status = 'resolved' THEN 1 ELSE 0 END) AS resolved,
         MIN(CASE WHEN status = 'unread' THEN last_message_at END) AS oldest
       FROM chats`,
    )
    .first<{ unanswered: number; in_progress: number; resolved: number; oldest: string | null }>();

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
 * その日の友だち数を記録する。1日1行。
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
  const key = accountId ?? '';
  const counts = await friendBreakdown(db, accountId);
  const where = accountId ? 'AND line_account_id = ?' : '';
  const binds = accountId ? [day, accountId] : [day];
  const added = await count(
    db,
    `SELECT COUNT(*) AS n FROM friends WHERE substr(created_at, 1, 10) = ? ${where}`,
    ...binds,
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
      key,
      counts.active,
      counts.total,
      counts.blockedByThem,
      counts.hiddenByUs,
      added,
    )
    .run();
}

/**
 * 友だち数の推移。
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
  period: DashboardPeriod,
  accountId: string | null,
): Promise<DashboardOverview['trend']> {
  const days = periodDays(period);
  const start = periodStart(period);
  const key = accountId ?? '';

  const recorded = await db
    .prepare(
      `SELECT date, active, added, blocked
         FROM friend_daily_snapshots
        WHERE line_account_id = ? AND date >= ?
        ORDER BY date`,
    )
    .bind(key, start)
    .all<{ date: string; active: number; added: number; blocked: number }>();
  const byDate = new Map(recorded.results.map((r) => [r.date, r]));

  const where = accountId ? 'AND line_account_id = ?' : '';
  const binds = accountId ? [start, accountId] : [start];
  const addedRows = await db
    .prepare(
      `SELECT substr(created_at, 1, 10) AS d, COUNT(*) AS n
         FROM friends
        WHERE substr(created_at, 1, 10) >= ? ${where}
        GROUP BY d`,
    )
    .bind(...binds)
    .all<{ d: string; n: number }>();
  const addedByDate = new Map(addedRows.results.map((r) => [r.d, r.n]));

  const now = await friendBreakdown(db, accountId);
  const out: DashboardOverview['trend'] = [];
  let running = now.active;
  for (let i = 0; i < days; i += 1) {
    const date = jstDate(-i);
    const hit = byDate.get(date);
    if (hit) {
      out.push({ date, added: hit.added, blocked: hit.blocked, active: hit.active, estimated: false });
    } else {
      out.push({
        date,
        added: addedByDate.get(date) ?? 0,
        blocked: 0,
        active: running,
        estimated: true,
      });
    }
    running -= addedByDate.get(date) ?? 0;
  }
  return out.reverse();
}

async function conversionSummary(
  db: D1Database,
  period: DashboardPeriod,
): Promise<DashboardOverview['conversions']> {
  const start = periodStart(period);
  const total = await count(
    db,
    `SELECT COUNT(*) AS n FROM conversions WHERE substr(created_at, 1, 10) >= ?`,
    start,
  );
  const byPoint = await db
    .prepare(
      `SELECT cp.name AS name, COUNT(*) AS count
         FROM conversions c
         JOIN conversion_points cp ON cp.id = c.conversion_point_id
        WHERE substr(c.created_at, 1, 10) >= ?
        GROUP BY cp.id
        ORDER BY count DESC
        LIMIT 5`,
    )
    .bind(start)
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
  accountId: string | null,
): Promise<DashboardOverview> {
  const start = periodStart(period);

  const [friends, inbox, trend, conversions, sent, broadcasts] = await Promise.all([
    friendBreakdown(db, accountId).catch(() => ({
      active: 0,
      total: 0,
      blockedByThem: 0,
      hiddenByUs: 0,
      blockedBoth: 0,
    })),
    inboxState(db).catch(() => ({
      unanswered: 0,
      inProgress: 0,
      resolved: 0,
      oldestUnansweredMinutes: null,
    })),
    friendTrend(db, period, accountId).catch(() => []),
    conversionSummary(db, period).catch(() => ({ total: 0, byPoint: [] })),
    count(
      db,
      `SELECT COUNT(*) AS n FROM messages_log
        WHERE direction = 'outgoing' AND substr(created_at, 1, 10) >= ?`,
      start,
    ).catch(() => 0),
    count(
      db,
      `SELECT COUNT(*) AS n FROM broadcasts
        WHERE status = 'sent' AND substr(created_at, 1, 10) >= ?`,
      start,
    ).catch(() => 0),
  ]);

  return {
    period,
    generatedAt: new Date(Date.now() + 9 * 60 * 60 * 1000).toISOString().replace('Z', '+09:00'),
    friends,
    inbox,
    delivery: {
      sent,
      broadcasts,
      // LINE の送信上限は Messaging API から取る。ここは DB だけを見る層なので
      // 触らない。呼び出し側（ルート）が埋める。
      quotaLimit: null,
      quotaUsed: null,
    },
    trend,
    conversions,
  };
}

/** 受信箱の上部に出す数（設計 `V2 2-1 受信箱` の KPIs）。 */
export interface InboxStats {
  /** 返信を待っている人。 */
  waiting: number;
  /** そのうち1時間以上待たせているもの。 */
  waitingOverAnHour: number;
  /** 自分が担当しているもの（対応中）。 */
  mine: number;
  /** 今日の受信。 */
  todayInbound: number;
  todayByChannel: { line: number; email: number };
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
): Promise<InboxStats> {
  const hourAgo = new Date(Date.now() - 3600_000).toISOString();
  const today = jstDate(0);

  const waiting = await db
    .prepare(
      `SELECT
         COUNT(*) AS n,
         SUM(CASE WHEN last_message_at < ? THEN 1 ELSE 0 END) AS over_hour
       FROM chats WHERE status = 'unread'`,
    )
    .bind(hourAgo)
    .first<{ n: number; over_hour: number }>();

  const mine = operatorId
    ? await count(
        db,
        `SELECT COUNT(*) AS n FROM chats WHERE status = 'in_progress' AND operator_id = ?`,
        operatorId,
      )
    : await count(db, `SELECT COUNT(*) AS n FROM chats WHERE status = 'in_progress'`);

  // source は 'line' 以外にメール由来などが入る。line 以外をまとめてメール扱いに
  // すると、将来 source が増えたときに黙って混ざる。line と email だけを数える。
  const byChannel = await db
    .prepare(
      `SELECT
         SUM(CASE WHEN source = 'line' OR source IS NULL THEN 1 ELSE 0 END) AS line_n,
         SUM(CASE WHEN source = 'email' THEN 1 ELSE 0 END) AS email_n,
         COUNT(*) AS total
       FROM messages_log
        WHERE direction = 'incoming' AND substr(created_at, 1, 10) = ?`,
    )
    .bind(today)
    .first<{ line_n: number; email_n: number; total: number }>();

  return {
    waiting: waiting?.n ?? 0,
    waitingOverAnHour: waiting?.over_hour ?? 0,
    mine,
    todayInbound: byChannel?.total ?? 0,
    todayByChannel: { line: byChannel?.line_n ?? 0, email: byChannel?.email_n ?? 0 },
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
  accountId: string | null,
): Promise<FriendStats> {
  const breakdown = await friendBreakdown(db, accountId);
  const inbox = await inboxState(db);

  // JST の月の頭。月をまたぐ集計は UTC のままだと9時間ずれる。
  const now = new Date(Date.now() + 9 * 3600_000);
  const thisMonth = `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}`;
  const prev = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1));
  const lastMonth = `${prev.getUTCFullYear()}-${String(prev.getUTCMonth() + 1).padStart(2, '0')}`;

  const where = accountId ? 'AND line_account_id = ?' : '';
  const bindsFor = (month: string) => (accountId ? [month, accountId] : [month]);
  const [addedThisMonth, addedLastMonth] = await Promise.all([
    count(db, `SELECT COUNT(*) AS n FROM friends WHERE substr(created_at, 1, 7) = ? ${where}`, ...bindsFor(thisMonth)),
    count(db, `SELECT COUNT(*) AS n FROM friends WHERE substr(created_at, 1, 7) = ? ${where}`, ...bindsFor(lastMonth)),
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
          WHERE status = 'sent' AND substr(created_at, 1, 10) >= ?`,
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
  marks: { total: number; inUse: number; unanswered: number; inProgress: number; resolved: number };
  searches: { total: number; limit: number };
  templates: { total: number; inUse: number; sentThisMonth: number; unused90d: number };
  scenarios: { total: number; active: number; subscribers: number; completed: number };
  reminders: { total: number; active: number; waiting: number; sentThisMonth: number };
}

export async function getListStats(db: D1Database): Promise<ListStats> {
  const monthStart = jstDate(0).slice(0, 7);
  const ninetyDaysAgo = jstDate(-90);

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
             (SELECT COUNT(DISTINCT friend_id) FROM friend_tags) AS tagged,
             (SELECT COUNT(*) FROM friend_tags WHERE substr(assigned_at, 1, 7) = ?) AS this_month`,
        )
        .bind(monthStart)
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
             (SELECT COUNT(*) FROM support_marks) AS total,
             (SELECT COUNT(DISTINCT support_mark_id) FROM friends WHERE support_mark_id IS NOT NULL) AS in_use`,
        )
        .first<{ total: number; in_use: number }>();
      const inbox = await inboxState(db);
      return {
        total: row?.total ?? 0,
        inUse: row?.in_use ?? 0,
        unanswered: inbox.unanswered,
        inProgress: inbox.inProgress,
        resolved: inbox.resolved,
      };
    }, { total: 0, inUse: 0, unanswered: 0, inProgress: 0, resolved: 0 }),

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
             (SELECT COUNT(*) FROM messages_log
               WHERE direction = 'outgoing' AND substr(created_at, 1, 7) = ?) AS sent`,
        )
        .bind(monthStart)
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
      return {
        total: row?.total ?? 0,
        inUse: used,
        sentThisMonth: row?.sent ?? 0,
        unused90d: Math.max(0, (row?.total ?? 0) - used),
      };
    }, { total: 0, inUse: 0, sentThisMonth: 0, unused90d: 0 }),

    safe(async () => {
      const row = await db
        .prepare(
          `SELECT
             (SELECT COUNT(*) FROM scenarios) AS total,
             (SELECT COUNT(*) FROM scenarios WHERE is_active = 1) AS active,
             (SELECT COUNT(*) FROM friend_scenarios WHERE status = 'active') AS subscribers,
             (SELECT COUNT(*) FROM friend_scenarios WHERE status = 'completed') AS completed`,
        )
        .first<{ total: number; active: number; subscribers: number; completed: number }>();
      return {
        total: row?.total ?? 0,
        active: row?.active ?? 0,
        subscribers: row?.subscribers ?? 0,
        completed: row?.completed ?? 0,
      };
    }, { total: 0, active: 0, subscribers: 0, completed: 0 }),

    safe(async () => {
      const row = await db
        .prepare(
          `SELECT
             (SELECT COUNT(*) FROM reminders) AS total,
             (SELECT COUNT(*) FROM reminders WHERE is_active = 1) AS active,
             (SELECT COUNT(*) FROM friend_reminders WHERE status = 'active') AS waiting`,
        )
        .first<{ total: number; active: number; waiting: number }>();
      return {
        total: row?.total ?? 0,
        active: row?.active ?? 0,
        waiting: row?.waiting ?? 0,
        sentThisMonth: 0,
      };
    }, { total: 0, active: 0, waiting: 0, sentThisMonth: 0 }),
  ]);

  void ninetyDaysAgo;
  return { tags, marks, searches, templates, scenarios, reminders };
}
