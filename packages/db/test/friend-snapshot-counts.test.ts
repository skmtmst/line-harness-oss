import Database from 'better-sqlite3';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { beforeEach, describe, expect, test } from 'vitest';
import { recordFriendSnapshot } from '../src/dashboard.js';
import { asD1 } from './d1-test-helper.js';

const bootstrap = readFileSync(join(import.meta.dirname, '..', 'bootstrap.sql'), 'utf8');

let sqlite: Database.Database;
let db: D1Database;

beforeEach(() => {
  sqlite = new Database(':memory:');
  sqlite.exec(bootstrap);
  db = asD1(sqlite);
});

/** cron の時刻。6時間ごとの記録は UTC 0・6・12・18 時＝日本時間 9・15・21・3 時。 */
const at = (jst: string) => new Date(`${jst}+09:00`);

function insertFriend(id: string, row: {
  following: number;
  createdAt: string;
  firstFollowedAt?: string | null;
  currentFollowStartedAt?: string | null;
  lastFollowedAt?: string | null;
  lastUnfollowedAt?: string | null;
  lineAccountId?: string | null;
}): void {
  sqlite.prepare(
    `INSERT INTO friends
       (id, line_user_id, line_account_id, display_name, is_following, is_hidden,
        first_followed_at, current_follow_started_at, last_followed_at, last_unfollowed_at,
        created_at, updated_at)
     VALUES (?, ?, ?, 'テスト', ?, 0, ?, ?, ?, ?, ?, ?)`,
  ).run(
    id, `U${id.padEnd(32, '0').slice(0, 32)}`, row.lineAccountId ?? null, row.following,
    row.firstFollowedAt ?? null, row.currentFollowStartedAt ?? null, row.lastFollowedAt ?? null,
    row.lastUnfollowedAt ?? null, row.createdAt, row.createdAt,
  );
}

/** ブロックした時刻を入れる。記録の側と同じく is_following を落とし、追加の時刻を消す。 */
function block(id: string, when: string): void {
  sqlite.prepare(
    `UPDATE friends SET is_following = 0, current_follow_started_at = NULL, last_unfollowed_at = ? WHERE id = ?`,
  ).run(when, id);
}

function row(date: string, accountId = '__unassigned__') {
  return sqlite.prepare(
    `SELECT active, added, blocked, updated_at AS updatedAt
       FROM friend_daily_snapshots WHERE date = ? AND line_account_id = ?`,
  ).get(date, accountId) as { active: number; added: number; blocked: number; updatedAt: string } | undefined;
}

function follower(id: string, since: string, extra: Partial<Parameters<typeof insertFriend>[1]> = {}): void {
  insertFriend(id, {
    following: 1, createdAt: since, firstFollowedAt: since, currentFollowStartedAt: since, lastFollowedAt: since, ...extra,
  });
}

