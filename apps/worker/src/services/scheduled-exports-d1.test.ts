import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { createTestD1, type SqliteD1 } from '../test-utils/d1-sqlite.js';
import type { Env } from '../worker-env.js';

vi.mock('@line-crm/db', async original => ({
  ...await original<typeof import('@line-crm/db')>(),
  getLineAccounts: async () => [{ id: 'daily-shop', is_active: 1 }],
}));
import { processDueScheduledExports } from './scheduled-exports.js';

let fixture: SqliteD1;
beforeEach(() => {
  fixture = createTestD1();
  fixture.raw.exec("INSERT INTO line_accounts(id,name,channel_id,channel_secret,channel_access_token) VALUES('daily-shop','店','daily-channel','unused','unused')");
});
afterEach(() => fixture.raw.close());
const run = (now: string) => processDueScheduledExports({ DB: fixture.db } as Env['Bindings'], { now });

test('JST深夜の繰返しと並行実行でも1日1履歴、翌日は新しい履歴になる', async () => {
  await Promise.all([run('2026-10-21T15:01:00Z'), run('2026-10-21T15:01:00Z')]);
  expect(await run('2026-10-21T15:06:00Z')).toMatchObject({ generated: 0, skipped: 1 });
  expect(await run('2026-10-22T00:01:00Z')).toMatchObject({ generated: 0, skipped: 1 });
  expect(fixture.raw.prepare('SELECT count(*) n FROM friend_export_jobs').get()).toEqual({ n: 1 });
  expect(await run('2026-10-22T15:01:00Z')).toMatchObject({ generated: 1, skipped: 0 });
  expect(fixture.raw.prepare('SELECT count(*) n FROM friend_export_jobs').get()).toEqual({ n: 2 });
});

test('旧UUIDの同日履歴もJSTで見つけ、新しい安定IDを重ねない', async () => {
  fixture.raw.exec(`INSERT INTO friend_export_jobs
    (id,line_account_id,filter_json,columns_json,encoding,status,row_count,created_by,created_by_name,created_at,expires_at)
    VALUES('legacy-random','daily-shop','{}','["basic"]','utf-8','completed',0,'system','定期実行','2026-10-21T16:00:00Z','2026-10-28T16:00:00Z')`);
  expect(await run('2026-10-21T16:05:00Z')).toMatchObject({ generated: 0, skipped: 1 });
  expect(fixture.raw.prepare('SELECT count(*) n FROM friend_export_jobs').get()).toEqual({ n: 1 });
});
