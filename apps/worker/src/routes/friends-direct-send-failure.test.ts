/*
 * N-028/N-029: 新規DM送信を N-023 の失敗契約へ接続する。
 * 実Hono route + 実SQLite(bootstrap.sql)へ当て、LINE clientだけを止める。
 */
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { Hono } from 'hono';
import { createTestD1, type SqliteD1 } from '../test-utils/d1-sqlite.js';
import type { Env } from '../index.js';
import type { AuthenticatedStaff } from '../middleware/auth.js';

const mocks = vi.hoisted(() => ({ pushMessage: vi.fn() }));
vi.mock('@line-crm/line-sdk', () => ({
  LineClient: vi.fn().mockImplementation(() => ({ pushMessage: mocks.pushMessage })),
}));

const { friends } = await import('./friends.js');

const owner: AuthenticatedStaff = {
  id: 'owner-1', name: 'オーナー', role: 'owner', readOnly: false, tenantId: 'tenant-1',
};

const KEY1 = '11111111-2222-4333-8444-555555555555';
const KEY2 = '22222222-2222-4333-8444-555555555555';
const KEY3 = '33333333-2222-4333-8444-555555555555';
const KEY4 = '44444444-2222-4333-8444-555555555555';

let sqlite: SqliteD1;

function app(staff: AuthenticatedStaff = owner, db: D1Database = sqlite.db) {
  const instance = new Hono<Env>();
  instance.use('*', async (c, next) => {
    c.env = { DB: db, LINE_CHANNEL_ACCESS_TOKEN: 'default-token' } as Env['Bindings'];
    c.set('staff', staff);
    await next();
  });
  instance.route('/', friends);
  return instance;
}

function send(friendId: string, key: string, db?: D1Database) {
  return app(owner, db).request(`/api/friends/${friendId}/messages`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Idempotency-Key': key },
    body: JSON.stringify({ messageType: 'text', content: 'こんにちは', trackLinks: false }),
  });
}

function row(key: string) {
  return sqlite.raw.prepare(
    `SELECT line_account_id, status, failure_code, attempt_count, retryable,
            next_retry_at, lease_token
       FROM outbound_send_requests WHERE idempotency_key = ?`,
  ).get(key) as {
    line_account_id: string;
    status: string;
    failure_code: string | null;
    attempt_count: number;
    retryable: number;
    next_retry_at: string | null;
    lease_token: string | null;
  };
}

function sentLogCount(key: string) {
  return sqlite.raw.prepare(
    `SELECT COUNT(*) AS n FROM messages_log WHERE id = ?`,
  ).get(key) as { n: number };
}

beforeEach(() => {
  vi.clearAllMocks();
  sqlite = createTestD1();
  sqlite.raw.prepare(`INSERT INTO tenants (id, name) VALUES ('tenant-1', '統括1')`).run();
  sqlite.raw.prepare(`
    INSERT INTO line_accounts
      (id, channel_id, name, channel_access_token, channel_secret, is_active, tenant_id)
    VALUES ('account-1', 'channel-1', '店舗1', 'token-1', 'secret-1', 1, 'tenant-1')
  `).run();
  sqlite.raw.prepare(`
    INSERT INTO staff_members (id, name, role, api_key, tenant_id, account_scope, permission_keys)
    VALUES ('owner-1', 'オーナー', 'owner', 'owner-key', 'tenant-1', 'all', '[]')
  `).run();
  sqlite.raw.prepare(`
    INSERT INTO friends (id, line_user_id, display_name, line_account_id)
    VALUES ('friend-1', 'U-1', '利用者1', 'account-1')
  `).run();
});

afterEach(() => sqlite.raw.close());

