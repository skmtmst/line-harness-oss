import { describe, expect, test, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  getDashboardOverview,
  recordFriendSnapshot,
  periodDays,
  periodStart,
} from '../src/dashboard.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PKG_ROOT = join(__dirname, '..');

function asD1(sqlite: Database.Database): D1Database {
  const wrap = (query: string, params: unknown[]) => ({
    async run() {
      const info = sqlite.prepare(query).run(...params);
      return { results: [], success: true, meta: { changes: info.changes } };
    },
    async first<T>() {
      return (sqlite.prepare(query).get(...params) as T) ?? null;
    },
    async all<T>() {
      return { results: sqlite.prepare(query).all(...params) as T[], success: true, meta: {} };
    },
  });
  return {
    prepare(query: string) {
      return { bind: (...params: unknown[]) => wrap(query, params), ...wrap(query, []) };
    },
  } as unknown as D1Database;
}

let sqlite: Database.Database;
let db: D1Database;

/** JST の日付。集計側と同じ出し方でないと、境目でテストがずれる。 */
function jstDate(offsetDays = 0): string {
  return new Date(Date.now() + 9 * 3600_000 + offsetDays * 86_400_000).toISOString().slice(0, 10);
}

function insertFriend(
  id: string,
  opts: { following?: number; hidden?: number; createdAt?: string; lineAccountId?: string } = {},
): void {
  sqlite
    .prepare(
      `INSERT INTO friends (id, line_user_id, display_name, is_following, is_hidden, created_at, updated_at)
       VALUES (?, ?, 'テスト', ?, ?, ?, ?)`,
    )
    .run(
      id,
      `U${id.padEnd(32, '0').slice(0, 32)}`,
      opts.following ?? 1,
      opts.hidden ?? 0,
      opts.createdAt ?? `${jstDate(0)}T10:00:00.000+09:00`,
      `${jstDate(0)}T10:00:00.000+09:00`,
    );
  if (opts.lineAccountId) {
    sqlite.prepare('UPDATE friends SET line_account_id = ? WHERE id = ?').run(opts.lineAccountId, id);
  }
}

function insertAccount(id: string): void {
  sqlite.prepare(
    `INSERT INTO line_accounts
      (id, channel_id, name, channel_access_token, channel_secret)
     VALUES (?, ?, ?, 'token', 'secret')`,
  ).run(id, `channel-${id}`, id);
}

beforeEach(() => {
  sqlite = new Database(':memory:');
  sqlite.exec(readFileSync(join(PKG_ROOT, 'bootstrap.sql'), 'utf8'));
  db = asD1(sqlite);
});

describe('期間の解釈', () => {
  test('今日は1日、過去7日は7日、過去28日は28日', () => {
    expect(periodDays('today')).toBe(1);
    expect(periodDays('last7')).toBe(7);
    expect(periodDays('last28')).toBe(28);
  });

  test('期間の始まりは、その日数ぶん遡った日', () => {
    expect(periodStart('today')).toBe(jstDate(0));
    expect(periodStart('last7')).toBe(jstDate(-6));
    expect(periodStart('last28')).toBe(jstDate(-27));
  });
});

describe('友だちの内訳', () => {
  test('有効は「ブロックされておらず、非表示でもない」', async () => {
    insertFriend('a');
    insertFriend('b');
    insertFriend('c', { following: 0 });
    insertFriend('d', { hidden: 1 });
    insertFriend('e', { following: 0, hidden: 1 });

    const { friends } = await getDashboardOverview(db, 'today', { allTenants: true });
    expect(friends.total).toBe(5);
    expect(friends.active).toBe(2);
    expect(friends.blockedByThem).toBe(1);
    expect(friends.hiddenByUs).toBe(1);
    expect(friends.blockedBoth).toBe(1);
  });

  test('内訳の合計が総数と一致する', async () => {
    // どれかの条件が重なって二重に数えていると、ここで気づける。
    for (const [i, opts] of [{}, { following: 0 }, { hidden: 1 }, { following: 0, hidden: 1 }].entries()) {
      insertFriend(`f${i}`, opts);
    }
    const { friends } = await getDashboardOverview(db, 'today', { allTenants: true });
    expect(friends.active + friends.blockedByThem + friends.hiddenByUs + friends.blockedBoth).toBe(
      friends.total,
    );
  });

  test('友だちが0人でも落ちない', async () => {
    const { friends } = await getDashboardOverview(db, 'today', { allTenants: true });
    expect(friends).toEqual({
      active: 0,
      total: 0,
      blockedByThem: 0,
      hiddenByUs: 0,
      blockedBoth: 0,
    });
  });
});

