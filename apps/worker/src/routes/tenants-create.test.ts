import { beforeEach, describe, expect, it } from 'vitest';
import { Hono } from 'hono';
import type { Env } from '../index.js';
import { DEFAULT_TENANT_ID } from '../lib/tenant.js';
import type { AuthenticatedStaff } from '../middleware/auth.js';
import { createTestD1, type SqliteD1 } from '../test-utils/d1-sqlite.js';
import { tenants } from './tenants.js';

let testDb: SqliteD1;

const operator = (overrides: Partial<AuthenticatedStaff> = {}): AuthenticatedStaff => ({
  id: 'operator-1',
  name: '運営担当',
  role: 'owner',
  readOnly: false,
  tenantId: DEFAULT_TENANT_ID,
  ...overrides,
});

function app(staff: AuthenticatedStaff) {
  const instance = new Hono<Env>();
  instance.use('*', async (c, next) => {
    c.set('staff', staff);
    return next();
  });
  instance.route('/', tenants);
  return instance;
}

function environment(): Env['Bindings'] {
  return { DB: testDb.db } as Env['Bindings'];
}

async function request(
  path: string,
  body: unknown,
  staff: AuthenticatedStaff = operator(),
) {
  return app(staff).request(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  }, environment());
}

async function patchStatus(id: string, status: unknown, staff = operator()) {
  return app(staff).request(`/api/tenants/${id}/status`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ status }),
  }, environment());
}

beforeEach(() => {
  testDb = createTestD1();

  // D1 batch is atomic. The shared SQLite adapter predates batch users and
  // executes sequentially, so make its test behavior match D1's contract.
  testDb.db.batch = async <T = unknown>(statements: D1PreparedStatement[]) => {
    testDb.raw.exec('BEGIN');
    try {
      const results: D1Result<T>[] = [];
      for (const statement of statements) results.push(await statement.run<T>());
      testDb.raw.exec('COMMIT');
      return results;
    } catch (error) {
      testDb.raw.exec('ROLLBACK');
      throw error;
    }
  };
});

describe('tenant creation and feature packs', () => {
  it.each([
    [{ name: '新しい統括' }, '[]'],
    [{ name: '飲食店の統括', featurePacks: ['restaurant'] }, '["restaurant"]'],
  ])('統括を作成する', async (body, expectedPacks) => {
    const response = await request('/api/tenants', body);
    expect(response.status).toBe(201);
    const result = await response.json<{
      data: { id: string; name: string; status: string; featurePacks: string[] };
    }>();

    expect(testDb.raw.prepare(
      'SELECT name, status, feature_packs FROM tenants WHERE id = ?',
    ).get(result.data.id)).toEqual({
      name: body.name,
      status: 'active',
      feature_packs: expectedPacks,
    });
    expect(testDb.raw.prepare(
      'SELECT COUNT(*) AS count FROM staff_members WHERE tenant_id = ?',
    ).get(result.data.id)).toEqual({ count: 0 });
  });

  it('同じ名前の2回目をINSERT前に400で拒否する', async () => {
    expect((await request('/api/tenants', { name: '重複する統括' })).status).toBe(201);
    expect((await request('/api/tenants', { name: '重複する統括' })).status).toBe(400);
    expect(testDb.raw.prepare(
      'SELECT COUNT(*) AS count FROM tenants WHERE name = ?',
    ).get('重複する統括')).toEqual({ count: 1 });
  });

  it.each(['', ' ', 'あ'.repeat(101)])('不正なnameを400で拒否する', async (name) => {
    expect((await request('/api/tenants', { name })).status).toBe(400);
  });

  it('未知の機能パックを値の露出なしで400にする', async () => {
    const response = await request('/api/tenants', { name: '対象統括', featurePacks: ['ec'] });
    expect(response.status).toBe(400);
    expect(await response.text()).not.toContain('ec');
  });

  it.each([
    operator({ tenantId: 'another-tenant' }),
    operator({ role: 'admin' }),
    operator({ readOnly: true }),
  ])('既定統括の書き込み可能owner以外を403にする', async (staff) => {
    expect((await request('/api/tenants', { name: '拒否対象' }, staff)).status).toBe(403);
  });

  it('機能パックを許可リストの値だけに変更する', async () => {
    const created = await request('/api/tenants', { name: 'パック変更対象' });
    const { data } = await created.json<{ data: { id: string } }>();
    const response = await app(operator()).request(`/api/tenants/${data.id}/feature-packs`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ featurePacks: ['restaurant'] }),
    }, environment());
    expect(response.status).toBe(200);
    expect(testDb.raw.prepare('SELECT feature_packs FROM tenants WHERE id = ?').get(data.id))
      .toEqual({ feature_packs: '["restaurant"]' });
  });
});

describe('tenant status', () => {
  it.each(['active', 'suspended', 'archived'])('%sへ変更すると200を返す', async (status) => {
    const response = await patchStatus(DEFAULT_TENANT_ID, status);
    expect(response.status).toBe(200);
    expect(testDb.raw.prepare('SELECT status FROM tenants WHERE id = ?').get(DEFAULT_TENANT_ID))
      .toEqual({ status });
  });

  it.each(['deleted', 'unknown', '', null])('不正な状態 %s を400で拒否する', async (status) => {
    expect((await patchStatus(DEFAULT_TENANT_ID, status)).status).toBe(400);
  });

  it.each([
    operator({ tenantId: 'another-tenant' }),
    operator({ role: 'admin' }),
    operator({ readOnly: true }),
  ])('管理権限のない利用者を403にする', async (staff) => {
    expect((await patchStatus(DEFAULT_TENANT_ID, 'archived', staff)).status).toBe(403);
  });
});

describe('tenant list', () => {
  it('archivedを通常は除外し、include_archived=1なら含める', async () => {
    testDb.raw.prepare(
      "INSERT INTO tenants (id, name, status) VALUES ('archived-tenant', '保管済み', 'archived')",
    ).run();
    const normal = await app(operator()).request('/api/tenants', {}, environment());
    const included = await app(operator()).request(
      '/api/tenants?include_archived=1', {}, environment(),
    );
    expect(normal.status).toBe(200);
    expect(included.status).toBe(200);
    const normalBody = await normal.json<{ data: Array<{ id: string }> }>();
    const includedBody = await included.json<{ data: Array<{ id: string }> }>();
    expect(normalBody.data.map(({ id }) => id)).not.toContain('archived-tenant');
    expect(includedBody.data.map(({ id }) => id)).toContain('archived-tenant');
  });
});