describe('N-028/N-029 新規DM送信の失敗契約', () => {
  test('429は再試行可能な失敗として記録し、同じkeyの再送はLINE・DBとも1回だけ増える', async () => {
    mocks.pushMessage
      .mockRejectedValueOnce(Object.assign(new Error('秘密を含む応答'), { status: 429, retryAfter: '0' }))
      .mockResolvedValueOnce({});

    const failed = await send('friend-1', KEY1);
    expect(failed.status).toBe(429);
    const body = await failed.json() as Record<string, unknown>;
    expect(body).toMatchObject({
      success: false,
      code: 'LINE_RATE_LIMITED',
      data: { retryable: true },
    });
    // 生の提供者エラー本文は応答にも台帳にも残さない
    expect(JSON.stringify(body)).not.toContain('秘密を含む応答');
    expect(row(KEY1)).toMatchObject({
      line_account_id: 'account-1', status: 'failed', failure_code: 'LINE_RATE_LIMITED',
      attempt_count: 1, retryable: 1, lease_token: null,
    });
    expect(sentLogCount(KEY1)).toEqual({ n: 0 });

    const retried = await send('friend-1', KEY1);
    expect(retried.status).toBe(200);
    expect(mocks.pushMessage).toHaveBeenCalledTimes(2);
    // 同じkeyの再送はログを1行だけ増やす（初回は0行、再送で1行）
    expect(sentLogCount(KEY1)).toEqual({ n: 1 });
    expect(row(KEY1)).toMatchObject({ status: 'succeeded', attempt_count: 2 });
  });

  test('応答喪失の可能性がある失敗はunknownで、自動再送しない', async () => {
    mocks.pushMessage.mockRejectedValueOnce(new TypeError('network response lost'));

    const first = await send('friend-1', KEY2);
    expect(first.status).toBe(503);
    await expect(first.json()).resolves.toMatchObject({
      code: 'LINE_DELIVERY_UNKNOWN', data: { retryable: false, nextRetryAt: null },
    });
    expect(row(KEY2)).toMatchObject({
      status: 'unknown', failure_code: 'LINE_DELIVERY_UNKNOWN', retryable: 0,
    });

    const second = await send('friend-1', KEY2);
    expect(second.status).toBe(409);
    await expect(second.json()).resolves.toMatchObject({
      code: 'LINE_DELIVERY_UNKNOWN', data: { retryable: false, nextRetryAt: null },
    });
    expect(mocks.pushMessage).toHaveBeenCalledTimes(1);
    expect(sentLogCount(KEY2)).toEqual({ n: 0 });
  });

  test('再試行不能な失敗は400で、同じkeyの再送は409で弾く', async () => {
    mocks.pushMessage.mockRejectedValueOnce(
      Object.assign(new Error('provider internal detail'), { status: 400 }),
    );

    const first = await send('friend-1', KEY3);
    expect(first.status).toBe(400);
    const body = await first.json() as Record<string, unknown>;
    expect(body).toMatchObject({
      code: 'LINE_REQUEST_REJECTED', data: { retryable: false, nextRetryAt: null },
    });
    expect(JSON.stringify(body)).not.toContain('provider internal detail');
    expect(row(KEY3)).toMatchObject({
      status: 'failed', failure_code: 'LINE_REQUEST_REJECTED', retryable: 0,
    });

    const second = await send('friend-1', KEY3);
    expect(second.status).toBe(409);
    await expect(second.json()).resolves.toMatchObject({
      code: 'LINE_REQUEST_REJECTED', data: { retryable: false },
    });
    expect(mocks.pushMessage).toHaveBeenCalledTimes(1);
  });

  test('LINE受理後にDB確定が失敗した行はunknownにし、二重送信しない', async () => {
    mocks.pushMessage.mockResolvedValue({});
    let failBatch = true;
    const db = {
      prepare: (sql: string) => sqlite.db.prepare(sql),
      batch: async (statements: D1PreparedStatement[]) => {
        if (failBatch) {
          failBatch = false;
          throw new Error('database unavailable');
        }
        return sqlite.db.batch(statements);
      },
    } as unknown as D1Database;

    const first = await send('friend-1', KEY4, db);
    expect(first.status).toBe(503);
    await expect(first.json()).resolves.toMatchObject({
      code: 'OUTBOUND_CONFIRMATION_FAILED', data: { retryable: false },
    });
    expect(row(KEY4)).toMatchObject({
      status: 'unknown', failure_code: 'OUTBOUND_CONFIRMATION_FAILED', retryable: 0,
    });

    const second = await send('friend-1', KEY4, db);
    expect(second.status).toBe(409);
    // pushは1回だけ。二度目はunknown行として弾かれ、LINEへ行かない。
    expect(mocks.pushMessage).toHaveBeenCalledTimes(1);
  });
});