describe('友だち数の推移', () => {
  test('日次記録があればそれを使い、推定にしない', async () => {
    insertFriend('a');
    await recordFriendSnapshot(db, null);

    const { trend } = await getDashboardOverview(db, 'today', { allTenants: true });
    const today = trend.find((d) => d.date === jstDate(0));
    expect(today?.estimated).toBe(false);
    expect(today?.active).toBe(1);
  });

  test('上の期間切り替えに関わらず、いつも7日ぶん出る', async () => {
    // 推移は「直近どう動いたか」を見るもので、上の切り替えは KPI の集計期間。
    // 連動させていた頃は「今日」を選ぶと1行だけになり、増減が読めなかった。
    for (const period of ['today', 'last7', 'last28'] as const) {
      const { trend } = await getDashboardOverview(db, period, { allTenants: true });
      expect(trend).toHaveLength(7);
      expect(trend[trend.length - 1].date).toBe(jstDate(0));
      expect(trend[0].date).toBe(jstDate(-6));
    }
  });

  test('記録が無い日は推定として印を付ける', async () => {
    // 印が無いと、逆算の値を正しい記録と見分けられない。
    insertFriend('a');
    const { trend } = await getDashboardOverview(db, 'last7', { allTenants: true });
    expect(trend).toHaveLength(7);
    expect(trend.every((d) => d.estimated)).toBe(true);
  });

  test('2つのアカウントを記録し、自分の統括の実測値だけを返す', async () => {
    for (const id of ['account-own', 'account-other']) {
      insertAccount(id);
    }
    insertFriend('own', { lineAccountId: 'account-own' });
    insertFriend('other', { lineAccountId: 'account-other' });
    await recordFriendSnapshot(db, null);

    const { trend } = await getDashboardOverview(db, 'today', {
      allowedAccountIds: ['account-own'],
      includeUnassigned: true,
    });
    const today = trend.find((d) => d.date === jstDate(0));

    expect(today?.estimated).toBe(false);
    expect(today?.active).toBe(1);
  });

  test('未割り当ては旧合計行と別に記録し、既定統括に1回だけ数える', async () => {
    insertAccount('account-own');
    insertFriend('own', { lineAccountId: 'account-own' });
    insertFriend('unassigned');
    await recordFriendSnapshot(db, null);

    const snapshotKeys = sqlite.prepare(
      'SELECT line_account_id FROM friend_daily_snapshots ORDER BY line_account_id',
    ).all() as Array<{ line_account_id: string }>;
    expect(snapshotKeys.map((row) => row.line_account_id)).toEqual([
      '__unassigned__',
      'account-own',
    ]);

    const { trend } = await getDashboardOverview(db, 'today', {
      allowedAccountIds: ['account-own'],
      includeUnassigned: true,
    });
    expect(trend.find((d) => d.date === jstDate(0))).toMatchObject({
      active: 2,
      estimated: false,
    });
  });

  test('過去の空文字の全社合計行はどの範囲でも読まない', async () => {
    insertAccount('account-own');
    insertFriend('own', { lineAccountId: 'account-own' });
    await recordFriendSnapshot(db, null);
    sqlite.prepare(
      `INSERT INTO friend_daily_snapshots
        (date, line_account_id, active, total, blocked_by_them, hidden_by_us, added, blocked)
       VALUES (?, '', 99, 99, 0, 0, 99, 0)`,
    ).run(jstDate(0));

    for (const scope of [
      { allTenants: true } as const,
      { allowedAccountIds: ['account-own'], includeUnassigned: false },
    ]) {
      const { trend } = await getDashboardOverview(db, 'today', scope);
      expect(trend.find((d) => d.date === jstDate(0))?.active).toBe(1);
    }
  });

  test('記録のある日と無い日が混ざる', async () => {
    insertFriend('a');
    await recordFriendSnapshot(db, null);
    const { trend } = await getDashboardOverview(db, 'last7', { allTenants: true });
    const recorded = trend.filter((d) => !d.estimated);
    expect(recorded).toHaveLength(1);
    expect(recorded[0].date).toBe(jstDate(0));
  });

  test('古い順に並ぶ', async () => {
    const { trend } = await getDashboardOverview(db, 'last7', { allTenants: true });
    const dates = trend.map((d) => d.date);
    expect([...dates].sort()).toEqual(dates);
  });

  test('同じ日に二度記録しても行が増えない', async () => {
    // cron は6時間ごとに走る。1日4行になっては困る。
    insertFriend('a');
    await recordFriendSnapshot(db, null);
    insertFriend('b');
    await recordFriendSnapshot(db, null);

    const rows = sqlite.prepare(`SELECT COUNT(*) AS n FROM friend_daily_snapshots`).get() as {
      n: number;
    };
    expect(rows.n).toBe(1);
    // 上書きなので、あとの値が残る。
    const { trend } = await getDashboardOverview(db, 'today', { allTenants: true });
    expect(trend.find((d) => d.date === jstDate(0))?.active).toBe(2);
  });

  test('日次記録は1回の上限まで進め、未記録の残りを次回に続ける', async () => {
    for (const id of ['account-a', 'account-b', 'account-c']) insertAccount(id);

    await recordFriendSnapshot(db, null, jstDate(0), 2);
    expect(sqlite.prepare(`SELECT COUNT(*) AS count FROM friend_daily_snapshots`).get())
      .toEqual({ count: 2 });

    await recordFriendSnapshot(db, null, jstDate(0), 2);
    expect(sqlite.prepare(`SELECT line_account_id FROM friend_daily_snapshots ORDER BY line_account_id`).all())
      .toEqual([
        { line_account_id: '__unassigned__' },
        { line_account_id: 'account-a' },
        { line_account_id: 'account-b' },
        { line_account_id: 'account-c' },
      ]);
  });
});

