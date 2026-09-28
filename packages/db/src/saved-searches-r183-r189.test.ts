import Database from 'better-sqlite3';
import { describe, expect, it } from 'vitest';
import {
  deleteSavedSearch,
  validateSearchConditions,
  type SavedSearchAccess,
} from './saved-searches.js';

function asD1(sqlite: Database.Database): D1Database {
  function prepare(query: string): D1PreparedStatement {
    const statement = sqlite.prepare(query);
    const bound = (params: unknown[]): D1PreparedStatement => ({
      bind: (...next: unknown[]) => bound(next),
      first: async <T,>(...args: unknown[]) => {
        const row = params.length > 0 || args.length > 0
          ? statement.get(...params) as T | undefined
          : statement.get() as T | undefined;
        return row ?? null;
      },
      all: async <T,>() => ({ results: (statement.all(...params) as T[]) ?? [] }),
      run: async () => {
        const info = statement.run(...params);
        return { success: true, meta: { changes: info.changes } };
      },
    }) as unknown as D1PreparedStatement;
    return bound([]);
  }
  return { prepare, batch: async (statements: D1PreparedStatement[]) => {
    for (const statement of statements) await statement.run();
  } } as unknown as D1Database;
}

describe('R183 逆転期間は保存の時点で断る', () => {
  it('開始日が終了日より後なら422相当の失敗', () => {
    const result = validateSearchConditions({
      all: [{ kind: 'created_at', op: 'between', value: { from: '2026-09-30', to: '2026-09-01' } }],
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain('開始日が終了日より後');
  });

  it('両端同日・片側指定・正常な期間は通る', () => {
    for (const value of [
      { from: '2026-09-01', to: '2026-09-01' },
      { from: '2026-09-01', to: '' },
      { from: '', to: '2026-09-01' },
      { from: '2026-09-01', to: '2026-09-30' },
    ]) {
      const result = validateSearchConditions({
        all: [{ kind: 'last_activity', op: 'between', value }],
      });
      expect(result.ok).toBe(true);
    }
  });
});

describe('R189 一覧で開いただけの検索は削除できる', () => {
  function setup() {
    const sqlite = new Database(':memory:');
    sqlite.pragma('foreign_keys = ON');
    sqlite.exec(`
      CREATE TABLE saved_searches (
        id TEXT PRIMARY KEY,
        line_account_id TEXT NOT NULL,
        created_by TEXT,
        UNIQUE (id, line_account_id)
      );
      CREATE TABLE saved_search_usage_events (
        id TEXT PRIMARY KEY,
        saved_search_id TEXT NOT NULL,
        line_account_id TEXT NOT NULL,
        revision INTEGER NOT NULL,
        reference_kind TEXT NOT NULL,
        reference_id TEXT,
        used_by TEXT,
        used_at TEXT NOT NULL,
        FOREIGN KEY (saved_search_id, line_account_id)
          REFERENCES saved_searches(id, line_account_id) ON DELETE RESTRICT
      );
    `);
    return asD1(sqlite);
  }

  const access: SavedSearchAccess = { lineAccountId: 'account-1', staffId: 'u-1', canManageAll: true };

  it('閲覧履歴だけの検索は履歴ごと消せる', async () => {
    const db = setup();
    await db.prepare('INSERT INTO saved_searches (id, line_account_id, created_by) VALUES (?, ?, ?)')
      .bind('search-1', 'account-1', 'u-1').run();
    await db.prepare(`INSERT INTO saved_search_usage_events
        (id, saved_search_id, line_account_id, revision, reference_kind, used_by, used_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`)
      .bind('event-1', 'search-1', 'account-1', 1, 'friends', 'u-1', '2026-09-27T10:00:00+09:00').run();

    const deleted = await deleteSavedSearch(db, 'search-1', access);
    expect(deleted).toBe(true);
    const remaining = await db.prepare('SELECT COUNT(*) AS n FROM saved_searches')
      .first<{ n: number }>();
    expect(remaining?.n).toBe(0);
    const events = await db.prepare('SELECT COUNT(*) AS n FROM saved_search_usage_events')
      .first<{ n: number }>();
    expect(events?.n).toBe(0);
  });

  it('別アカウントの履歴は消さない', async () => {
    const db = setup();
    await db.prepare('INSERT INTO saved_searches (id, line_account_id, created_by) VALUES (?, ?, ?)')
      .bind('search-1', 'account-1', 'u-1').run();
    await db.prepare('INSERT INTO saved_searches (id, line_account_id, created_by) VALUES (?, ?, ?)')
      .bind('search-2', 'account-2', 'u-1').run();
    await db.prepare(`INSERT INTO saved_search_usage_events
        (id, saved_search_id, line_account_id, revision, reference_kind, used_by, used_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`)
      .bind('event-2', 'search-2', 'account-2', 1, 'friends', 'u-1', '2026-09-27T10:00:00+09:00').run();

    const deleted = await deleteSavedSearch(db, 'search-1', access);
    expect(deleted).toBe(true);
    const events = await db.prepare('SELECT COUNT(*) AS n FROM saved_search_usage_events')
      .first<{ n: number }>();
    expect(events?.n).toBe(1);
  });
});
