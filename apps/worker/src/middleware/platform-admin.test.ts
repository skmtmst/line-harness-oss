import { beforeEach, describe, expect, it } from 'vitest';
import { createTestD1, type SqliteD1 } from '../test-utils/d1-sqlite.js';
import { DEFAULT_TENANT_ID } from '../lib/tenant.js';
import { candidateFromStaffRow, isPlatformAdminRow } from './platform-admin.js';

/**
 * ★V6 37 の初期登録。platform_admins が空の間は「既定の統括のオーナー」だけを
 * 互換で通す。この判定は API（requirePlatformAdmin）だけでなく、LINE ログインの
 * 運営コンソール分岐と /api/auth/session でも同じでなければならない。
 * 片方だけ厳しいと、最初の 1 人が画面に入れず初期登録ができない。
 */
let testDb: SqliteD1;

beforeEach(() => {
  testDb = createTestD1();
  testDb.raw.prepare(`INSERT INTO tenants (id, name, status) VALUES (?, ?, 'active')`).run('tenant-a', '株式会社サンプル');
  for (const [id, role, access, tenant] of [
    ['legacy-owner', 'owner', 'full', DEFAULT_TENANT_ID],
    ['legacy-viewer', 'owner', 'read_only', DEFAULT_TENANT_ID],
    ['legacy-admin', 'admin', 'full', DEFAULT_TENANT_ID],
    ['other-owner', 'owner', 'full', 'tenant-a'],
  ] as const) {
    testDb.raw.prepare(`INSERT INTO staff_members (id, name, role, access_level, api_key, tenant_id) VALUES (?, ?, ?, ?, ?, ?)`)
      .run(id, id, role, access, `${id}-key`, tenant);
  }
});

function row(id: string) {
  return testDb.raw.prepare('SELECT id, role, access_level, tenant_id FROM staff_members WHERE id = ?').get(id) as {
    id: string; role: string; access_level: string | null; tenant_id: string | null;
  };
}

describe('運営マスターの判定（staff_members の行から）', () => {
  it('platform_admins が空の間は、既定の統括のオーナーだけが通る', async () => {
    expect(await isPlatformAdminRow(testDb.db, candidateFromStaffRow(row('legacy-owner')))).toBe(true);
    expect(await isPlatformAdminRow(testDb.db, candidateFromStaffRow(row('legacy-viewer')))).toBe(false);
    expect(await isPlatformAdminRow(testDb.db, candidateFromStaffRow(row('legacy-admin')))).toBe(false);
    expect(await isPlatformAdminRow(testDb.db, candidateFromStaffRow(row('other-owner')))).toBe(false);
  });

  it('1 人でも登録されたら互換は消え、登録された人だけが通る', async () => {
    testDb.raw.prepare(`INSERT INTO platform_admins (staff_id, is_active) VALUES (?, 1)`).run('other-owner');
    expect(await isPlatformAdminRow(testDb.db, candidateFromStaffRow(row('legacy-owner')))).toBe(false);
    expect(await isPlatformAdminRow(testDb.db, candidateFromStaffRow(row('other-owner')))).toBe(true);
  });

  it('停止された登録は通らない', async () => {
    testDb.raw.prepare(`INSERT INTO platform_admins (staff_id, is_active) VALUES (?, 0)`).run('other-owner');
    // 有効な登録が 0 件なので互換が働き、既定の統括のオーナーは通る
    expect(await isPlatformAdminRow(testDb.db, candidateFromStaffRow(row('legacy-owner')))).toBe(true);
    expect(await isPlatformAdminRow(testDb.db, candidateFromStaffRow(row('other-owner')))).toBe(false);
  });

  it('env-owner は通らない', async () => {
    expect(await isPlatformAdminRow(testDb.db, { id: 'env-owner', role: 'owner', readOnly: false, tenantId: null })).toBe(false);
  });
});