describe('受信箱の状態', () => {
  test('状態ごとに数える', async () => {
    // chats は友だち1人につき1件（部分UNIQUE索引）。友だちを分けて作る。
    for (const [id, status] of [
      ['c1', 'unread'],
      ['c2', 'unread'],
      ['c3', 'in_progress'],
      ['c4', 'resolved'],
    ] as const) {
      insertFriend(id);
      sqlite
        .prepare(
          `INSERT INTO chats (id, friend_id, status, created_at, updated_at, last_message_at)
           VALUES (?, ?, ?, ?, ?, ?)`,
        )
        .run(`chat-${id}`, id, status, jstDate(0), jstDate(0), '2020-01-01T00:00:00.000+09:00');
    }
    const { inbox } = await getDashboardOverview(db, 'today', { allTenants: true });
    expect(inbox.unanswered).toBe(2);
    expect(inbox.inProgress).toBe(1);
    expect(inbox.resolved).toBe(1);
    expect(inbox.oldestUnansweredMinutes).toBeGreaterThan(0);
  });

  test('未対応が無ければ経過時間は null', async () => {
    const { inbox } = await getDashboardOverview(db, 'today', { allTenants: true });
    expect(inbox.oldestUnansweredMinutes).toBeNull();
  });
});

describe('初回返信の平均', () => {
  test('記録が無ければ null', async () => {
    // 0 を出すと「即答している」と読めてしまう。
    const { inbox } = await getDashboardOverview(db, 'today', { allTenants: true });
    expect(inbox.averageFirstReplyMinutes).toBeNull();
  });

  test('受信から返信までの分を平均する', async () => {
    insertFriend('a');
    insertFriend('b');
    const day = jstDate(0);
    // 30分 と 10分 → 平均 20分
    for (const [id, incoming, replied] of [
      ['a', `${day}T10:00:00.000+09:00`, `${day}T10:30:00.000+09:00`],
      ['b', `${day}T11:00:00.000+09:00`, `${day}T11:10:00.000+09:00`],
    ] as const) {
      sqlite
        .prepare(
          `INSERT INTO chats (id, friend_id, status, created_at, updated_at, last_incoming_at, first_replied_at)
           VALUES (?, ?, 'resolved', ?, ?, ?, ?)`,
        )
        .run(`chat-${id}`, id, day, day, incoming, replied);
    }
    const { inbox } = await getDashboardOverview(db, 'today', { allTenants: true });
    expect(inbox.averageFirstReplyMinutes).toBe(20);
  });

  test('返信が受信より前の行は混ぜない', async () => {
    // 時計のずれや手で入れた値で起こりうる。負の時間が混ざると
    // 平均が実際より短く出て、放置に気づけなくなる。
    insertFriend('a');
    const day = jstDate(0);
    sqlite
      .prepare(
        `INSERT INTO chats (id, friend_id, status, created_at, updated_at, last_incoming_at, first_replied_at)
         VALUES ('c1', 'a', 'resolved', ?, ?, ?, ?)`,
      )
      .run(day, day, `${day}T12:00:00.000+09:00`, `${day}T11:00:00.000+09:00`);
    const { inbox } = await getDashboardOverview(db, 'today', { allTenants: true });
    expect(inbox.averageFirstReplyMinutes).toBeNull();
  });
});

