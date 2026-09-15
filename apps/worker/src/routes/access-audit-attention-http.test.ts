import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { Hono } from 'hono';
import { Miniflare } from 'miniflare';
import type { Env } from '../index.js';

const accountAccess = vi.hoisted(() => ({
  getVisibleLineAccountScope: vi.fn(async () => ({
    accounts: [{ id: 'account-a' }],
    allowedAccountIds: ['account-a'],
    canSeeUnassigned: false,
    ids: ['account-a'],
    isAccountScoped: true,
  })),
}));

vi.mock('../services/account-access.js', () => accountAccess);

const { access } = await import('./access.js');
type RealD1 = Awaited<ReturnType<Miniflare['getD1Database']>>;

let mf: Miniflare;
let db: RealD1;

function appFor(targetDb: D1Database = db as unknown as D1Database) {
  const app = new Hono<Env>();
  app.use('*', async (c, next) => {
    c.set('staff', {
      id: 'owner-1',
      name: '管理者',
      role: 'owner',
      readOnly: false,
      tenantId: 'tenant-a',
      assignedLineAccountId: null,
      canAccessDescendantAccounts: false,
    });
    return next();
  });
  app.route('/', access);
  return { app, env: { DB: targetDb } as Env['Bindings'] };
}

async function request(path: string, targetDb?: D1Database) {
  const { app, env } = appFor(targetDb);
  return app.request(path, undefined, env);
}

async function insertEvent(input: {
  id: string;
  accountId: string;
  result: 'success' | 'failed';
  riskLevel: 'normal' | 'suspicious';
  createdAt: string;
}) {
  await db.prepare(
    `INSERT INTO audit_events
      (id, tenant_id, line_account_id, category, action, result, risk_level, retention_class, created_at)
     VALUES (?, 'tenant-a', ?, 'auth', 'auth.login', ?, ?, 'security', ?)`,
  ).bind(input.id, input.accountId, input.result, input.riskLevel, input.createdAt).run();
}

beforeAll(async () => {
  mf = new Miniflare({
    modules: true,
    script: 'export default { fetch() { return new Response("ok") } }',
    d1Databases: ['DB'],
  });
  db = await mf.getD1Database('DB');
  await db.exec('CREATE TABLE staff_members (id TEXT PRIMARY KEY, name TEXT NOT NULL)');
  await db.exec('CREATE TABLE staff_account_scopes (staff_id TEXT NOT NULL, line_account_id TEXT NOT NULL)');
  await db.prepare(`
    CREATE TABLE audit_events (
      id TEXT PRIMARY KEY,
      source_kind TEXT,
      source_id TEXT,
      tenant_id TEXT NOT NULL,
      line_account_id TEXT,
      category TEXT NOT NULL,
      actor_principal_id TEXT,
      actor_role TEXT,
      action TEXT NOT NULL,
      target_kind TEXT,
      target_id TEXT,
      result TEXT NOT NULL,
      before_json TEXT,
      after_json TEXT,
      reason TEXT,
      request_trace_id TEXT,
      ip_prefix TEXT,
      device_family TEXT,
      risk_level TEXT NOT NULL,
      retention_class TEXT NOT NULL,
      created_at TEXT NOT NULL
    )
  `).run();
});

afterAll(async () => { await mf?.dispose(); });

beforeEach(async () => {
  accountAccess.getVisibleLineAccountScope.mockClear();
  await db.prepare('DELETE FROM audit_events').run();
  await insertEvent({
    id: 'account-b-failed', accountId: 'account-b', result: 'failed', riskLevel: 'normal',
    createdAt: '2026-09-15T04:00:00.000Z',
  });
  await insertEvent({
    id: 'normal-success', accountId: 'account-a', result: 'success', riskLevel: 'normal',
    createdAt: '2026-09-15T03:00:00.000Z',
  });
  await insertEvent({
    id: 'failed', accountId: 'account-a', result: 'failed', riskLevel: 'normal',
    createdAt: '2026-09-15T02:00:00.000Z',
  });
  await insertEvent({
    id: 'suspicious-success', accountId: 'account-a', result: 'success', riskLevel: 'suspicious',
    createdAt: '2026-09-15T01:00:00.000Z',
  });
});

describe('GET /api/audit/events attention filter', () => {
  it('pages and counts the failed OR suspicious union in the database', async () => {
    const first = await request('/api/audit/events?lineAccountId=account-a&attention=true&limit=1&offset=0');
    const second = await request('/api/audit/events?lineAccountId=account-a&attention=true&limit=1&offset=1');

    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    await expect(first.json()).resolves.toMatchObject({
      success: true,
      data: { items: [{ id: 'failed' }], pagination: { total: 2, limit: 1, offset: 0 } },
    });
    await expect(second.json()).resolves.toMatchObject({
      success: true,
      data: { items: [{ id: 'suspicious-success' }], pagination: { total: 2, limit: 1, offset: 1 } },
    });
  });

  it('never mixes another account into the attention result', async () => {
    const response = await request('/api/audit/events?attention=true&limit=20');
    const body = await response.json() as { data: { items: Array<{ id: string }>; pagination: { total: number } } };

    expect(response.status).toBe(200);
    expect(body.data.items.map((item) => item.id)).toEqual(['failed', 'suspicious-success']);
    expect(body.data.pagination.total).toBe(2);
  });

  it('returns a safe failure instead of normal or empty data when retrieval fails', async () => {
    const brokenDb = {
      prepare: () => { throw new Error('raw database detail customer@example.com'); },
    } as unknown as D1Database;
    const response = await request('/api/audit/events?attention=true', brokenDb);

    expect(response.status).toBe(500);
    const text = await response.text();
    expect(text).toContain('操作記録を取得できませんでした');
    expect(text).not.toContain('customer@example.com');
  });
});
