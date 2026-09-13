import { beforeEach, describe, expect, it } from 'vitest';
import { DEFAULT_TENANT_ID } from '../lib/tenant.js';
import { createTestD1, type SqliteD1 } from '../test-utils/d1-sqlite.js';
import { getSendPermissionForAccount, getSendPermissionForTenant, type SendPermissionCache } from './send-entitlements.js';

let testDb: SqliteD1;

beforeEach(() => {
  testDb = createTestD1();
  testDb.raw.prepare("INSERT INTO tenants (id, name, plan_status, trial_ends_at) VALUES ('tenant-expired', '期限切れの統括', 'trialing', '2020-01-01T00:00:00.000')").run();
  testDb.raw.prepare("INSERT INTO tenants (id, name, plan_status, plan_key) VALUES ('tenant-active', '契約中の統括', 'active', 'light')").run();
  testDb.raw.prepare(
    `INSERT INTO line_accounts (id, channel_id, name, channel_access_token, channel_secret, is_active, tenant_id)
     VALUES ('acc-expired', 'ch-1', '期限切れ店舗', '', '', 1, 'tenant-expired'),
            ('acc-active', 'ch-2', '契約中店舗', '', '', 1, 'tenant-active'),
            ('acc-default', 'ch-3', '既定の店舗', '', '', 1, ?)`,
  ).run(DEFAULT_TENANT_ID);
});

describe('配信の可否（課金の状態）', () => {
  it('既存の統括（課金対象外）は止まらない', async () => {
    const permission = await getSendPermissionForAccount(testDb.db, 'acc-default');
    expect(permission).toMatchObject({ allowed: true, reason: null, state: 'exempt', tenantId: DEFAULT_TENANT_ID });
  });

  it('トライアルが終わった統括の店舗は止まり、理由に課金プランの案内が入る', async () => {
    const permission = await getSendPermissionForAccount(testDb.db, 'acc-expired');
    expect(permission.allowed).toBe(false);
    expect(permission.state).toBe('trial_expired');
    expect(permission.reason).toContain('課金プラン');
  });

  it('契約中の統括の店舗は送れる。店舗が無い（null）ときは既定の統括として扱う', async () => {
    expect((await getSendPermissionForAccount(testDb.db, 'acc-active')).allowed).toBe(true);
    expect((await getSendPermissionForAccount(testDb.db, null)).tenantId).toBe(DEFAULT_TENANT_ID);
    expect((await getSendPermissionForAccount(testDb.db, 'acc-missing')).tenantId).toBe(DEFAULT_TENANT_ID);
  });

  it('同じ cron の中では統括ごとに1回だけ読む（キャッシュ）', async () => {
    const cache: SendPermissionCache = new Map();
    await getSendPermissionForAccount(testDb.db, 'acc-expired', cache);
    testDb.raw.prepare("UPDATE tenants SET plan_status = 'active', plan_key = 'pro' WHERE id = 'tenant-expired'").run();
    expect((await getSendPermissionForAccount(testDb.db, 'acc-expired', cache)).allowed).toBe(false);
    expect((await getSendPermissionForAccount(testDb.db, 'acc-expired')).allowed).toBe(true);
  });

  it('課金の表が読めないときは止めない', async () => {
    const broken = { prepare: () => { throw new Error('db down'); } } as unknown as D1Database;
    const permission = await getSendPermissionForTenant(broken, 'tenant-expired');
    expect(permission).toMatchObject({ allowed: true, state: 'unknown' });
  });
});
