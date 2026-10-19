import { beforeEach, describe, expect, it } from 'vitest';
import Database from 'better-sqlite3';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createEntryRoute, updateEntryRoute } from '../src/entry-routes.js';

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

// M (476): 受付停止はいつ・なぜ止めたかを残す。QRダイアログの停止表示が読む。
describe('entry route stopped', () => {
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

  it('作った直後は停止の記録なし', async () => {
    const created = await createEntryRoute(db, {
      refCode: 'm-stop-new', name: '新しい経路', lineAccountId: 'acc-1',
    });
    expect(created.stopped_at).toBeNull();
    expect(created.stopped_reason).toBeNull();
  });

  it('受付停止で時刻と理由が残る', async () => {
    const created = await createEntryRoute(db, {
      refCode: 'm-stop-target', name: '止める経路', lineAccountId: 'acc-1',
    });
    const stopped = await updateEntryRoute(db, created.id, {
      isActive: false, stoppedReason: 'チラシの配布が終わった',
    });
    expect(stopped?.is_active).toBe(0);
    expect(stopped?.stopped_at).toBeTruthy();
    expect(stopped?.stopped_reason).toBe('チラシの配布が終わった');
  });

  it('受付再開で停止の記録が消える', async () => {
    const created = await createEntryRoute(db, {
      refCode: 'm-stop-reopen', name: '再開する経路', lineAccountId: 'acc-1',
    });
    await updateEntryRoute(db, created.id, { isActive: false, stoppedReason: '一時休止' });
    const reopened = await updateEntryRoute(db, created.id, { isActive: true });
    expect(reopened?.is_active).toBe(1);
    expect(reopened?.stopped_at).toBeNull();
    expect(reopened?.stopped_reason).toBeNull();
  });

  it('名前だけの変更では停止の記録に触らない', async () => {
    const created = await createEntryRoute(db, {
      refCode: 'm-stop-rename', name: '名前を変える経路', lineAccountId: 'acc-1',
    });
    await updateEntryRoute(db, created.id, { isActive: false, stoppedReason: '理由あり' });
    const renamed = await updateEntryRoute(db, created.id, { name: '新しい名前' });
    expect(renamed?.is_active).toBe(0);
    expect(renamed?.stopped_reason).toBe('理由あり');
  });
});
