import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import { describe, expect, it } from 'vitest';
import {
  AdPlatformAccountMismatchError,
  claimAdConversionSend,
  createAdPlatform,
  deleteAdPlatformCAS,
  finishAdConversionSend,
  getPinnedAdConversionAccount,
  updateAdPlatform,
  updateAdPlatformCAS,
} from '../src/ad-platforms.js';

const migration346 = readFileSync(
  join(import.meta.dirname, '../migrations/346_ad_conversion_idempotency_and_backfill.sql'),
  'utf8',
);
const migration = readFileSync(
  join(import.meta.dirname, '../migrations/359_ad_platform_account_required_and_dedup.sql'),
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

// migration 346 適用後の形。359 を当てて確かめる。
const BASE_SCHEMA = `
  CREATE TABLE line_accounts (id TEXT PRIMARY KEY);
  CREATE TABLE friends (id TEXT PRIMARY KEY, line_account_id TEXT REFERENCES line_accounts(id));
  CREATE TABLE ad_platforms (
    id TEXT PRIMARY KEY, name TEXT NOT NULL, display_name TEXT,
    config TEXT NOT NULL DEFAULT '{}', is_active INTEGER DEFAULT 1,
    line_account_id TEXT REFERENCES line_accounts(id),
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

function seed(): { db: D1Database; raw: Database.Database } {
  const raw = new Database(':memory:');
  raw.pragma('foreign_keys = ON');
  raw.exec(BASE_SCHEMA);
  raw.exec(migration346);
  raw.exec(migration);
  raw.exec(`INSERT INTO line_accounts (id) VALUES ('a1'), ('a2')`);
  raw.exec(`INSERT INTO friends (id, line_account_id) VALUES ('f1', 'a1'), ('f2', 'a2')`);
  raw.exec(`INSERT INTO ad_platforms (id, name, line_account_id, created_at, updated_at)
            VALUES ('p1', 'meta', 'a1', '', ''), ('p2', 'meta', 'a2', '', '')`);
  return { db: asD1(raw), raw };
}

const CLAIM = {
  platformId: 'p1', friendId: 'f1', lineAccountId: 'a1',
  eventName: 'Purchase', clickId: 'fb-1', clickIdType: 'fbclid',
  eventValue: 1000, idempotencyKey: 'stripe:evt-1',
};

describe('359 帰属必須・重複禁止・履歴訂正(#638)', () => {
  it('帰属なしの作成・帰属外しはDBとhelperの両方で止まる', async () => {
    const { db, raw } = seed();

    await expect(createAdPlatform(db, { name: 'google', config: {} }))
      .rejects.toBeInstanceOf(AdPlatformAccountMismatchError);
    await expect(updateAdPlatform(db, 'p1', { lineAccountId: null }))
      .rejects.toBeInstanceOf(AdPlatformAccountMismatchError);
    expect(() => raw.prepare(
      `INSERT INTO ad_platforms (id, name, created_at, updated_at) VALUES ('px', 'meta', '', '')`,
    ).run()).toThrow(/line_account_id is required/);
    expect(() => raw.prepare(`UPDATE ad_platforms SET line_account_id = NULL WHERE id = 'p1'`).run())
      .toThrow(/cannot be cleared/);
  });

  it('同一アカウント・同一媒体の重複設定を禁じる', async () => {
    const { db } = seed();

    await expect(createAdPlatform(db, { name: 'meta', config: {}, lineAccountId: 'a1' }))
      .rejects.toThrow(/unique/i);
    // 別アカウントの同名は許す。
    const other = await createAdPlatform(db, { name: 'google', config: {}, lineAccountId: 'a1' });
    expect(other.line_account_id).toBe('a1');
  });

  it('履歴の帰属は媒体設定を優先して直す', () => {
    const raw = new Database(':memory:');
    raw.pragma('foreign_keys = ON');
    raw.exec(BASE_SCHEMA);
    raw.exec(`INSERT INTO line_accounts (id) VALUES ('a1'), ('a2')`);
    raw.exec(`INSERT INTO friends (id, line_account_id) VALUES ('f1', 'a2')`);
    raw.exec(`INSERT INTO ad_platforms (id, name, line_account_id, created_at, updated_at)
              VALUES ('p1', 'meta', 'a1', '', ''), ('pn', 'meta', NULL, '', '')`);
    // 346 が友だち現所属(a2)へ誤って移した行と、未移行の行。
    raw.exec(`INSERT INTO ad_conversion_logs (id, ad_platform_id, friend_id, line_account_id, event_name, created_at)
              VALUES ('moved', 'p1', 'f1', 'a2', 'Purchase', ''),
                     ('unmoved', 'p1', 'f1', NULL, 'Purchase', ''),
                     ('legacy', 'pn', 'f1', 'a2', 'Purchase', '')`);
    raw.exec(migration346);
    raw.exec(migration);

    const rows = raw.prepare(`SELECT id, line_account_id FROM ad_conversion_logs ORDER BY id`).all() as Array<{
      id: string; line_account_id: string | null;
    }>;
    expect(rows).toEqual([
      { id: 'legacy', line_account_id: 'a2' },
      { id: 'moved', line_account_id: 'a1' },
      { id: 'unmoved', line_account_id: 'a1' },
    ]);
  });

  it('同じ鍵で金額・クリックIDが変われば拒否する', async () => {
    const { db } = seed();

    expect(await claimAdConversionSend(db, CLAIM)).toBe('send');
    await finishAdConversionSend(db, { ...CLAIM, status: 'sent' });
    expect(await claimAdConversionSend(db, { ...CLAIM, eventValue: 2000 })).toBe('mismatch');
    expect(await claimAdConversionSend(db, { ...CLAIM, clickId: 'fb-2' })).toBe('mismatch');
    expect(await claimAdConversionSend(db, CLAIM)).toBe('skip-sent');
  });

  it('古いpendingは取り直せる。新しいpendingは待つ', async () => {
    const { db, raw } = seed();

    expect(await claimAdConversionSend(db, CLAIM)).toBe('send');
    expect(await claimAdConversionSend(db, CLAIM)).toBe('skip-inflight');
    raw.prepare(`UPDATE ad_conversion_logs SET created_at = '2000-01-01T00:00:00.000+09:00'`).run();
    expect(await claimAdConversionSend(db, CLAIM)).toBe('send');
  });

  it('初回確保の所属を固定して返す', async () => {
    const { db } = seed();

    expect(await claimAdConversionSend(db, CLAIM)).toBe('send');
    expect(await getPinnedAdConversionAccount(db, {
      friendId: 'f1', eventName: 'Purchase', idempotencyKey: 'stripe:evt-1',
    })).toBe('a1');
    expect(await getPinnedAdConversionAccount(db, {
      friendId: 'f1', eventName: 'Purchase', idempotencyKey: 'stripe:nope',
    })).toBeNull();
  });

  it('CASは認可外の所属に当たらない', async () => {
    const { db, raw } = seed();

    const denied = await updateAdPlatformCAS(db, 'p2', { accountIds: ['a1'], includeUnassigned: false }, { displayName: '変' });
    expect(denied.applied).toBe(false);
    expect(raw.prepare(`SELECT display_name FROM ad_platforms WHERE id = 'p2'`).get()).toMatchObject({ display_name: null });

    const allowed = await updateAdPlatformCAS(db, 'p1', { accountIds: ['a1'], includeUnassigned: false }, { displayName: '変' });
    expect(allowed.applied).toBe(true);
    expect(allowed.platform).toMatchObject({ id: 'p1', display_name: '変' });

    expect(await deleteAdPlatformCAS(db, 'p2', { accountIds: ['a1'], includeUnassigned: false })).toBe(false);
    expect(await deleteAdPlatformCAS(db, 'p2', { accountIds: ['a2'], includeUnassigned: false })).toBe(true);
    expect(raw.prepare(`SELECT COUNT(*) AS n FROM ad_platforms WHERE id = 'p2'`).get()).toMatchObject({ n: 0 });
  });
});
