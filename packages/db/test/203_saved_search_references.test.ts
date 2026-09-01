import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  getSavedSearchReferences,
  removeSavedSearchReference,
  upsertSavedSearchReference,
} from '../src/saved-searches.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

function asD1(sqlite: Database.Database): D1Database {
  function prepare(query: string): D1PreparedStatement {
    const statement = sqlite.prepare(query);
    const make = (params: unknown[]): D1PreparedStatement => ({
      bind: (...next: unknown[]) => make(next),
      async all<T>() {
        return { results: statement.all(...params) as T[], success: true, meta: {} };
      },
      async first<T>() {
        return (statement.get(...params) as T | undefined) ?? null;
      },
      async run<T>() {
        const info = statement.run(...params);
        return { success: true, meta: { changes: info.changes }, results: [] } as T;
      },
      raw: async () => [],
    } as unknown as D1PreparedStatement);
    return make([]);
  }
  return { prepare } as unknown as D1Database;
}

describe('203 保存した検索の使用先台帳', () => {
  let sqlite: Database.Database;
  let db: D1Database;

  beforeEach(() => {
    sqlite = new Database(':memory:');
    sqlite.pragma('foreign_keys = ON');
    sqlite.exec(readFileSync(join(ROOT, 'bootstrap.sql'), 'utf8'));
    sqlite.prepare(
      `INSERT INTO line_accounts
         (id, channel_id, name, channel_access_token, channel_secret)
       VALUES (?, ?, ?, ?, ?)`,
    ).run('account-1', 'channel-1', '本店', 'token', 'secret');
    sqlite.prepare(
      `INSERT INTO line_accounts
         (id, channel_id, name, channel_access_token, channel_secret)
       VALUES (?, ?, ?, ?, ?)`,
    ).run('account-2', 'channel-2', '支店', 'token', 'secret');
    sqlite.prepare(
      `INSERT INTO saved_searches
         (id, name, scope, conditions_json, created_by, line_account_id)
       VALUES (?, ?, 'friends', ?, ?, ?)`,
    ).run('search-1', '休眠顧客', '{"all":[{"kind":"name","op":"contains","value":"山田"}]}', 'staff-1', 'account-1');
    db = asD1(sqlite);
  });

  afterEach(() => sqlite.close());

  it('同じアカウントの使用先だけを一覧へ返す', async () => {
    await upsertSavedSearchReference(db, {
      savedSearchId: 'search-1',
      lineAccountId: 'account-1',
      kind: 'broadcast',
      referenceId: 'broadcast-1',
      referenceName: '月末のご案内',
      mode: 'live',
      lastUsedAt: '2026-08-28T10:00:00.000',
    });
    expect(await getSavedSearchReferences(db, ['search-1'], 'account-1')).toMatchObject([{
      saved_search_id: 'search-1',
      reference_kind: 'broadcast',
      reference_name: '月末のご案内',
      reference_mode: 'live',
    }]);
    expect(await getSavedSearchReferences(db, ['search-1'], 'account-2')).toEqual([]);
  });

  it('別アカウントの検索へ使用先を紐付けられない', async () => {
    await expect(upsertSavedSearchReference(db, {
      savedSearchId: 'search-1',
      lineAccountId: 'account-2',
      kind: 'automation',
      referenceId: 'automation-1',
      referenceName: '休眠フォロー',
      mode: 'live',
    })).rejects.toThrow(/FOREIGN KEY/i);
  });

  it('使用中は直DELETEも止め、使用先を外すと削除できる', async () => {
    await upsertSavedSearchReference(db, {
      savedSearchId: 'search-1',
      lineAccountId: 'account-1',
      kind: 'scenario',
      referenceId: 'scenario-1',
      referenceName: '初回案内',
      mode: 'fixed',
    });
    expect(() => sqlite.prepare('DELETE FROM saved_searches WHERE id = ?').run('search-1'))
      .toThrow(/FOREIGN KEY/i);
    await removeSavedSearchReference(db, {
      savedSearchId: 'search-1',
      kind: 'scenario',
      referenceId: 'scenario-1',
    });
    expect(sqlite.prepare('DELETE FROM saved_searches WHERE id = ?').run('search-1').changes).toBe(1);
  });
});
