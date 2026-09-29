import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import { describe, expect, it } from 'vitest';
import {
  claimAdConversionSend,
  finishAdConversionSend,
} from '../src/ad-platforms.js';

const migration363 = readFileSync(
  join(import.meta.dirname, '../migrations/363_ad_conversion_lease_and_provider_id.sql'),
  'utf8',
);
const migration = readFileSync(
  join(import.meta.dirname, '../migrations/346_ad_conversion_idempotency_and_backfill.sql'),
  'utf8',
);

function asD1(sqlite: Database.Database): D1Database {
  function prepare(query: string): D1PreparedStatement {
    const statement = sqlite.prepare(query);
    const bound = (params: unknown[]): D1PreparedStatement => ({
      bind: (...next: unknown[]) => bound(next),
      async all<T>() {
        return { results: statement.all(...params) as T[], success: true, meta: {} };
      },
      async first<T>() {
        return (statement.get(...params) as T | undefined) ?? null;
      },
      async run<T>() {
        const result = statement.run(...params);
        return { success: true, meta: { changes: result.changes }, results: [] } as T;
      },
    } as unknown as D1PreparedStatement);
    return bound([]);
  }
  return {
    prepare,
    async batch<T>(statements: D1PreparedStatement[]) {
      return Promise.all(statements.map((statement) => statement.run())) as T;
    },
  } as unknown as D1Database;
}

// migration 345 適用後の形。346 を当てて確かめる。
const BASE_SCHEMA = `
  CREATE TABLE line_accounts (id TEXT PRIMARY KEY);
  CREATE TABLE friends (id TEXT PRIMARY KEY, line_account_id TEXT REFERENCES line_accounts(id));
  CREATE TABLE ad_platforms (
    id TEXT PRIMARY KEY, name TEXT NOT NULL, config TEXT NOT NULL DEFAULT '{}',
    is_active INTEGER DEFAULT 1, line_account_id TEXT REFERENCES line_accounts(id),
    created_at TEXT NOT NULL DEFAULT '', updated_at TEXT NOT NULL DEFAULT ''
  );
  CREATE TABLE ad_conversion_logs (
    id TEXT PRIMARY KEY, ad_platform_id TEXT NOT NULL, friend_id TEXT NOT NULL,
    line_account_id TEXT REFERENCES line_accounts(id),
    event_name TEXT NOT NULL, click_id TEXT, click_id_type TEXT,
    status TEXT DEFAULT 'pending', request_body TEXT, response_body TEXT,
    error_message TEXT, created_at TEXT NOT NULL DEFAULT ''
  );
`;

function openDb(): Database.Database {
  const raw = new Database(':memory:');
  raw.pragma('foreign_keys = ON');
  raw.exec(BASE_SCHEMA);
  return raw;
}

const CLAIM = {
  platformId: 'p1', friendId: 'f1', lineAccountId: 'a1',
  eventName: 'Purchase', clickId: 'fb-1', clickIdType: 'fbclid',
  idempotencyKey: 'stripe:evt-1',
};

function seedAccounted(): { db: D1Database; raw: Database.Database } {
  const raw = openDb();
  raw.exec(migration);
    raw.exec(migration363);
  raw.exec(`INSERT INTO line_accounts (id) VALUES ('a1')`);
  raw.exec(`INSERT INTO friends (id, line_account_id) VALUES ('f1', 'a1')`);
  raw.exec(`INSERT INTO ad_platforms (id, name, line_account_id, created_at, updated_at)
            VALUES ('p1', 'meta', 'a1', '', '')`);
  return { db: asD1(raw), raw };
}

describe('346 広告送信の冪等キーと旧行移行(#638)', () => {
  it('初回はsend、送信済みの同じキーはskip-sent', async () => {
    const { db } = seedAccounted();

    const first = await claimAdConversionSend(db, CLAIM);
    expect(first.disposition).toBe('send');
    await finishAdConversionSend(db, { ...CLAIM, lease: first.lease as string, status: 'sent' });
    expect((await claimAdConversionSend(db, CLAIM)).disposition).toBe('skip-sent');
  });

  it('送信中の同じキーはskip-inflight、失敗済みは1回だけ取り直せる', async () => {
    const { db, raw } = seedAccounted();

    const first = await claimAdConversionSend(db, CLAIM);
    expect(first.disposition).toBe('send');
    expect((await claimAdConversionSend(db, CLAIM)).disposition).toBe('skip-inflight');
    await finishAdConversionSend(db, { ...CLAIM, lease: first.lease as string, status: 'failed', errorMessage: 'bad' });
    const retake = await claimAdConversionSend(db, CLAIM);
    expect(retake.disposition).toBe('send');
    await finishAdConversionSend(db, { ...CLAIM, lease: retake.lease as string, status: 'sent' });
    expect(raw.prepare(`SELECT COUNT(*) AS n FROM ad_conversion_logs`).get()).toMatchObject({ n: 1 });
  });

  it('キーが違えば別送信として通す', async () => {
    const { db, raw } = seedAccounted();

    const first = await claimAdConversionSend(db, CLAIM);
    expect(first.disposition).toBe('send');
    await finishAdConversionSend(db, { ...CLAIM, lease: first.lease as string, status: 'sent' });
    expect((await claimAdConversionSend(db, { ...CLAIM, idempotencyKey: 'stripe:evt-2' })).disposition).toBe('send');
    expect(raw.prepare(`SELECT COUNT(*) AS n FROM ad_conversion_logs`).get()).toMatchObject({ n: 2 });
  });

  it('アカウントが1つだけの配備では旧設定に帰属を付け、複数では残す', () => {
    const single = openDb();
    single.exec(`INSERT INTO line_accounts (id) VALUES ('only')`);
    single.exec(`INSERT INTO ad_platforms (id, name, created_at, updated_at) VALUES ('p-old', 'meta', '', '')`);
    single.exec(migration);
    expect(single.prepare(`SELECT line_account_id FROM ad_platforms WHERE id = 'p-old'`).get()).toMatchObject({
      line_account_id: 'only',
    });

    const multi = openDb();
    multi.exec(`INSERT INTO line_accounts (id) VALUES ('a1'), ('a2')`);
    multi.exec(`INSERT INTO ad_platforms (id, name, created_at, updated_at) VALUES ('p-old', 'meta', '', '')`);
    multi.exec(migration);
    expect(multi.prepare(`SELECT line_account_id FROM ad_platforms WHERE id = 'p-old'`).get()).toMatchObject({
      line_account_id: null,
    });
  });

  it('送信記録の欠けた帰属は友だちの所属から埋める', () => {
    const raw = openDb();
    raw.exec(`INSERT INTO line_accounts (id) VALUES ('a1'), ('a2')`);
    raw.exec(`INSERT INTO friends (id, line_account_id) VALUES ('f1', 'a1')`);
    raw.exec(`INSERT INTO ad_platforms (id, name, line_account_id, created_at, updated_at)
              VALUES ('p1', 'meta', 'a1', '', '')`);
    raw.exec(`INSERT INTO ad_conversion_logs (id, ad_platform_id, friend_id, event_name, created_at)
              VALUES ('log-1', 'p1', 'f1', 'Purchase', '')`);
    raw.exec(migration);
    raw.exec(migration363);

    expect(raw.prepare(`SELECT line_account_id FROM ad_conversion_logs WHERE id = 'log-1'`).get()).toMatchObject({
      line_account_id: 'a1',
    });
  });
});
