import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { Hono } from 'hono';
import { DEFAULT_TENANT_ID } from '@line-crm/shared';
import type { Env } from '../index.js';
import type { AuthenticatedStaff } from '../middleware/auth.js';
import { featureEnforcementMiddleware } from '../middleware/feature-enforcement.js';
import { createTestD1, type SqliteD1 } from '../test-utils/d1-sqlite.js';
import { friends } from './friends.js';
import { friendAttributes } from './friend-attributes.js';
import { friendFields } from './friend-fields.js';

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
  instance.route('/', friends);
  instance.route('/', friendAttributes);
  instance.route('/', friendFields);
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

const KEYS = ['friend_fields', 'support_marks', 'saved_searches'] as const;

function enableAll(testDb: SqliteD1): void {
  for (const account of ['account-1', 'account-2']) {
    for (const key of KEYS) setFeature(testDb, account, key, true);
  }
}

describe('友だち属性3機能のroute機能停止境界(#861)', () => {
  let testDb: SqliteD1;

  beforeEach(() => {
    testDb = createTestD1();
    seedAccounts(testDb);
  });

  afterEach(() => testDb.raw.close());

  it('記録が無い契約はカタログ既定（3キーともon）で通る', async () => {
    const target = routeApp(staff('env-owner'));
    const env = { DB: testDb.db } as Env['Bindings'];

    for (const [path, name] of [
      ['/api/friend-fields?lineAccountId=account-1', 'friend_fields'],
      ['/api/support-marks?lineAccountId=account-1', 'support_marks'],
      ['/api/friends/saved-views?lineAccountId=account-1', 'saved_searches'],
      ['/api/saved-searches?lineAccountId=account-1', 'saved_searches互換口'],
    ] as const) {
      const res = await target.request(path, {}, env);
      expect(res.status, name).toBe(200);
    }
  });

  it('キーを個別に切るとその機能だけが閉じ、残りは開いたまま', async () => {
    enableAll(testDb);
    const target = routeApp(staff('env-owner'));
    const env = { DB: testDb.db } as Env['Bindings'];

    setFeature(testDb, 'account-1', 'saved_searches', false);
    // 正規URLと互換口の両方が同じキーで閉じる。
    for (const path of [
      '/api/friends/saved-views?lineAccountId=account-1',
      '/api/saved-searches?lineAccountId=account-1',
    ]) {
      const res = await target.request(path, {}, env);
      expect(res.status, path).toBe(403);
      await expect(res.json()).resolves.toMatchObject({
        code: 'FEATURE_DISABLED',
        featureId: 'saved_searches',
      });
    }
    // 別キーの機能と必須の友だち管理は生きたまま。
    for (const path of [
      '/api/friend-fields?lineAccountId=account-1',
      '/api/support-marks?lineAccountId=account-1',
      '/api/friends?lineAccountId=account-1',
    ]) {
      const res = await target.request(path, {}, env);
      expect(res.status, path).toBe(200);
    }

    setFeature(testDb, 'account-1', 'friend_fields', false);
    const fields = await target.request('/api/friend-fields?lineAccountId=account-1', {}, env);
    expect(fields.status).toBe(403);
    const marks = await target.request('/api/support-marks?lineAccountId=account-1', {}, env);
    expect(marks.status).toBe(200);

    setFeature(testDb, 'account-1', 'support_marks', false);
    const marksOff = await target.request('/api/support-marks?lineAccountId=account-1', {}, env);
    expect(marksOff.status).toBe(403);
    await expect(marksOff.json()).resolves.toMatchObject({
      code: 'FEATURE_DISABLED',
      featureId: 'support_marks',
    });
  });

  it('offはaccount単位: 切ったaccountだけ閉じ、別accountは開いたまま', async () => {
    enableAll(testDb);
    setFeature(testDb, 'account-1', 'support_marks', false);
    const target = routeApp(staff('env-owner'));
    const env = { DB: testDb.db } as Env['Bindings'];

    const off = await target.request('/api/support-marks?lineAccountId=account-1', {}, env);
    expect(off.status).toBe(403);
    const on = await target.request('/api/support-marks?lineAccountId=account-2', {}, env);
    expect(on.status).toBe(200);
  });

  it('担当account境界: 担当外accountのsaved-viewsは404、機能offなら403', async () => {
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

    // 担当外 account-1 の保存検索は middleware 段で断られる（route へ届かない）。
    const foreign = await scoped.request('/api/friends/saved-views?lineAccountId=account-1', {}, env);
    expect(foreign.status).toBe(403);
    const own = await scoped.request('/api/friends/saved-views?lineAccountId=account-2', {}, env);
    expect(own.status).toBe(200);

    // 担当accountの機能を切ると、middleware が先に 403 を返す。
    setFeature(testDb, 'account-2', 'saved_searches', false);
    const ownDisabled = await scoped.request('/api/friends/saved-views?lineAccountId=account-2', {}, env);
    expect(ownDisabled.status).toBe(403);
    await expect(ownDisabled.json()).resolves.toMatchObject({ code: 'FEATURE_DISABLED' });
    // 他の機能は生きている。
    const fields = await scoped.request('/api/friend-fields?lineAccountId=account-2', {}, env);
    expect(fields.status).toBe(200);
  });
});
