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

  test('統括ごとの表示では全社合計の日次記録を使わず、その統括だけを逆算する', async () => {
    for (const id of ['account-own', 'account-other']) {
      sqlite.prepare(
        `INSERT INTO line_accounts
          (id, channel_id, name, channel_access_token, channel_secret)
         VALUES (?, ?, ?, 'token', 'secret')`,
      ).run(id, `channel-${id}`, id);
    }
    insertFriend('own', { lineAccountId: 'account-own' });
    insertFriend('other', { lineAccountId: 'account-other' });
    await recordFriendSnapshot(db, null);

    const { trend } = await getDashboardOverview(db, 'today', {
      allowedAccountIds: ['account-own'],
      includeUnassigned: true,
    });
    const today = trend.find((d) => d.date === jstDate(0));

    expect(today?.estimated).toBe(true);
    expect(today?.active).toBe(1);
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
});
