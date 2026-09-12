/*
 * コンバージョン起点の実イベント接続 (#648 / N-253)。
 *
 * 以前この試験は apps/worker 側にあり、作りものの D1 で動いていた。その
 * 作りものが地点の絞り込みを自分で書き直していたため、**本物の SQL を壊しても
 * 緑のまま**になっていた(2026-09-11 の逆変異で判明)。ここでは bootstrap.sql を
 * 流した実 SQLite に当てる。
 *
 * 数を数えるだけでなく、返り値の `matched`(= 地点を引く SQL が何件拾ったか)を
 * 見る。件数だけを見ていると、絞り込みを外しても trackConversion 側の
 * 停止判定・アカウント判定が弾いて緑のままになる。
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import Database from 'better-sqlite3';
import { beforeAll, beforeEach, afterEach, describe, expect, it, vi } from 'vitest';

import {
  CONVERSION_SOURCE_TYPES,
  recordConversionSourceEvent,
} from '../src/conversion-event-sources.js';
import { asD1 } from './d1-test-helper.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const BOOTSTRAP = readFileSync(join(ROOT, 'bootstrap.sql'), 'utf8');

/** bootstrap.sql は900本を超えるDDL。1回だけ流してページを取っておく。 */
let SCHEMA_TEMPLATE: Buffer;

let sqlite: Database.Database;
let db: D1Database;

beforeAll(() => {
  const seed = new Database(':memory:');
  seed.exec(BOOTSTRAP);
  SCHEMA_TEMPLATE = seed.serialize();
  seed.close();
});

beforeEach(() => {
  sqlite = new Database(SCHEMA_TEMPLATE);
  sqlite.pragma('foreign_keys = OFF');
  sqlite.exec(`
    INSERT OR IGNORE INTO tenants (id, name) VALUES ('tenant-1', 'T1');
    INSERT INTO line_accounts
      (id, channel_id, name, channel_access_token, channel_secret, tenant_id, is_active)
    VALUES ('account-1', 'ch-1', 'A店', 'tok-1', 'sec-1', 'tenant-1', 1),
           ('account-9', 'ch-9', 'B店', 'tok-9', 'sec-9', 'tenant-1', 1);
    INSERT INTO friends (id, line_user_id, line_account_id, display_name, is_following)
    VALUES ('friend-1', 'U-1', 'account-1', '一郎', 1),
           ('friend-9', 'U-9', 'account-9', '別店の人', 1);
  `);
  db = asD1(sqlite);
});

afterEach(() => {
  sqlite.close();
  vi.restoreAllMocks();
});

function addPoint(
  id: string,
  eventType: string,
  over: { status?: string; accountId?: string | null } = {},
): void {
  sqlite
    .prepare(
      `INSERT INTO conversion_points
         (id, name, event_type, value, status, measure_method, count_repeat, line_account_id)
       VALUES (?, ?, ?, 1000, ?, 'webhook', 1, ?)`,
    )
    .run(
      id,
      id,
      eventType,
      over.status ?? 'active',
      over.accountId === undefined ? 'account-1' : over.accountId,
    );
}

function eventsFor(pointId: string): number {
  const row = sqlite
    .prepare(`SELECT COUNT(*) AS n FROM conversion_events WHERE conversion_point_id = ?`)
    .get(pointId) as { n: number };
  return row.n;
}