describe('友だちの日ごとのブロック数と増えた数', () => {
  test('ブロックをその日の数に入れ、日本時間 21 時以降の動きは 0 時すぎの記録で前の日に入る', async () => {
    follower('a', '2026-09-01T10:00:00.000+09:00');
    follower('b', '2026-09-01T10:00:00.000+09:00');
    follower('c', '2026-09-01T10:00:00.000+09:00');
    follower('d', '2026-09-01T10:00:00.000+09:00');
    // 9/10 の昼に初めて友だちになった人
    follower('new', '2026-09-10T12:00:00.000+09:00');
    // 日本時間 20:59 にブロック（21 時の記録の前）
    block('a', '2026-09-10T20:59:00.000+09:00');

    await recordFriendSnapshot(db, null, undefined, 1_000, at('2026-09-10T21:00:00'));
    expect(row('2026-09-10')).toMatchObject({ active: 4, added: 1, blocked: 1 });

    // 21 時の記録より後の動き。時刻の書き方は LINE の UTC・古い列の時差なしも混ぜる。
    block('b', '2026-09-10T12:00:00.000Z'); // 日本時間 21:00
    block('c', '2026-09-10T23:59:00'); // 日本時間 23:59（時差の印なし）
    block('d', '2026-09-11T00:00:00.000+09:00'); // 日本時間 0:00 は次の日
    // 9/5 にブロックした人が 9/10 22:00 にブロックを解除して戻った
    insertFriend('back', {
      following: 1,
      createdAt: '2026-08-01T10:00:00.000+09:00',
      firstFollowedAt: '2026-08-01T10:00:00.000+09:00',
      currentFollowStartedAt: '2026-09-10T22:00:00.000+09:00',
      lastFollowedAt: '2026-09-10T22:00:00.000+09:00',
      lastUnfollowedAt: '2026-09-05T10:00:00.000+09:00',
    });

    await recordFriendSnapshot(db, null, undefined, 1_000, at('2026-09-11T03:00:00'));
    // 前の日は増えた・ブロックだけ数え直し、その日の終わりの友だち数は 21 時の記録のまま。
    expect(row('2026-09-10')).toMatchObject({ active: 4, added: 2, blocked: 3 });
    expect(row('2026-09-11')).toMatchObject({ added: 0, blocked: 1 });
  });

  test('締めた前の日は何度走っても変わらず、同じ日を 2 回数えない', async () => {
    follower('a', '2026-09-01T10:00:00.000+09:00');
    follower('b', '2026-09-01T10:00:00.000+09:00');
    await recordFriendSnapshot(db, null, undefined, 1_000, at('2026-09-10T21:00:00'));
    block('a', '2026-09-10T22:00:00.000+09:00');

    await recordFriendSnapshot(db, null, undefined, 1_000, at('2026-09-11T03:00:00'));
    const closed = row('2026-09-10');
    expect(closed).toMatchObject({ blocked: 1 });

    // 同じ人が次の日にもう一度ブロック（最後の時刻が動く）。締めた日は数え直さない。
    sqlite.prepare(`UPDATE friends SET is_following = 1, last_followed_at = ? WHERE id = 'a'`)
      .run('2026-09-11T08:00:00.000+09:00');
    block('a', '2026-09-11T08:30:00.000+09:00');
    await recordFriendSnapshot(db, null, undefined, 1_000, at('2026-09-11T09:00:00'));
    await recordFriendSnapshot(db, null, undefined, 1_000, at('2026-09-11T15:00:00'));

    expect(row('2026-09-10')).toEqual(closed);
    expect(row('2026-09-11')).toMatchObject({ added: 1, blocked: 1 });
    const count = sqlite.prepare('SELECT COUNT(*) AS n FROM friend_daily_snapshots').get() as { n: number };
    expect(count.n).toBe(2);
  });

  test('前の日の行が無い店は作らず、2 日以上前の行と旧合計行は書き換えない', async () => {
    sqlite.prepare(`INSERT INTO line_accounts (id, channel_id, name, channel_access_token, channel_secret)
      VALUES ('acc', 'channel-acc', 'acc', 'token', 'secret')`).run();
    follower('a', '2026-09-01T10:00:00.000+09:00', { lineAccountId: 'acc' });
    block('a', '2026-09-09T10:00:00.000+09:00');
    const old = `INSERT INTO friend_daily_snapshots
      (date, line_account_id, active, total, blocked_by_them, hidden_by_us, added, blocked, updated_at)
      VALUES (?, ?, 5, 5, 0, 0, 0, 0, '2026-09-09T21:00:00.000')`;
    sqlite.prepare(old).run('2026-09-09', 'acc');
    sqlite.prepare(old).run('2026-09-10', '');

    await recordFriendSnapshot(db, null, undefined, 1_000, at('2026-09-11T03:00:00'));

    expect(row('2026-09-09', 'acc')).toMatchObject({ blocked: 0, updatedAt: '2026-09-09T21:00:00.000' });
    expect(row('2026-09-10', '')).toMatchObject({ blocked: 0, updatedAt: '2026-09-09T21:00:00.000' });
    expect(row('2026-09-10', 'acc')).toBeUndefined();
    expect(row('2026-09-11', 'acc')).toMatchObject({ added: 0, blocked: 0 });
  });

  test('ブロックだけ届いた知らない人は増えたに入れず、時刻の列が無い古い行は登録日で数える', async () => {
    insertFriend('unknown', {
      following: 0, createdAt: '2026-09-10T10:00:00.000+09:00', lastUnfollowedAt: '2026-09-10T10:00:00.000+09:00',
    });
    insertFriend('legacy', { following: 1, createdAt: '2026-09-10T11:00:00.000+09:00' });

    await recordFriendSnapshot(db, null, undefined, 1_000, at('2026-09-10T15:00:00'));

    expect(row('2026-09-10')).toMatchObject({ added: 1, blocked: 1 });
  });
});
