/*
 * N-101(#622): 送信権の予約を「独立した2つの接続」で確かめる。
 *
 * 1つの接続の中で await を挟むだけでは、SQL が本当に競合を捌けているかは
 * 分からない。同じDBファイルへ**別々の接続**で繋ぎ、2つの実行主体として
 * 取り合わせる。片方が置いた行を、もう片方の接続が同じ1文の中で見て
 * 判断できていること（原子的な CAS）を確かめる。
 */
import { describe, expect, it, beforeAll, afterAll, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import { copyFileSync, mkdtempSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  claimFriendAddSendRight,
  isFriendAddSendRightHolder,
  releaseFriendAddSendRight,
  markFriendAddEventRouting,
} from '../src/friend-add-events.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PKG_ROOT = join(__dirname, '..');

/** changes を返す最小のD1代替。RETURNING は first で受ける。 */
function asD1(sqlite: Database.Database): D1Database {
  return {
    prepare(query: string) {
      return {
        bind(...params: unknown[]) {
          const stmt = sqlite.prepare(query);
          return {
            async run() {
              const info = stmt.run(...params);
              return { success: true, meta: { changes: info.changes } };
            },
            async first<T>() {
              return (stmt.get(...params) as T) ?? null;
            },
            async all<T>() {
              return { results: stmt.all(...params) as T[], success: true, meta: {} };
            },
          };
        },
      };
    },
  } as unknown as D1Database;
}

const NOW = '2026-09-08T10:00:00.000+09:00';
const LATER = '2026-09-08T10:10:00.000+09:00';

describe('送信権の予約 — 独立2接続 (#622)', () => {
  /*
   * schema を流すのは重い（実ファイルへ何千ものDDL）。1度だけ雛形を作り、
   * テストごとにその写しを置く。写しは別のファイルなのでテスト同士は
   * 影響し合わない。
   */
  let templateDir: string;
  let templatePath: string;
  let dir: string;
  let path: string;
  /** 実行主体A・Bの接続。共有しない。 */
  let connA: Database.Database;
  let connB: Database.Database;
  let dbA: D1Database;
  let dbB: D1Database;

  /** 実DBと同じ見え方のまま、テストのディスク待ちだけ削る。 */
  function openFast(file: string): Database.Database {
    const conn = new Database(file);
    conn.pragma('journal_mode = WAL');
    conn.pragma('synchronous = OFF');
    conn.pragma('busy_timeout = 2000');
    return conn;
  }

  beforeAll(() => {
    templateDir = mkdtempSync(join(tmpdir(), 'friend-add-claims-tpl-'));
    templatePath = join(templateDir, 'template.sqlite');
    const setup = openFast(templatePath);
    setup.exec(readFileSync(join(PKG_ROOT, 'bootstrap.sql'), 'utf8'));
    setup.prepare(
      `INSERT INTO line_accounts (id, channel_id, name, channel_access_token, channel_secret)
       VALUES ('account-1', 'channel-1', '店舗1', 'token-1', 'secret-1')`,
    ).run();
    setup.prepare(
      `INSERT INTO friends (id, line_user_id, line_account_id)
       VALUES ('friend-1', 'U-1', 'account-1')`,
    ).run();
    for (const eventId of ['event-a', 'event-b']) {
      setup.prepare(
        `INSERT INTO friend_add_events
          (id, line_account_id, friend_id, webhook_event_id, friend_kind, routing_status, occurred_at)
         VALUES (?, 'account-1', 'friend-1', ?, 'first_time', 'pending', ?)`,
      ).run(eventId, `webhook-${eventId}`, NOW);
    }
    // WAL を畳んで、写しても中身が揃っている状態にする。
    setup.pragma('wal_checkpoint(TRUNCATE)');
    setup.close();
  });

  afterAll(() => rmSync(templateDir, { recursive: true, force: true }));

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'friend-add-claims-'));
    path = join(dir, 'test.sqlite');
    copyFileSync(templatePath, path);
    connA = openFast(path);
    connB = openFast(path);
    dbA = asD1(connA);
    dbB = asD1(connB);
  });

  afterEach(() => {
    connA.close();
    connB.close();
    rmSync(dir, { recursive: true, force: true });
  });

  it('別接続の2実行が同時に取りにいっても、予約は片方だけ', async () => {
    const [a, b] = await Promise.all([
      claimFriendAddSendRight(dbA, {
        lineAccountId: 'account-1', friendId: 'friend-1', eventId: 'event-a', now: NOW,
      }),
      claimFriendAddSendRight(dbB, {
        lineAccountId: 'account-1', friendId: 'friend-1', eventId: 'event-b', now: NOW,
      }),
    ]);
    expect([a.held, b.held].filter(Boolean)).toHaveLength(1);
    const winner = a.held ? a : b;
    expect(winner.generation).toBe(1);
    const loser = a.held ? b : a;
    expect(loser).toEqual({ held: false, generation: 0 });
    expect(connA.prepare(`SELECT COUNT(*) AS n FROM friend_add_send_claims`).get()).toEqual({ n: 1 });
  });

  it('回収された旧持ち主は、別接続からの確認でも台帳を書けない', async () => {
    const a = await claimFriendAddSendRight(dbA, {
      lineAccountId: 'account-1', friendId: 'friend-1', eventId: 'event-a', now: NOW,
    });
    expect(a).toEqual({ held: true, generation: 1 });

    // Aが処理中に落ちたとみなされる時刻。Bが別接続から奪い直す。
    const b = await claimFriendAddSendRight(dbB, {
      lineAccountId: 'account-1', friendId: 'friend-1', eventId: 'event-b', now: LATER,
    });
    expect(b).toEqual({ held: true, generation: 2 });

    // Aは自分の接続で見ても、もう持ち主ではない
    await expect(isFriendAddSendRightHolder(dbA, {
      lineAccountId: 'account-1', friendId: 'friend-1', eventId: 'event-a', generation: a.generation,
    })).resolves.toBe(false);

    // Aの台帳確定は1行も書かない（確認と書き込みが同じ1文のため隙が無い）
    await expect(markFriendAddEventRouting(dbA, {
      eventId: 'event-a',
      lineAccountId: 'account-1',
      status: 'completed',
      deliveryCount: 1,
      fence: { friendId: 'friend-1', generation: a.generation },
    })).resolves.toBe(false);
    expect(connB.prepare(`SELECT routing_status FROM friend_add_events WHERE id = 'event-a'`).get())
      .toEqual({ routing_status: 'pending' });

    // Bの台帳確定は通る
    await expect(markFriendAddEventRouting(dbB, {
      eventId: 'event-b',
      lineAccountId: 'account-1',
      status: 'completed',
      deliveryCount: 1,
      fence: { friendId: 'friend-1', generation: b.generation },
    })).resolves.toBe(true);
    expect(connA.prepare(`SELECT routing_status, delivery_count FROM friend_add_events WHERE id = 'event-b'`).get())
      .toEqual({ routing_status: 'completed', delivery_count: 1 });

    // Aが遅れて解放しても、Bの予約は消えない
    await releaseFriendAddSendRight(dbA, {
      lineAccountId: 'account-1', friendId: 'friend-1', eventId: 'event-a', generation: a.generation,
    });
    expect(connB.prepare(`SELECT event_id, generation FROM friend_add_send_claims`).get())
      .toEqual({ event_id: 'event-b', generation: 2 });
  });

  it('奪い直しも別接続同士で1回だけ成功する', async () => {
    await claimFriendAddSendRight(dbA, {
      lineAccountId: 'account-1', friendId: 'friend-1', eventId: 'event-a', now: NOW,
    });
    // 2つの実行主体が同時に「古い予約を奪う」を試みる
    const [x, y] = await Promise.all([
      claimFriendAddSendRight(dbA, {
        lineAccountId: 'account-1', friendId: 'friend-1', eventId: 'event-b', now: LATER,
      }),
      claimFriendAddSendRight(dbB, {
        lineAccountId: 'account-1', friendId: 'friend-1', eventId: 'event-a', now: LATER,
      }),
    ]);
    expect([x.held, y.held].filter(Boolean)).toHaveLength(1);
    const row = connA.prepare(`SELECT event_id, generation FROM friend_add_send_claims`).get() as {
      event_id: string; generation: number;
    };
    // 世代は1回だけ進む。負けた側は持ち主でない。
    expect(row.generation).toBe(2);
    const winner = x.held ? { claim: x, eventId: 'event-b' } : { claim: y, eventId: 'event-a' };
    expect(row.event_id).toBe(winner.eventId);
    expect(winner.claim.generation).toBe(2);
  });

  it('予約表が読めないときは投げる（呼ぶ側は送らない）', async () => {
    connA.exec('DROP TABLE friend_add_send_claims');
    await expect(claimFriendAddSendRight(dbB, {
      lineAccountId: 'account-1', friendId: 'friend-1', eventId: 'event-a', now: NOW,
    })).rejects.toThrow(/friend_add_send_claims/);
  });
});
