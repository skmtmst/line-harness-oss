import { beforeEach, describe, expect, it } from 'vitest';
import Database from 'better-sqlite3';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createEntryRoute } from '../src/entry-routes.js';

const packageRoot = join(dirname(fileURLToPath(import.meta.url)), '..');

function asD1(sqlite: Database.Database): D1Database {
  return {
    prepare(query: string) {
      return {
        bind(...params: unknown[]) {
          const statement = sqlite.prepare(query);
          return {
            async run() { statement.run(...params); return { results: [], success: true, meta: {} }; },
            async first<T>() { return (statement.get(...params) as T) ?? null; },
            async all<T>() { return { results: statement.all(...params) as T[], success: true, meta: {} }; },
          };
        },
      };
    },
  } as unknown as D1Database;
}

// R39: 作成時に選んだLINEアカウントが line_account_id 列へ残る。
describe('entry route line account', () => {
  let sqlite: Database.Database;
  let db: D1Database;

  beforeEach(() => {
    sqlite = new Database(':memory:');
    sqlite.exec(readFileSync(join(packageRoot, 'bootstrap.sql'), 'utf8'));
    sqlite.exec(`INSERT INTO tenants (id, name) VALUES ('tenant-a', '支社')`);
    sqlite.exec(
      `INSERT INTO line_accounts (id, channel_id, name, channel_access_token, channel_secret, tenant_id)
       VALUES ('acc-1', 'channel-acc-1', 'acc-1', 'token', 'secret', 'tenant-a')`,
    );
    db = asD1(sqlite);
  });

  it('作成時の所属アカウントを保存して読み直せる', async () => {
    const created = await createEntryRoute(db, {
      refCode: 'r39-summer',
      name: '夏の投稿',
      lineAccountId: 'acc-1',
    });
    expect(created.line_account_id).toBe('acc-1');

    const reread = sqlite
      .prepare('SELECT line_account_id FROM entry_routes WHERE id = ?')
      .get(created.id) as { line_account_id: string | null };
    expect(reread.line_account_id).toBe('acc-1');
  });

  it('指定なしは未割当のまま残す（古い行と同じ扱い）', async () => {
    const created = await createEntryRoute(db, { refCode: 'r39-free', name: '所属なし' });
    expect(created.line_account_id ?? null).toBeNull();
  });
});
