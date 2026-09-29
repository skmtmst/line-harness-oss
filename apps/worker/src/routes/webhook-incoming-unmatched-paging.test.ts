/*
 * R401: 未照合51件を50件ずつ辿れる。先頭50件の処理後も残りが出て、
 * 未確認1件と「確認が必要な届物はありません」が矛盾しない。
 *
 * 落ち方（直前）: 一覧は既定50件で offset/limit を無視し、総数も返さない。
 * 通り方（直後）: limit/offset が効き、total を返す。処理後の再取得で残りが出る。
 *
 * 実ルーター（webhooks）と実 SQLite を叩く。認証は通った状態にして
 * 本体だけ見る（権限そのものは role-guard の試験が持つ）。
 */
import { describe, expect, it } from 'vitest';
import { Hono } from 'hono';
import type { Env } from '../index.js';
import type { AuthenticatedStaff } from '../middleware/auth.js';
import { webhooks } from './webhooks.js';

import { createTestD1, type SqliteD1 } from '../test-utils/d1-sqlite.js';

const ACCOUNT = 'account-1';
const TENANT = 'tenant-1';

const STAFF: AuthenticatedStaff = {
  id: 'staff-1',
  name: '統括',
  role: 'owner',
  readOnly: false,
  tenantId: TENANT,
} as AuthenticatedStaff;

function routeApp() {
  const instance = new Hono<Env>();
  instance.use('*', async (c, next) => {
    c.set('staff', STAFF);
    await next();
  });
  instance.route('/', webhooks);
  return instance;
}

function seed(db: SqliteD1): void {
  db.raw.prepare(`INSERT INTO tenants (id, name) VALUES ('${TENANT}', '統括1')`).run();
  db.raw.prepare(`
    INSERT INTO line_accounts
      (id, channel_id, name, channel_access_token, channel_secret, is_active, tenant_id)
    VALUES ('${ACCOUNT}', 'ch-1', '店舗1', 'token-1', 'secret-1', 1, '${TENANT}')
  `).run();
  db.raw.prepare(`
    INSERT INTO incoming_webhooks (id, name, source_type, line_account_id, is_active)
    VALUES ('iwh-1', '外部連携1', 'custom', '${ACCOUNT}', 1)
  `).run();
  const insert = db.raw.prepare(`
    INSERT INTO incoming_webhook_unmatched_events
      (id, webhook_id, line_account_id, source_event_id, kind, status, received_at)
    VALUES (?, 'iwh-1', '${ACCOUNT}', ?, 'unmatched', 'pending', ?)
  `);
  for (let index = 0; index < 51; index += 1) {
    const receivedAt = `2026-09-28T10:${String(index).padStart(2, '0')}:00.000+09:00`;
    insert.run(`u-${index}`, `event-${index}`, receivedAt);
  }
}

describe('R401 未照合の一覧は50件超えを辿れる', () => {
  const list = (db: SqliteD1, env: never, query = '') => routeApp().request(
    `/api/webhooks/incoming/iwh-1/unmatched?lineAccountId=${ACCOUNT}${query}`,
    { method: 'GET' },
    env,
  );

  it('既定50件・総数51件を返し、offset=50で残り1件が出る', async () => {
    const db = createTestD1();
    seed(db);
    const env = { DB: db.db } as never;

    const first = await list(db, env);
    expect(first.status).toBe(200);
    const firstBody = await first.json() as { success: boolean; total: number; data: unknown[] };
    expect(firstBody.success).toBe(true);
    expect(firstBody.total).toBe(51);
    expect(firstBody.data).toHaveLength(50);

    const rest = await list(db, env, '&limit=50&offset=50');
    expect(rest.status).toBe(200);
    const restBody = await rest.json() as { success: boolean; total: number; data: Array<{ id: string }> };
    expect(restBody.total).toBe(51);
    expect(restBody.data).toHaveLength(1);
  });

  it('50件の処理後に再取得すると残り1件が出て、空表示と矛盾しない', async () => {
    const db = createTestD1();
    seed(db);
    const env = { DB: db.db } as never;
    const app = routeApp();

    for (let index = 0; index < 50; index += 1) {
      const resolve = await app.request(
        `/api/webhooks/unmatched/u-${index}/resolve?lineAccountId=${ACCOUNT}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'dismiss' }),
        },
        env,
      );
      expect(resolve.status).toBe(200);
    }
    const after = await list(db, env);
    const afterBody = await after.json() as { success: boolean; total: number; data: unknown[] };
    expect(afterBody.total).toBe(1);
    expect(afterBody.data).toHaveLength(1);
  });
});
