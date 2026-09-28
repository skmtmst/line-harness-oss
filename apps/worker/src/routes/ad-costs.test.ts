import { describe, expect, it, vi } from 'vitest';
import { Hono } from 'hono';
import type { Env } from '../index.js';
import type { AuthenticatedStaff } from '../middleware/auth.js';
import { createTestD1, type SqliteD1 } from '../test-utils/d1-sqlite.js';
import { adCosts } from './ad-costs.js';

const NOW = '2026-09-21T00:00:00+09:00';

function staff(id: string, tenantId: string, role: AuthenticatedStaff['role'] = 'owner'): AuthenticatedStaff {
  return { id, name: id, role, readOnly: false, tenantId };
}

function app(current: AuthenticatedStaff) {
  const instance = new Hono<Env>();
  instance.use('*', async (c, next) => {
    c.set('staff', current);
    await next();
  });
  instance.route('/', adCosts);
  return instance;
}

function seed(testDb: SqliteD1): void {
  testDb.raw.prepare(`INSERT INTO tenants (id, name) VALUES ('tenant-1', '統括1'), ('tenant-2', '統括2')`).run();
  for (const [id, tenant] of [['a1', 'tenant-1'], ['b1', 'tenant-2']] as const) {
    testDb.raw.prepare(
      `INSERT INTO line_accounts (id, channel_id, name, channel_access_token, channel_secret, is_active, tenant_id)
       VALUES (?, ?, ?, 'token', 'secret', 1, ?)`,
    ).run(id, `channel-${id}`, id, tenant);
  }
  testDb.raw.prepare(
    `INSERT INTO ad_platforms (id, name, display_name, config, is_active, line_account_id, created_at, updated_at)
     VALUES ('p1', 'meta', 'Meta広告', '{}', 1, 'a1', ?, ?),
            ('pb', 'meta', 'Meta広告(別)', '{}', 1, 'b1', ?, ?)`,
  ).run(NOW, NOW, NOW, NOW);
  testDb.raw.prepare(
    `INSERT INTO staff_members (id, name, role, api_key, tenant_id, account_scope)
     VALUES ('owner-1', 'owner-1', 'owner', 'key-1', 'tenant-1', 'all'),
            ('staff-1', 'staff-1', 'staff', 'key-2', 'tenant-1', 'all'),
            ('owner-2', 'owner-2', 'owner', 'key-3', 'tenant-2', 'all')`,
  ).run();
}

async function req(
  handler: Hono<Env>,
  db: SqliteD1,
  path: string,
  init?: RequestInit,
): Promise<Response> {
  return handler.fetch(
    new Request(`https://example.com${path}`, init),
    { DB: db.db } as unknown as Env['Bindings'],
  );
}

describe('GET /api/ad-costs', () => {
  it('流入元ごとの費用と媒体の取込状況を返す', async () => {
    const testDb = createTestD1();
    seed(testDb);
    testDb.raw.prepare(
      `INSERT INTO ad_cost_entries
         (id, line_account_id, ad_platform_id, entry_route_id, source_label, day,
          amount_minor, currency, source, imported_at, created_at, updated_at)
       VALUES ('e1', 'a1', 'p1', NULL, 'Meta広告', '2026-09-20', 3000, 'JPY', 'import', ?, ?, ?),
              ('e2', 'a1', NULL, NULL, 'チラシ', '2026-09-20', 8000, 'JPY', 'manual', NULL, ?, ?),
              ('eb', 'b1', 'pb', NULL, 'Meta広告', '2026-09-20', 99999, 'JPY', 'import', ?, ?, ?)`,
    ).run(NOW, NOW, NOW, NOW, NOW, NOW, NOW, NOW);
    testDb.raw.prepare(
      `INSERT INTO ad_cost_import_runs (id, ad_platform_id, day, status, error_message, created_at)
       VALUES ('r1', 'p1', '2026-09-20', 'success', NULL, ?)`,
    ).run(NOW);

    const res = await req(app(staff('owner-1', 'tenant-1')), testDb, '/api/ad-costs?accountId=a1');
    expect(res.status).toBe(200);
    const body = await res.json() as {
      data: {
        rows: Array<{ sourceLabel: string; source: string; totals: unknown[] }>;
        platforms: Array<{ id: string; lastRunStatus: string | null }>;
      };
    };
    // 別アカウント b1 の費用・媒体は混ざらない
    expect(body.data.rows.map((row) => row.sourceLabel).sort()).toEqual(['Meta広告', 'チラシ']);
    expect(body.data.platforms.map((p) => p.id)).toEqual(['p1']);
    expect(body.data.platforms[0].lastRunStatus).toBe('success');
  });

  it('期間の形が違えば 400', async () => {
    const testDb = createTestD1();
    seed(testDb);
    const res = await req(
      app(staff('owner-1', 'tenant-1')),
      testDb,
      '/api/ad-costs?accountId=a1&from=not-a-date',
    );
    expect(res.status).toBe(400);
  });

  it('別統括のアカウントは見えない', async () => {
    const testDb = createTestD1();
    seed(testDb);
    const res = await req(app(staff('owner-2', 'tenant-2')), testDb, '/api/ad-costs?accountId=a1');
    expect(res.status).toBe(404);
  });
});

