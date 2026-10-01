import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Hono } from 'hono';
import type { Env } from '../index.js';
import { DEFAULT_TENANT_ID } from '../lib/tenant.js';
import type { AuthenticatedStaff } from '../middleware/auth.js';
import { createTestD1, type SqliteD1 } from '../test-utils/d1-sqlite.js';

/**
 * M506: コラムの「同じ形で書く」を二重に押しても複製は1本。
 *
 * 複製に要求キー（`Idempotency-Key`）を付け、同じキーなら同じ複製へ戻す。
 * 実ルート（nen-campaigns.ts）＋実DB（createTestD1）で確かめる。
 */

const access = vi.hoisted(() => ({ canAccess: vi.fn(async () => true) }));
vi.mock('../services/account-access.js', () => ({ canAccessAllLineAccounts: access.canAccess }));

const { nenCampaigns } = await import('./nen-campaigns.js');

const ACCOUNT = 'account-m506';
const SOURCE = 'column-src';
const KEY = '33333333-3333-4333-8333-333333333333';

let testDb: SqliteD1;

const owner = (): AuthenticatedStaff => ({
  id: 'owner-1',
  name: '統括',
  role: 'owner',
  readOnly: false,
  tenantId: DEFAULT_TENANT_ID,
});

function app() {
  const instance = new Hono<Env>();
  instance.use('*', async (c, next) => {
    c.set('staff', owner());
    return next();
  });
  instance.route('/', nenCampaigns);
  return instance;
}

async function duplicate(sourceId: string, key?: string) {
  return app().request(`/api/nen-campaigns/columns/${sourceId}/duplicate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(key ? { 'Idempotency-Key': key } : {}) },
    body: JSON.stringify({ accountId: ACCOUNT }),
  }, { DB: testDb.db } as Env['Bindings']);
}

function duplicateCount() {
  return (testDb.raw.prepare(
    `SELECT COUNT(*) AS n FROM nen_columns WHERE source_column_id = ?`,
  ).get(SOURCE) as { n: number }).n;
}

beforeEach(() => {
  testDb = createTestD1();
  testDb.raw.prepare(
    `INSERT INTO line_accounts (id, channel_id, name, channel_access_token, channel_secret, tenant_id)
     VALUES (?, ?, ?, 'token', 'secret', ?)`,
  ).run(ACCOUNT, 'channel-m506', 'M506店', DEFAULT_TENANT_ID);
  testDb.raw.prepare(
    `INSERT INTO nen_columns (id, slug, title, excerpt, article_url, line_account_id, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, '2026-09-01T00:00:00.000Z', '2026-09-01T00:00:00.000Z')`,
  ).run(SOURCE, 'src-column', '元の下書き', '抜粋', 'https://example.com/src', ACCOUNT);
});

describe('POST /api/nen-campaigns/columns/:id/duplicate — 二重押しで1本（M506）', () => {
  it('同じキーの同時2実行でも複製は1本に収まる', async () => {
    const [first, second] = await Promise.all([duplicate(SOURCE, KEY), duplicate(SOURCE, KEY)]);
    expect(first.status).toBe(201);
    expect(second.status).toBe(200);
    const firstJson = await first.json() as { data: { id: string } };
    const secondJson = await second.json() as { data: { id: string }; replayed?: boolean };
    expect(secondJson.data.id).toBe(firstJson.data.id);
    expect(secondJson.replayed).toBe(true);
    expect(duplicateCount()).toBe(1);
  });

  it('応答消失後の再送（同じキー）は同じ複製を返す', async () => {
    const first = await duplicate(SOURCE, KEY);
    expect(first.status).toBe(201);
    const firstJson = await first.json() as { data: { id: string } };
    const retry = await duplicate(SOURCE, KEY);
    expect(retry.status).toBe(200);
    const retryJson = await retry.json() as { data: { id: string } };
    expect(retryJson.data.id).toBe(firstJson.data.id);
    expect(duplicateCount()).toBe(1);
  });

  it('同じキーで別の元コラムは409で止める', async () => {
    testDb.raw.prepare(
      `INSERT INTO nen_columns (id, slug, title, excerpt, article_url, line_account_id, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, '2026-09-01T00:00:00.000Z', '2026-09-01T00:00:00.000Z')`,
    ).run('column-other', 'other-column', '別の下書き', '抜粋', 'https://example.com/other', ACCOUNT);
    expect((await duplicate(SOURCE, KEY)).status).toBe(201);
    const res = await duplicate('column-other', KEY);
    expect(res.status).toBe(409);
    expect(duplicateCount()).toBe(1);
  });

  it('キーになっていない値は400で止める', async () => {
    expect((await duplicate(SOURCE, 'not-a-uuid')).status).toBe(400);
    expect(duplicateCount()).toBe(0);
  });

  it('【対比】キーが無い従来の呼び出しは二重押しで2本できる', async () => {
    expect((await duplicate(SOURCE)).status).toBe(201);
    expect((await duplicate(SOURCE)).status).toBe(201);
    expect(duplicateCount()).toBe(2);
  });
});