describe('コンバージョン起点の実イベント接続', () => {
  it('画面の6起点すべてが一致する地点に記録される', async () => {
    expect(CONVERSION_SOURCE_TYPES).toHaveLength(6);
    for (const sourceType of CONVERSION_SOURCE_TYPES) {
      addPoint(`point-${sourceType}`, sourceType);
      const result = await recordConversionSourceEvent(db, {
        sourceType,
        lineAccountId: 'account-1',
        friendId: 'friend-1',
        sourceEventId: `src-${sourceType}`,
      });
      expect(result).toEqual({ matched: 1, recorded: 1, failed: 0, skipped: null });
      expect(eventsFor(`point-${sourceType}`)).toBe(1);
    }
  });

  it('ほかのアカウントの地点は数えず全店共通の地点は拾う', async () => {
    addPoint('point-other', 'form_submitted', { accountId: 'account-9' });
    addPoint('point-common', 'form_submitted', { accountId: null });
    addPoint('point-mine', 'form_submitted');

    const result = await recordConversionSourceEvent(db, {
      sourceType: 'form_submitted',
      lineAccountId: 'account-1',
      friendId: 'friend-1',
      sourceEventId: 'sub-1',
    });

    expect(result.matched).toBe(2);
    expect(eventsFor('point-mine')).toBe(1);
    expect(eventsFor('point-common')).toBe(1);
    expect(eventsFor('point-other')).toBe(0);
  });

  it('申告アカウントと友だちの所属が違えば数えない', async () => {
    addPoint('point-1', 'tag_added');

    const result = await recordConversionSourceEvent(db, {
      sourceType: 'tag_added',
      lineAccountId: 'account-9',
      friendId: 'friend-1',
      sourceEventId: 'tag-1',
    });

    expect(result.skipped).toBe('account_mismatch');
    expect(result.matched).toBe(0);
    expect(eventsFor('point-1')).toBe(0);
  });

  it('同じ元イベントの再送は同じ冪等キーになり、2度目を記録しない', async () => {
    addPoint('point-1', 'ec_order_confirmed');
    const input = {
      sourceType: 'ec_order_confirmed',
      lineAccountId: 'account-1',
      friendId: 'friend-1',
      sourceEventId: 'eccube-evt-1',
    };

    await recordConversionSourceEvent(db, input);
    await recordConversionSourceEvent(db, input);

    expect(eventsFor('point-1')).toBe(1);
    const row = sqlite
      .prepare(`SELECT idempotency_key FROM conversion_events WHERE conversion_point_id = 'point-1'`)
      .get() as { idempotency_key: string };
    // 元イベントのIDがキーに入っていること。ここが変わると再送で二度数える。
    expect(row.idempotency_key).toContain('eccube-evt-1');
    expect(row.idempotency_key).toContain('ec_order_confirmed');
  });

  it('未対応の起点は成功扱いで捨てず記録だけ残す', async () => {
    addPoint('point-1', 'form_submitted');
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);

    const result = await recordConversionSourceEvent(db, {
      sourceType: 'mystery_future_event',
      lineAccountId: 'account-1',
      friendId: 'friend-1',
      sourceEventId: 'x-1',
    });

    expect(result.skipped).toBe('unknown_source');
    expect(result.matched).toBe(0);
    expect(eventsFor('point-1')).toBe(0);
    // 捨てずに記録が残る。運用者が後から辿れること。
    expect(log).toHaveBeenCalledTimes(1);
    expect(String(log.mock.calls[0][0])).toContain('conversion_source_unmatched');
    expect(String(log.mock.calls[0][0])).toContain('mystery_future_event');
  });

  it('停止中の地点は数えない', async () => {
    addPoint('point-1', 'reservation_confirmed', { status: 'stopped' });

    const result = await recordConversionSourceEvent(db, {
      sourceType: 'reservation_confirmed',
      lineAccountId: 'account-1',
      friendId: 'friend-1',
      sourceEventId: 'booking-1',
    });

    expect(result.matched).toBe(0);
    expect(eventsFor('point-1')).toBe(0);
  });

  it('知らない友だちのイベントは数えない', async () => {
    addPoint('point-1', 'webinar_completed');

    const result = await recordConversionSourceEvent(db, {
      sourceType: 'webinar_completed',
      lineAccountId: 'account-1',
      friendId: 'ghost',
      sourceEventId: 'w-1',
    });

    expect(result.skipped).toBe('friend_not_found');
    expect(result.matched).toBe(0);
    expect(eventsFor('point-1')).toBe(0);
  });

  it('別アカウントの友だちは、こちらのアカウントの地点を拾わない', async () => {
    addPoint('point-mine', 'tag_added');

    // 申告アカウントを渡さない = 友だちの所属で解決する呼ばれ方
    // (addTagToFriend からはこの形で呼ばれる)。
    const result = await recordConversionSourceEvent(db, {
      sourceType: 'tag_added',
      friendId: 'friend-9',
      sourceEventId: 'tag-9',
    });

    expect(result).toEqual({ matched: 0, recorded: 0, failed: 0, skipped: null });
    expect(eventsFor('point-mine')).toBe(0);
  });
});

describe('往復の回数', () => {
  /*
   * この関数はタグが1本付くたびに走る。一括タグ付けで N 件付けると N 回走る。
   * 友だちを引いてから地点を引く2回の形だと 2N 回の往復になっていた。
   * 1件あたり1回に畳んであることを、prepare の回数で見張る。
   *
   * 数えるのは「地点が無い」場合。計測を設定していない大多数の運用者が
   * 通る道で、ここが一番効く(地点があるときは trackConversion の分が乗る)。
   */
  it('地点が無いとき、1件あたりの問い合わせは1回だけ', async () => {
    const queries: string[] = [];
    const counting = {
      prepare(sql: string) {
        queries.push(sql);
        return (db as unknown as { prepare(s: string): unknown }).prepare(sql);
      },
    } as unknown as D1Database;

    await recordConversionSourceEvent(counting, {
      sourceType: 'tag_added',
      friendId: 'friend-1',
      sourceEventId: 'probe-1',
    });

    expect(queries).toHaveLength(1);
  });

  it('N件付けても問い合わせはN回(2N回にならない)', async () => {
    const queries: string[] = [];
    const counting = {
      prepare(sql: string) {
        queries.push(sql);
        return (db as unknown as { prepare(s: string): unknown }).prepare(sql);
      },
    } as unknown as D1Database;

    for (let i = 0; i < 10; i += 1) {
      await recordConversionSourceEvent(counting, {
        sourceType: 'tag_added',
        friendId: 'friend-1',
        sourceEventId: `probe-${i}`,
      });
    }

    expect(queries).toHaveLength(10);
  });
});