describe('POST /api/ad-costs', () => {
  it('手入力の費用を manual として記録する', async () => {
    const testDb = createTestD1();
    seed(testDb);
    const res = await req(app(staff('owner-1', 'tenant-1')), testDb, '/api/ad-costs', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        lineAccountId: 'a1',
        sourceLabel: '駅前の看板',
        day: '2026-09-20',
        amountMinor: 15000,
        currency: 'jpy',
      }),
    });
    expect(res.status).toBe(201);
    const body = await res.json() as { data: { source: string; currency: string; amount_minor: number } };
    expect(body.data.source).toBe('manual');
    expect(body.data.currency).toBe('JPY');
    expect(body.data.amount_minor).toBe(15000);
    const stored = testDb.raw
      .prepare(`SELECT source, created_by FROM ad_cost_entries WHERE line_account_id = 'a1'`)
      .get() as { source: string; created_by: string };
    expect(stored.source).toBe('manual');
    expect(stored.created_by).toBe('owner-1');
  });

  it('負の費用・変な日付・変な通貨は受け付けない', async () => {
    const testDb = createTestD1();
    seed(testDb);
    const post = (body: Record<string, unknown>) =>
      req(app(staff('owner-1', 'tenant-1')), testDb, '/api/ad-costs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ lineAccountId: 'a1', sourceLabel: 'x', day: '2026-09-20', amountMinor: 100, ...body }),
      });
    expect((await post({ amountMinor: -1 })).status).toBe(400);
    expect((await post({ amountMinor: 1.5 })).status).toBe(400);
    expect((await post({ amountMinor: '' })).status).toBe(400);
    expect((await post({ amountMinor: '   ' })).status).toBe(400);
    expect((await post({ amountMinor: 0 })).status).toBe(201);
    expect((await post({ day: '09/20' })).status).toBe(400);
    expect((await post({ currency: 'YENX' })).status).toBe(400);
    expect((await post({ sourceLabel: '' })).status).toBe(400);
  });

  it('係員は書けない', async () => {
    const testDb = createTestD1();
    seed(testDb);
    const res = await req(app(staff('staff-1', 'tenant-1', 'staff')), testDb, '/api/ad-costs', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        lineAccountId: 'a1', sourceLabel: 'x', day: '2026-09-20', amountMinor: 100,
      }),
    });
    expect(res.status).toBe(403);
  });
});

describe('POST /api/ad-platforms/:id/cost-import', () => {
  it('係員は取り直せない', async () => {
    const testDb = createTestD1();
    seed(testDb);
    const res = await req(
      app(staff('staff-1', 'tenant-1', 'staff')),
      testDb,
      '/api/ad-platforms/p1/cost-import',
      { method: 'POST' },
    );
    expect(res.status).toBe(403);
  });

  it('別統括の連携は取り直せない', async () => {
    const testDb = createTestD1();
    seed(testDb);
    const res = await req(
      app(staff('owner-2', 'tenant-2')),
      testDb,
      '/api/ad-platforms/p1/cost-import',
      { method: 'POST' },
    );
    expect(res.status).toBe(404);
  });
});
