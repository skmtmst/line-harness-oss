import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import Database from 'better-sqlite3';
import { beforeEach, describe, expect, it } from 'vitest';

import { countWebinarList, getWebinarList } from '../src/webinars.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

function asD1(sqlite: Database.Database): D1Database {
  function prepare(query: string): D1PreparedStatement {
    const statement = sqlite.prepare(query);
    const make = (params: unknown[]): D1PreparedStatement => ({
      bind: (...next: unknown[]) => make(next),
      async all<T>() {
        return { results: statement.all(...params) as T[], success: true, meta: {} };
      },
      async first<T>() { return (statement.get(...params) as T | undefined) ?? null; },
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

const SCOPE = { allowedAccountIds: ['account-1'], canSeeUnassigned: false };

describe('ウェビナー一覧のページ送りと絞り込み', () => {
  let sqlite: Database.Database;
  let db: D1Database;

  beforeEach(() => {
    sqlite = new Database(':memory:');
    sqlite.exec(readFileSync(join(ROOT, 'bootstrap.sql'), 'utf8'));
    sqlite.exec(`
      INSERT INTO line_accounts (id, channel_id, name, channel_access_token, channel_secret) VALUES
        ('account-1', 'channel-1', '本店', 'token-1', 'secret-1'),
        ('account-2', 'channel-2', '支店', 'token-2', 'secret-2');
      INSERT INTO folders (id, kind, name, account_id) VALUES
        ('folder-a', 'webinar', 'セミナー', 'account-1');
      INSERT INTO webinars
        (id, account_id, title, slug, status, folder_id, created_at, updated_at)
      VALUES
        ('w1', 'account-1', 'あセミナー', 'a-semi', 'active', 'folder-a', '2026-08-01T00:00:00.000Z', '2026-08-10T00:00:00.000Z'),
        ('w2', 'account-1', 'い講座', 'i-course', 'draft', NULL, '2026-08-02T00:00:00.000Z', '2026-08-12T00:00:00.000Z'),
        ('w3', 'account-1', 'う実践', 'u-practice', 'active', 'folder-a', '2026-08-03T00:00:00.000Z', '2026-08-11T00:00:00.000Z'),
        ('w4', 'account-1', 'え旧版', 'e-old', 'archived', NULL, '2026-08-04T00:00:00.000Z', '2026-08-13T00:00:00.000Z'),
        ('w5', 'account-2', '他店舗の会', 'other', 'active', NULL, '2026-08-05T00:00:00.000Z', '2026-08-14T00:00:00.000Z');
    `);
    db = asD1(sqlite);
  });

  it('更新が新しい順に頁を切って総件数を返す', async () => {
    const page1 = await getWebinarList(db, SCOPE, { limit: 2, offset: 0 }, { sort: 'updated' });
    expect(page1.map((row) => row.id)).toEqual(['w2', 'w3']);
    const page2 = await getWebinarList(db, SCOPE, { limit: 2, offset: 2 }, { sort: 'updated' });
    expect(page2.map((row) => row.id)).toEqual(['w1']);
    expect(await countWebinarList(db, SCOPE, {})).toBe(3);
  });

  it('アーカイブと範囲外のアカウントは数えない', async () => {
    const rows = await getWebinarList(db, SCOPE, { limit: 50, offset: 0 }, {});
    expect(rows.map((row) => row.id).sort()).toEqual(['w1', 'w2', 'w3']);
  });

  it('題名とスラッグの両方で探せる', async () => {
    const byTitle = await getWebinarList(db, SCOPE, { limit: 50, offset: 0 }, { q: '講座' });
    expect(byTitle.map((row) => row.id)).toEqual(['w2']);
    const bySlug = await getWebinarList(db, SCOPE, { limit: 50, offset: 0 }, { q: 'U-PRACTICE' });
    expect(bySlug.map((row) => row.id)).toEqual(['w3']);
    expect(await countWebinarList(db, SCOPE, { q: '講座' })).toBe(1);
  });

  it('フォルダと状態で絞れる', async () => {
    const foldered = await getWebinarList(db, SCOPE, { limit: 50, offset: 0 }, { folderId: 'folder-a' });
    expect(foldered.map((row) => row.id).sort()).toEqual(['w1', 'w3']);
    const unfiled = await getWebinarList(db, SCOPE, { limit: 50, offset: 0 }, { folderId: null });
    expect(unfiled.map((row) => row.id)).toEqual(['w2']);
    const drafts = await getWebinarList(db, SCOPE, { limit: 50, offset: 0 }, { status: 'draft' });
    expect(drafts.map((row) => row.id)).toEqual(['w2']);
    expect(await countWebinarList(db, SCOPE, { folderId: 'folder-a' })).toBe(2);
  });
});