describe('全体', () => {
  test('選択したアカウントだけを集計し、単独配信と複数アカウント配信を含める', async () => {
    for (const id of ['account-a', 'account-b']) {
      sqlite.prepare(
        `INSERT INTO line_accounts
          (id, channel_id, name, channel_access_token, channel_secret)
         VALUES (?, ?, ?, 'token', 'secret')`,
      ).run(id, `channel-${id}`, id);
    }
    insertFriend('friend-a', { lineAccountId: 'account-a' });
    insertFriend('friend-b', { lineAccountId: 'account-b' });

    const day = `${jstDate(0)}T10:00:00.000+09:00`;
    for (const row of [
      ['single-a', 'all', 'account-a', null],
      ['single-b', 'all', 'account-b', null],
      ['multi', 'multi-account-dedup', 'account-a', '["account-a","account-b"]'],
    ] as const) {
      sqlite.prepare(
        `INSERT INTO broadcasts
          (id, title, message_type, message_content, target_type, status, created_at, line_account_id, account_ids)
         VALUES (?, ?, 'text', '本文', ?, 'sent', ?, ?, ?)`,
      ).run(row[0], row[0], row[1], day, row[2], row[3]);
    }

    const overview = await getDashboardOverview(db, 'today', { allowedAccountIds: ['account-a'], includeUnassigned: false });
    expect(overview.friends.total).toBe(1);
    expect(overview.delivery.broadcasts).toBe(2);
  });

  test('集計した時刻を返す', async () => {
    // カードごとに基準時刻がずれていないことの手がかりになる。
    const overview = await getDashboardOverview(db, 'today', { allTenants: true });
    expect(overview.generatedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(overview.period).toBe('today');
  });

  test('送信枠は DB 層では埋めない', async () => {
    // LINE の API から取るもの。DB だけを見る層が外を叩くと、
    // 外の障害でダッシュボード全体が落ちる。
    const { delivery } = await getDashboardOverview(db, 'today', { allTenants: true });
    expect(delivery.quotaLimit).toBeNull();
    expect(delivery.quotaUsed).toBeNull();
  });

  test('実データの0件と未取得を指標契約で区別する', async () => {
    const { metrics } = await getDashboardOverview(db, 'today', { allTenants: true });

    expect(metrics.activeFriends).toMatchObject({
      value: 0, state: 'empty', reason: null, period: 'latest',
    });
    expect(metrics.friendTrend).toMatchObject({
      state: 'estimated', reason: null, period: 'last7-fixed',
    });
    expect(metrics.friendTrend.value).toHaveLength(7);
    expect(metrics.friendTrend.value?.every((point) => point.active === 0 && point.estimated)).toBe(true);
    expect(metrics.monthlyQuota).toEqual({
      value: null, state: 'unavailable', reason: 'not_loaded', asOf: null, period: 'this-month',
    });
    expect(metrics.officialProfileUrl).toEqual({
      value: null, state: 'unavailable', reason: 'not_loaded', asOf: null, period: 'latest',
    });
  });

  test('友だち集計に失敗した場合は0件に見せずnullを返す', async () => {
    const healthyDb = asD1(sqlite);
    const failedFriendsDb = {
      ...healthyDb,
      prepare(query: string) {
        if (query.includes('COUNT(*) AS total') && query.includes('FROM friends')) {
          return {
            bind: () => ({ first: async () => { throw new Error('friends unavailable'); } }),
          };
        }
        return healthyDb.prepare(query);
      },
    } as D1Database;

    const { metrics, partialFailures } = await getDashboardOverview(
      failedFriendsDb,
      'today',
      { allTenants: true },
    );

    expect(metrics.activeFriends).toEqual({
      value: null, state: 'unavailable', reason: 'source_failed', asOf: null, period: 'latest',
    });
    expect(partialFailures).toContain('friends');
  });
});

describe('今月の配信(#666 N-003)', () => {
  function firstOfMonth(): string {
    return `${jstDate(0).slice(0, 8)}01`;
  }

  function prevMonthLastDay(): string {
    return new Date(Date.parse(`${firstOfMonth()}T00:00:00Z`) - 1000).toISOString().slice(0, 10);
  }

  function seedDelivery(): void {
    insertAccount('account-a');
    insertAccount('account-b');
    insertFriend('friend-a', { lineAccountId: 'account-a' });
    insertFriend('friend-b', { lineAccountId: 'account-b' });
    const today = jstDate(0);
    const first = firstOfMonth();
    const prev = prevMonthLastDay();
    const messages = [
      // [id, friend, account, createdAt, source, counted]
      ['m-today', 'friend-a', 'account-a', `${today}T10:00:00.000+09:00`, 'manual', true],
      ['m-month', 'friend-a', 'account-a', `${first}T12:00:00.000+09:00`, 'scenario', true],
      ['m-edge', 'friend-a', 'account-a', `${first}T00:00:00.000+09:00`, 'manual', true],
      ['m-prev', 'friend-a', 'account-a', `${prev}T23:59:59.000+09:00`, 'manual', false],
      ['m-other', 'friend-b', 'account-b', `${today}T10:00:00.000+09:00`, 'manual', false],
    ] as const;
    for (const [id, friend, account, createdAt, source] of messages) {
      sqlite.prepare(
        `INSERT INTO messages_log
          (id, friend_id, direction, message_type, content, source, line_account_id, created_at)
         VALUES (?, ?, 'outgoing', 'text', '本文', ?, ?, ?)`,
      ).run(id, friend, source, account, createdAt);
    }
    const broadcasts = [
      // [id, account, createdAt, sentAt, status, 数えるか]
      ['b-today', 'account-a', `${today}T09:00:00.000+09:00`, `${today}T09:05:00.000+09:00`, 'sent', true],
      ['b-edge', 'account-a', `${first}T00:00:00.000+09:00`, `${first}T00:00:00.000+09:00`, 'sent', true],
      ['b-prev', 'account-a', `${prev}T23:59:59.000+09:00`, `${prev}T23:59:59.000+09:00`, 'sent', false],
      // 先月作って今月送った分。送った日で数えるので今月に入る。
      ['b-made-last-month', 'account-a', `${prev}T20:00:00.000+09:00`, `${first}T09:00:00.000+09:00`, 'sent', true],
      // 今月作ったが送ったのは先月末（予約の作り直しなど）。今月には入れない。
      ['b-sent-last-month', 'account-a', `${today}T08:00:00.000+09:00`, `${prev}T22:00:00.000+09:00`, 'sent', false],
      // 送った日時が残っていない古い行。作った日で代用し、0件へ落とさない。
      ['b-legacy', 'account-a', `${first}T01:00:00.000+09:00`, null, 'sent', true],
      ['b-other', 'account-b', `${today}T09:00:00.000+09:00`, `${today}T09:00:00.000+09:00`, 'sent', false],
      ['b-draft', 'account-a', `${today}T09:00:00.000+09:00`, null, 'draft', false],
    ] as const;
    for (const [id, account, createdAt, sentAt, status] of broadcasts) {
      sqlite.prepare(
        `INSERT INTO broadcasts
          (id, title, message_type, message_content, target_type, status, created_at, sent_at, line_account_id, account_ids)
         VALUES (?, ?, 'text', '本文', 'all', ?, ?, ?, ?, NULL)`,
      ).run(id, id, status, createdAt, sentAt, account);
    }
    return {
      countedBroadcasts: broadcasts.filter(([, , , , , counted]) => counted).map(([id]) => id),
    };
  }

  test('期間「今日」でも今月1日からの送信を数え、先月と他アカウントを混ぜない', async () => {
    const { countedBroadcasts } = seedDelivery();
    const overview = await getDashboardOverview(db, 'today', { allowedAccountIds: ['account-a'], includeUnassigned: false });
    expect(overview.delivery.sent).toBe(3);
    expect(overview.delivery.reply).toBe(2);
    expect(overview.delivery.push).toBe(1);
    // 期待値は仕込みの「数えるか」から作る。定数を書き写すと、仕込みを
    // 増やしたときに数だけ直して中身の確認が抜ける。
    expect(overview.delivery.broadcasts).toBe(countedBroadcasts.length);
    expect(countedBroadcasts).toEqual(['b-today', 'b-edge', 'b-made-last-month', 'b-legacy']);
  });

  test('一斉配信は送った日で数える。先月作って今月送った分は入り、今月作って先月送った分は入らない', async () => {
    seedDelivery();
    const scope = { allowedAccountIds: ['account-a'], includeUnassigned: false } as const;
    const before = (await getDashboardOverview(db, 'today', scope)).delivery.broadcasts;
    // 今月送った1本を先月送りへ動かすと、ちょうど1本減る。作った日で
    // 数えていると created_at は今月のままなので減らない。
    sqlite.prepare('UPDATE broadcasts SET sent_at = ? WHERE id = ?')
      .run(`${prevMonthLastDay()}T21:00:00.000+09:00`, 'b-made-last-month');
    const after = (await getDashboardOverview(db, 'today', scope)).delivery.broadcasts;
    expect(after).toBe(before - 1);
  });

  test('期間を切り替えても「今月の配信」の範囲は変わらず、区画の期間表示は this-month', async () => {
    const { countedBroadcasts } = seedDelivery();
    const scope = { allowedAccountIds: ['account-a'], includeUnassigned: false } as const;
    for (const period of ['today', 'last7', 'last28'] as const) {
      const overview = await getDashboardOverview(db, period, scope);
      expect(overview.delivery.sent).toBe(3);
      expect(overview.delivery.broadcasts).toBe(countedBroadcasts.length);
      expect(overview.sections.delivery.period).toBe('this-month');
      expect(overview.period).toBe(period);
    }
  });
});
