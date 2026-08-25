import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Hono } from 'hono';
import { DEFAULT_TENANT_ID } from '@line-crm/shared';
import type { Env } from '../index.js';
import type { AuthenticatedStaff } from './auth.js';
import { createTestD1, type SqliteD1 } from '../test-utils/d1-sqlite.js';
import { ACCOUNT_QUERY_KEYS, tenantScopeMiddleware } from './tenant-scope.js';

let testDb: SqliteD1;
let warn: ReturnType<typeof vi.spyOn>;

const defaultStaff: AuthenticatedStaff = {
  id: 'staff-default',
  name: '既定統括スタッフ',
  role: 'admin',
  readOnly: false,
  tenantId: DEFAULT_TENANT_ID,
};

function app(staff?: AuthenticatedStaff) {
  const instance = new Hono<Env>();
  if (staff) {
    instance.use('*', async (c, next) => {
      c.set('staff', staff);
      return next();
    });
  }
  instance.use('*', tenantScopeMiddleware);
  instance.all('*', (c) => c.json({ success: true }));
  return instance;
}

function environment(): Env['Bindings'] {
  return { DB: testDb.db } as Env['Bindings'];
}

function insertAccount(id: string, tenantId: string | null): void {
  testDb.raw.prepare(`INSERT INTO line_accounts
    (id, channel_id, name, channel_access_token, channel_secret, tenant_id)
    VALUES (?, ?, ?, ?, ?, ?)`).run(
      id, `channel-${id}`, id, `token-${id}`, `secret-${id}`, tenantId,
    );
}

const ACCOUNT_QUERY_KEY_PATTERN = /^(?:account|account_?id|line_?account_?id)$/i;

function uncoveredAccountQueryKeys(
  sources: string[],
  allowedKeys: readonly string[],
): string[] {
  const usedKeys = sources.flatMap((source) =>
    [...source.matchAll(/c\.req\.query\(['"]([^'"]+)['"]\)/g)].map((match) => match[1]),
  );
  return [...new Set(usedKeys)]
    .filter((key) => ACCOUNT_QUERY_KEY_PATTERN.test(key))
    .filter((key) => !allowedKeys.includes(key))
    .sort();
}

beforeEach(() => {
  warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  testDb = createTestD1();
  insertAccount('default-1', DEFAULT_TENANT_ID);
  insertAccount('default-2', DEFAULT_TENANT_ID);
  insertAccount('default-3', DEFAULT_TENANT_ID);
  insertAccount('tenant-b-account', 'tenant-B');
});

afterEach(() => {
  warn.mockRestore();
});

describe('tenantScopeMiddleware', () => {
  it.each(ACCOUNT_QUERY_KEYS)(
    '%sで別統括のアカウントを指定すると403にする',
    async (key) => {
      const response = await app(defaultStaff).request(
        `/api/friends?${key}=tenant-b-account`,
        {},
        environment(),
      );
      expect(response.status).toBe(403);
      await expect(response.json()).resolves.toEqual({
        success: false,
        error: 'このLINEアカウントを操作する権限がありません',
      });
    },
  );

  it('accountIdで同じ統括のアカウントを指定した場合は通す', async () => {
    const response = await app(defaultStaff).request(
      '/api/friends?accountId=default-2',
      {},
      environment(),
    );
    expect(response.status).toBe(200);
  });

  it('ルートで使うアカウントIDらしいクエリ名をすべて検査対象にする', () => {
    const routesDirectory = fileURLToPath(new URL('../routes', import.meta.url));
    const routeSources = readdirSync(routesDirectory)
      .filter((name) => name.endsWith('.ts'))
      .map((name) => readFileSync(join(routesDirectory, name), 'utf8'));

    expect(uncoveredAccountQueryKeys(routeSources, ACCOUNT_QUERY_KEYS)).toEqual([]);
  });

  it('新しいアカウントIDのクエリ名を一覧へ足し忘れた場合は検出する', () => {
    const sourceWithUnlistedKey = "const id = c.req.query('accountID');";

    expect(uncoveredAccountQueryKeys([sourceWithUnlistedKey], ACCOUNT_QUERY_KEYS))
      .toEqual(['accountID']);
  });

  it('tenant-Bのスタッフにはtenant-Bのアカウントだけを通す', async () => {
    const tenantBStaff = { ...defaultStaff, id: 'staff-b', tenantId: 'tenant-B' };
    const own = await app(tenantBStaff).request(
      '/api/friends?account_id=tenant-b-account', {}, environment(),
    );
    const other = await app(tenantBStaff).request(
      '/api/friends?account_id=default-1', {}, environment(),
    );
    expect(own.status).toBe(200);
    expect(other.status).toBe(403);
  });

  it('越境拒否ログは構造化され、資格情報を含まない', async () => {
    await app(defaultStaff).request(
      '/api/friends?account_id=tenant-b-account', {}, environment(),
    );

    expect(warn).toHaveBeenCalledWith({
      event: 'tenant_boundary_denied',
      staff_id: 'staff-default',
      staff_tenant_id: DEFAULT_TENANT_ID,
      requested_account_id: 'tenant-b-account',
      path: '/api/friends',
    });
    const serialized = JSON.stringify(warn.mock.calls);
    expect(serialized).not.toContain('token-tenant-b-account');
    expect(serialized).not.toContain('secret-tenant-b-account');
  });

  it.each([
    '/webhook?account_id=tenant-b-account',
    '/api/liff/profile?account_id=tenant-b-account',
    '/api/public/brand?account_id=tenant-b-account',
  ])('スタッフ不在の公開経路を従来どおり通す: %s', async (path) => {
    const response = await app().request(path, {}, environment());
    expect(response.status).toBe(200);
  });

  it('/api/以外は認証済みでも境界検査の対象にしない', async () => {
    const response = await app(defaultStaff).request(
      '/admin/version?account_id=tenant-b-account', {}, environment(),
    );
    expect(response.status).toBe(200);
  });

  it('リクエストボディを消費せず下流ルートへ渡す', async () => {
    const instance = new Hono<Env>();
    instance.use('*', async (c, next) => {
      c.set('staff', defaultStaff);
      return next();
    });
    instance.use('*', tenantScopeMiddleware);
    instance.post('/api/body-scope-future', async (c) => c.json(await c.req.json()));

    const response = await instance.request('/api/body-scope-future', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ lineAccountId: 'tenant-b-account' }),
    }, environment());

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ lineAccountId: 'tenant-b-account' });
  });
});
