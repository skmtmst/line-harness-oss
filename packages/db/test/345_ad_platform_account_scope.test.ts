import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import { describe, expect, it } from 'vitest';
import {
  AdPlatformAccountMismatchError,
  createAdPlatform,
  getActiveAdPlatforms,
  logAdConversion,
} from '../src/ad-platforms.js';

const migration = readFileSync(
  join(import.meta.dirname, '../migrations/345_ad_platform_account_scope.sql'),
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

// migration 適用前の旧形。migration を当てて境界を確かめる。
const BASE_SCHEMA = `
  CREATE TABLE line_accounts (id TEXT PRIMARY KEY);
  CREATE TABLE friends (id TEXT PRIMARY KEY, line_account_id TEXT REFERENCES line_accounts(id));
  CREATE TABLE ad_platforms (
    id           TEXT PRIMARY KEY,
    name         TEXT NOT NULL,
    display_name TEXT,
    config       TEXT NOT NULL DEFAULT '{}',
    is_active    INTEGER DEFAULT 1,
    created_at   TEXT NOT NULL DEFAULT '',
    updated_at   TEXT NOT NULL DEFAULT ''
  );
  CREATE TABLE ad_conversion_logs (
    id                  TEXT PRIMARY KEY,
    ad_platform_id      TEXT NOT NULL,
    friend_id           TEXT NOT NULL,
    conversion_point_id TEXT,
    event_name          TEXT NOT NULL,
    click_id            TEXT,
    click_id_type       TEXT,
    status              TEXT DEFAULT 'pending',
    request_body        TEXT,
    response_body       TEXT,
    error_message       TEXT,
    created_at          TEXT NOT NULL DEFAULT ''
  );
`;

function seed(): { db: D1Database; raw: Database.Database } {
  const raw = new Database(':memory:');
  raw.pragma('foreign_keys = ON');
  raw.exec(BASE_SCHEMA);
  raw.exec(migration);
  raw.exec(`INSERT INTO line_accounts (id) VALUES ('a1'), ('a2')`);
  raw.exec(`INSERT INTO friends (id, line_account_id) VALUES ('f1', 'a1'), ('f2', 'a2')`);
  return { db: asD1(raw), raw };
}

function insertPlatform(
  raw: Database.Database,
  id: string,
  lineAccountId: string | null,
  active = true,
): void {
  raw.prepare(
    `INSERT INTO ad_platforms (id, name, config, is_active, line_account_id, created_at, updated_at)
     VALUES (?, 'meta', '{}', ?, ?, '', '')`,
  ).run(id, active ? 1 : 0, lineAccountId);
}

describe('345 広告設定のアカウント境界(#638)', () => {
  it('指定アカウントの有効設定だけ返し、他店・停止中・帰属不明は返さない', async () => {
    const { db, raw } = seed();
    insertPlatform(raw, 'p1', 'a1');
    insertPlatform(raw, 'p2', 'a2');
    insertPlatform(raw, 'p-off', 'a1', false);
    insertPlatform(raw, 'p-legacy', null);

    expect((await getActiveAdPlatforms(db, 'a1')).map((p) => p.id)).toEqual(['p1']);
    expect((await getActiveAdPlatforms(db, 'a2')).map((p) => p.id)).toEqual(['p2']);
  });

  it('アカウントが空のときは空配列を返す', async () => {
    const { db, raw } = seed();
    insertPlatform(raw, 'p1', 'a1');

    expect(await getActiveAdPlatforms(db)).toEqual([]);
    expect(await getActiveAdPlatforms(db, null)).toEqual([]);
    expect(await getActiveAdPlatforms(db, '')).toEqual([]);
  });

  it('createAdPlatform は帰属を保存する', async () => {
    const { db, raw } = seed();

    const created = await createAdPlatform(db, { name: 'meta', config: {}, lineAccountId: 'a1' });

    expect(created.line_account_id).toBe('a1');
    const row = raw.prepare(`SELECT line_account_id FROM ad_platforms WHERE id = ?`).get(created.id) as {
      line_account_id: string | null;
    };
    expect(row.line_account_id).toBe('a1');
    expect((await getActiveAdPlatforms(db, 'a2')).map((p) => p.id)).not.toContain(created.id);
  });

  it('所属が一致する記録は line_account_id 付きで残る', async () => {
    const { db, raw } = seed();
    insertPlatform(raw, 'p1', 'a1');

    await logAdConversion(db, {
      platformId: 'p1', friendId: 'f1', lineAccountId: 'a1',
      eventName: 'Purchase', clickId: 'fb-1', clickIdType: 'fbclid', status: 'sent',
    });

    const row = raw.prepare(`SELECT ad_platform_id, friend_id, line_account_id, status FROM ad_conversion_logs`).get() as {
      ad_platform_id: string; friend_id: string; line_account_id: string | null; status: string;
    };
    expect(row).toMatchObject({ ad_platform_id: 'p1', friend_id: 'f1', line_account_id: 'a1', status: 'sent' });
  });

  it('所属が違う記録は残さず AdPlatformAccountMismatchError を投げる', async () => {
    const { db, raw } = seed();
    insertPlatform(raw, 'p2', 'a2');

    await expect(logAdConversion(db, {
      platformId: 'p2', friendId: 'f1', lineAccountId: 'a1',
      eventName: 'Purchase', clickId: 'fb-1', clickIdType: 'fbclid', status: 'sent',
    })).rejects.toBeInstanceOf(AdPlatformAccountMismatchError);

    expect(raw.prepare(`SELECT COUNT(*) AS n FROM ad_conversion_logs`).get()).toMatchObject({ n: 0 });
  });
});
