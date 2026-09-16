import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { Hono } from 'hono';
import { DEFAULT_TENANT_ID } from '@line-crm/shared';
import type { Env } from '../index.js';
import type { AuthenticatedStaff } from '../middleware/auth.js';
import { featureEnforcementMiddleware } from '../middleware/feature-enforcement.js';
import { createTestD1, type SqliteD1 } from '../test-utils/d1-sqlite.js';
import { contents } from './contents.js';

function staff(
  id: string,
  role: AuthenticatedStaff['role'] = 'owner',
): AuthenticatedStaff {
  return { id, name: id, role, readOnly: false, tenantId: DEFAULT_TENANT_ID };
}

function routeApp(current: AuthenticatedStaff) {
  const instance = new Hono<Env>();
  instance.use('*', async (c, next) => {
    c.set('staff', current);
    await next();
  });
  instance.use('/api/*', featureEnforcementMiddleware);
  instance.route('/', contents);
  return instance;
}

function setFeature(testDb: SqliteD1, accountId: string, key: string, enabled: boolean): void {
  testDb.raw.prepare(`
    INSERT INTO account_settings (id, line_account_id, key, value)
    VALUES (?, ?, ?, ?)
    ON CONFLICT(line_account_id, key) DO UPDATE SET value = excluded.value
  `).run(`setting-${key}-${accountId}`, accountId, `feature.${key}`, JSON.stringify({ enabled }));
}

function seedAccounts(testDb: SqliteD1): void {
  for (const id of ['account-1', 'account-2']) {
    testDb.raw.prepare(`
      INSERT INTO line_accounts
        (id, channel_id, name, channel_access_token, channel_secret, tenant_id)
      VALUES (?, ?, ?, 'fixture', 'fixture', ?)
    `).run(id, `channel-${id}`, `店舗${id}`, DEFAULT_TENANT_ID);
  }
}

function enableAll(testDb: SqliteD1): void {
  for (const account of ['account-1', 'account-2']) {
    for (const key of ['common_vars', 'media']) setFeature(testDb, account, key, true);
  }
}

describe('共通情報キーのroute機能停止境界(#862)', () => {
  let testDb: SqliteD1;

  beforeEach(() => {
    testDb = createTestD1();
    seedAccounts(testDb);
  });

  afterEach(() => testDb.raw.close());

  it('記録が無い契約はカタログ既定（common_vars/mediaともにon）で通る', async () => {
    const target = routeApp(staff('env-owner'));
    const env = { DB: testDb.db } as Env['Bindings'];

    const vars = await target.request('/api/common-vars?accountId=account-1', {}, env);
    expect(vars.status).toBe(200);
    const media = await target.request('/api/media?accountId=account-1', {}, env);
    expect(media.status).toBe(200);
  });

  it('common_varsを切ると共通情報APIだけが閉じ、登録メディアは開いたまま', async () => {
    enableAll(testDb);
    const target = routeApp(staff('env-owner'));
    const env = { DB: testDb.db } as Env['Bindings'];

    setFeature(testDb, 'account-1', 'common_vars', false);
    const vars = await target.request('/api/common-vars?accountId=account-1', {}, env);
    expect(vars.status).toBe(403);
    await expect(vars.json()).resolves.toMatchObject({
      code: 'FEATURE_DISABLED',
      featureId: 'common_vars',
    });
    // 一覧以外の口も同じキーで閉じる。
    const detail = await target.request('/api/common-vars/var-1?accountId=account-1', {}, env);
    expect(detail.status).toBe(403);

    const media = await target.request('/api/media?accountId=account-1', {}, env);
    expect(media.status).toBe(200);
  });

  it('mediaを切ると登録メディアだけが閉じ、共通情報は開いたまま', async () => {
    enableAll(testDb);
    const target = routeApp(staff('env-owner'));
    const env = { DB: testDb.db } as Env['Bindings'];

    setFeature(testDb, 'account-1', 'media', false);
    const media = await target.request('/api/media?accountId=account-1', {}, env);
    expect(media.status).toBe(403);
    await expect(media.json()).resolves.toMatchObject({
      code: 'FEATURE_DISABLED',
      featureId: 'media',
    });

    const vars = await target.request('/api/common-vars?accountId=account-1', {}, env);
    expect(vars.status).toBe(200);
  });

  it('offはaccount単位: 切ったaccountだけ閉じ、別accountは開いたまま', async () => {
    enableAll(testDb);
    setFeature(testDb, 'account-1', 'common_vars', false);
    const target = routeApp(staff('env-owner'));
    const env = { DB: testDb.db } as Env['Bindings'];

    const off = await target.request('/api/common-vars?accountId=account-1', {}, env);
    expect(off.status).toBe(403);
    const on = await target.request('/api/common-vars?accountId=account-2', {}, env);
    expect(on.status).toBe(200);
  });

  it('担当account境界: 担当外accountの共通情報はmiddlewareで断り、担当accountのoffも403', async () => {
    enableAll(testDb);
    testDb.raw.prepare(`
      INSERT INTO staff_members (id, name, role, api_key, tenant_id, account_scope)
      VALUES ('scoped-1', 'scoped-1', 'staff', 'key-scoped', ?, 'accounts')
    `).run(DEFAULT_TENANT_ID);
    testDb.raw.prepare(`
      INSERT INTO staff_account_scopes (staff_id, line_account_id, created_at)
      VALUES ('scoped-1', 'account-2', '2026-09-01T00:00:00+09:00')
    `).run();
    const scoped = routeApp(staff('scoped-1', 'staff'));
    const env = { DB: testDb.db } as Env['Bindings'];

    const foreign = await scoped.request('/api/common-vars?accountId=account-1', {}, env);
    expect(foreign.status).toBe(403);
    const own = await scoped.request('/api/common-vars?accountId=account-2', {}, env);
    expect(own.status).toBe(200);

    setFeature(testDb, 'account-2', 'common_vars', false);
    const ownDisabled = await scoped.request('/api/common-vars?accountId=account-2', {}, env);
    expect(ownDisabled.status).toBe(403);
  });
});
