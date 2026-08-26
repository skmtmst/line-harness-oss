import { describe, expect, test, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import { readFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  createConversionPoint,
  updateConversionPoint,
  getUrlReachConversionPoints,
  getConversionEvents,
  trackConversion,
} from '../src/conversions.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PKG_ROOT = join(__dirname, '..');
const MIGRATIONS_DIR = join(PKG_ROOT, 'migrations');

const BENIGN = /duplicate column name|already exists/i;

function execSafe(db: Database.Database, sql: string): void {
  for (const stmt of sql
    .split(/;\s*(?:\r?\n|$)/)
    .map((s) => s.trim())
    .filter(Boolean)) {
    try {
      db.exec(stmt);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (!BENIGN.test(msg)) throw err;
    }
  }
}

function setupDb(): Database.Database {
  const db = new Database(':memory:');
  execSafe(db, readFileSync(join(PKG_ROOT, 'schema.sql'), 'utf8'));
  for (const file of readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith('.sql'))
    .sort()) {
    execSafe(db, readFileSync(join(MIGRATIONS_DIR, file), 'utf8'));
  }
  return db;
}

function asD1(sqlite: Database.Database): D1Database {
  return {
    prepare(query: string) {
      return {
        bind(...params: unknown[]) {
          const stmt = sqlite.prepare(query);
          return {
            async run() {
              stmt.run(...params);
              return { results: [], success: true, meta: {} };
            },
            async first<T>() {
              return (stmt.get(...params) as T) ?? null;
            },
            async all<T>() {
              return { results: stmt.all(...params) as T[], success: true, meta: {} };
            },
          };
        },
        async run() {
          sqlite.prepare(query).run();
          return { results: [], success: true, meta: {} };
        },
        async first<T>() {
          return (sqlite.prepare(query).get() as T) ?? null;
        },
        async all<T>() {
          return { results: sqlite.prepare(query).all() as T[], success: true, meta: {} };
        },
      };
    },
  } as unknown as D1Database;
}

function insertFriend(sqlite: Database.Database, id: string): void {
  sqlite
    .prepare(
      `INSERT INTO friends (id, line_user_id, display_name, created_at, updated_at)
       VALUES (?, ?, 'Test User', '2024-01-01T00:00:00.000+09:00', '2024-01-01T00:00:00.000+09:00')`,
    )
    .run(id, `U${id.replace(/[^0-9a-f]/gi, '').padEnd(32, '0').slice(0, 32)}`);
}

let sqlite: Database.Database;
let db: D1Database;

beforeEach(() => {
  sqlite = setupDb();
  db = asD1(sqlite);
});

describe('成果一覧の統括絞り込み', () => {
  test('アカウント絞り込みをページングより先に適用する', async () => {
    const insertAccount = sqlite.prepare(
      `INSERT INTO line_accounts (id, name, channel_id, channel_secret, channel_access_token)
       VALUES (?, ?, ?, 'secret', 'token')`,
    );
    insertAccount.run('own', 'Own', 'channel-own');
    insertAccount.run('other', 'Other', 'channel-other');
    const own = await createConversionPoint(db, { name: '自統括', eventType: 'purchase', lineAccountId: 'own' });
    const other = await createConversionPoint(db, { name: '別統括', eventType: 'purchase', lineAccountId: 'other' });
    insertFriend(sqlite, 'friend');
    const insert = sqlite.prepare(
      `INSERT INTO conversion_events (id, conversion_point_id, friend_id, created_at)
       VALUES (?, ?, 'friend', ?)`,
    );
    insert.run('older-own', own.id, '2026-02-01T00:00:00.000+09:00');
    insert.run('newer-other', other.id, '2026-02-02T00:00:00.000+09:00');

    const rows = await getConversionEvents(db, {
      limit: 1, offset: 0, allowedAccountIds: ['own'], canSeeUnassigned: false,
    });
    expect(rows.map((row) => row.id)).toEqual(['older-own']);
  });
});

describe('既定値', () => {
  test('何も指定しなければ、これまでと同じ動きになる', async () => {
    const point = await createConversionPoint(db, { name: '購入', eventType: 'purchase' });
    expect(point.measure_method).toBe('manual');
    expect(point.target_url).toBeNull();
    expect(point.count_repeat).toBe(1); // 毎回数える = 従来どおり
    expect(point.attribution_days).toBeNull();
    expect(point.line_account_id).toBeNull();
  });
});

describe('同じ人を何度数えるか', () => {
  test('既定では踏むたびに増える', async () => {
    insertFriend(sqlite, 'f-1');
    const point = await createConversionPoint(db, { name: '購入', eventType: 'purchase' });
    await trackConversion(db, { conversionPointId: point.id, friendId: 'f-1' });
    await trackConversion(db, { conversionPointId: point.id, friendId: 'f-1' });
    const { c } = sqlite
      .prepare(`SELECT COUNT(*) AS c FROM conversion_events WHERE conversion_point_id = ?`)
      .get(point.id) as { c: number };
    expect(c).toBe(2);
  });

  test('一人一回の地点では2件目が増えない', async () => {
    insertFriend(sqlite, 'f-1');
    const point = await createConversionPoint(db, {
      name: 'LP到達',
      eventType: 'reach',
      countRepeat: false,
    });
    const first = await trackConversion(db, { conversionPointId: point.id, friendId: 'f-1' });
    const second = await trackConversion(db, { conversionPointId: point.id, friendId: 'f-1' });
    // 例外にせず、既存の1件を返す。二重に踏むのは利用者にとって普通の行動。
    expect(second.id).toBe(first.id);
    const { c } = sqlite
      .prepare(`SELECT COUNT(*) AS c FROM conversion_events WHERE conversion_point_id = ?`)
      .get(point.id) as { c: number };
    expect(c).toBe(1);
  });

  test('人が違えばそれぞれ1件ずつ数える', async () => {
    insertFriend(sqlite, 'f-1');
    insertFriend(sqlite, 'f-2');
    const point = await createConversionPoint(db, {
      name: 'LP到達',
      eventType: 'reach',
      countRepeat: false,
    });
    await trackConversion(db, { conversionPointId: point.id, friendId: 'f-1' });
    await trackConversion(db, { conversionPointId: point.id, friendId: 'f-2' });
    const { c } = sqlite
      .prepare(`SELECT COUNT(*) AS c FROM conversion_events WHERE conversion_point_id = ?`)
      .get(point.id) as { c: number };
    expect(c).toBe(2);
  });
});

describe('URL到達で数える地点の検索', () => {
  test('前方一致で拾う（クエリ文字列が付いても数える）', async () => {
    await createConversionPoint(db, {
      name: 'LP到達',
      eventType: 'reach',
      measureMethod: 'url_reach',
      targetUrl: 'https://example.com/thanks',
    });
    const hits = await getUrlReachConversionPoints(
      db,
      'https://example.com/thanks?utm_source=line',
      null,
    );
    expect(hits).toHaveLength(1);
  });

  test('URLの途中に含まれるだけでは拾わない', async () => {
    await createConversionPoint(db, {
      name: 'LP到達',
      eventType: 'reach',
      measureMethod: 'url_reach',
      targetUrl: 'https://example.com/thanks',
    });
    const hits = await getUrlReachConversionPoints(
      db,
      'https://other.example.net/?next=https://example.com/thanks',
      null,
    );
    expect(hits).toHaveLength(0);
  });

  test('manual の地点は拾わない', async () => {
    await createConversionPoint(db, { name: '購入', eventType: 'purchase' });
    const hits = await getUrlReachConversionPoints(db, 'https://example.com/thanks', null);
    expect(hits).toHaveLength(0);
  });

  test('アカウントを絞った地点は、そのアカウントでのみ拾う', async () => {
    sqlite
      .prepare(
        `INSERT INTO line_accounts (id, name, channel_id, channel_secret, channel_access_token, created_at, updated_at)
         VALUES ('acc-1', 'A店', 'c1', 's1', 't1', '2024-01-01', '2024-01-01'),
                ('acc-2', 'B店', 'c2', 's2', 't2', '2024-01-01', '2024-01-01')`,
      )
      .run();
    await createConversionPoint(db, {
      name: 'A店のLP',
      eventType: 'reach',
      measureMethod: 'url_reach',
      targetUrl: 'https://example.com/lp',
      lineAccountId: 'acc-1',
    });
    expect(await getUrlReachConversionPoints(db, 'https://example.com/lp', 'acc-1')).toHaveLength(1);
    expect(await getUrlReachConversionPoints(db, 'https://example.com/lp', 'acc-2')).toHaveLength(0);
    // 絞っていない地点は全アカウントで拾うが、絞った地点は拾わない。
    expect(await getUrlReachConversionPoints(db, 'https://example.com/lp', null)).toHaveLength(0);
  });
});

describe('部分更新', () => {
  test('送っていない項目は変わらない', async () => {
    const point = await createConversionPoint(db, {
      name: 'LP到達',
      eventType: 'reach',
      measureMethod: 'url_reach',
      targetUrl: 'https://example.com/thanks',
      attributionDays: 30,
    });
    const updated = await updateConversionPoint(db, point.id, { countRepeat: false });
    expect(updated?.target_url).toBe('https://example.com/thanks');
    expect(updated?.attribution_days).toBe(30);
    expect(updated?.count_repeat).toBe(0);
  });

  test('何も送らなくても壊れない', async () => {
    const point = await createConversionPoint(db, { name: '購入', eventType: 'purchase' });
    const updated = await updateConversionPoint(db, point.id, {});
    expect(updated?.name).toBe('購入');
  });
});
