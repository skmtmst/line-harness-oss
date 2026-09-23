import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { Hono } from 'hono';
import { DEFAULT_TENANT_ID } from '@line-crm/shared';
import type { Env } from '../index.js';
import type { AuthenticatedStaff } from '../middleware/auth.js';
import { featureEnforcementMiddleware } from '../middleware/feature-enforcement.js';
import { createTestD1, type SqliteD1 } from '../test-utils/d1-sqlite.js';

/*
 * WRITE-01: 更新系APIはpayloadにaccountを載せない口が多い
 * （PUT /api/templates/:id、PATCH /api/rich-menu-groups/:id、
 *  POST /api/conversions/definitions/:id/revise など）。
 * middleware がURLの対象IDから所属accountを引き、権限・機能設定の
 * 判定をその所属accountに対して行うことを、実DBで確かめる。
 */

function staff(
  id: string,
  role: AuthenticatedStaff['role'] = 'owner',
  assignedLineAccountId: string | null = null,
): AuthenticatedStaff {
  return {
    id,
    name: id,
    role,
    readOnly: false,
    tenantId: DEFAULT_TENANT_ID,
    assignedLineAccountId,
  };
}

function routeApp(current: AuthenticatedStaff | undefined) {
  const instance = new Hono<Env>();
  instance.use('*', async (c, next) => {
    if (current) c.set('staff', current);
    await next();
  });
  instance.use('/api/*', featureEnforcementMiddleware);
  // 判定までが対象なので、handler は素通しの stub で足りる。
  instance.put('/api/templates/:id', (c) => c.json({ success: true }));
  instance.patch('/api/rich-menu-groups/:id', (c) => c.json({ success: true }));
  instance.post('/api/conversions/definitions/:id/revise', (c) => c.json({ success: true }));
  instance.post('/api/automations/:id/status', (c) => c.json({ success: true }));
  instance.post('/api/automations/:id/draft', (c) => c.json({ success: true }));
  instance.put('/api/mileage/rules/:id', (c) => c.json({ success: true }));
  instance.delete('/api/mileage/rules/:id', (c) => c.json({ success: true }));
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

function seedResources(testDb: SqliteD1): void {
  const now = '2026-09-22T00:00:00.000+09:00';
  testDb.raw.prepare(`
    INSERT INTO templates
      (id, name, category, message_type, message_content, line_account_id, created_at, updated_at)
    VALUES ('tpl-1', 'テンプレ1', 'general', 'text', '本文', 'account-1', ?, ?)
  `).run(now, now);
  testDb.raw.prepare(`
    INSERT INTO templates
      (id, name, category, message_type, message_content, line_account_id, created_at, updated_at)
    VALUES ('tpl-2', 'テンプレ2', 'general', 'text', '本文', 'account-2', ?, ?)
  `).run(now, now);
  testDb.raw.prepare(`
    INSERT INTO templates
      (id, name, category, message_type, message_content, line_account_id, created_at, updated_at)
    VALUES ('tpl-shared', '共用', 'general', 'text', '本文', NULL, ?, ?)
  `).run(now, now);
  testDb.raw.prepare(`
    INSERT INTO rich_menu_groups
      (id, account_id, name, chat_bar_text, size, is_default_for_all, status,
       targeting_priority, targeting_enabled, display_order, created_at, updated_at)
    VALUES ('rmg-1', 'account-1', 'メニュー1', 'メニュー', 'large', 0, 'draft', 0, 0, 0, ?, ?)
  `).run(now, now);
  testDb.raw.prepare(`
    INSERT INTO conversion_points
      (id, name, event_type, line_account_id, created_at)
    VALUES ('cv-1', '成果地点1', 'purchase', 'account-1', ?)
  `).run(now);
  // V6オートメーション。一覧が返すidはこちら（旧 automations 表には無い）。
  testDb.raw.prepare(`
    INSERT INTO automation_definitions
      (id, line_account_id, name, status, created_at, updated_at)
    VALUES ('auto-def-1', 'account-1', '監査用ルール', 'active', ?, ?)
  `).run(now, now);
  // 旧 automations 表の行（V6定義を持たないレガシー）。
  testDb.raw.prepare(`
    INSERT INTO automations
      (id, name, event_type, line_account_id, created_at, updated_at)
    VALUES ('auto-legacy-1', '旧ルール', 'message_received', 'account-1', ?, ?)
  `).run(now, now);
  // たまる決めごと。一覧が返すidは mileage_rules の行そのもの。
  testDb.raw.prepare(`
    INSERT INTO mileage_programs (id, code, name, created_at, updated_at)
    VALUES ('prog-1', 'default', '通常', ?, ?)
  `).run(now, now);
  testDb.raw.prepare(`
    INSERT INTO mileage_rules
      (id, program_id, name, event_type, amount, line_account_id, created_at, updated_at)
    VALUES ('mileage-rule-1', 'prog-1', '監査用決めごと', 'booking_created', 300, 'account-1', ?, ?)
  `).run(now, now);
}

function enableAll(testDb: SqliteD1): void {
  for (const account of ['account-1', 'account-2']) {
    for (const key of ['templates', 'rich_menus', 'affiliates']) {
      setFeature(testDb, account, key, true);
    }
  }
}

function seedScopedStaff(testDb: SqliteD1, staffId: string, accountId: string): void {
  testDb.raw.prepare(`
    INSERT INTO staff_members (id, name, role, api_key, tenant_id, account_scope)
    VALUES (?, ?, 'staff', ?, ?, 'accounts')
  `).run(staffId, staffId, `key-${staffId}`, DEFAULT_TENANT_ID);
  testDb.raw.prepare(`
    INSERT INTO staff_account_scopes (staff_id, line_account_id, created_at)
    VALUES (?, ?, '2026-09-01T00:00:00+09:00')
  `).run(staffId, accountId);
}

describe('WRITE-01: 対象IDからの所属account解決', () => {
  let testDb: SqliteD1;
  let env: Env['Bindings'];

  beforeEach(() => {
    testDb = createTestD1();
    seedAccounts(testDb);
    seedResources(testDb);
    enableAll(testDb);
    env = { DB: testDb.db } as Env['Bindings'];
  });

  afterEach(() => testDb.raw.close());

  it('更新payloadにaccountが無くても、対象の所属accountで機能設定を照合して更新できる', async () => {
    const app = routeApp(staff('env-owner'));
    const response = await app.request('/api/templates/tpl-1', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: '更新後' }),
    }, env);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ success: true });
  });

  it('リッチメニュー下書きの更新も対象の所属accountで通る', async () => {
    const app = routeApp(staff('env-owner'));
    const response = await app.request('/api/rich-menu-groups/rmg-1', {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ chatBarText: '更新後' }),
    }, env);
    expect(response.status).toBe(200);
  });

  it('成果地点の版更新（revise）も対象の所属accountで通る', async () => {
    const app = routeApp(staff('env-owner'));
    const response = await app.request('/api/conversions/definitions/cv-1/revise', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: '更新後', expectedVersion: 1 }),
    }, env);
    expect(response.status).toBe(200);
  });

  it('担当accountを持つスタッフも、対象の所属accountで判定される', async () => {
    // account-1 担当のスタッフが account-1 の対象を更新する。
    const app = routeApp(staff('assigned-1', 'staff', 'account-1'));
    const own = await app.request('/api/templates/tpl-1', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: '更新後' }),
    }, env);
    expect(own.status).toBe(200);

    /*
     * 従来はスタッフの割当account（account-1）で機能判定していたため、
     * account-2 の対象でも account-1 の設定で通り抜けていた。
     * 対象の所属で見るので、account-2 で機能がオフならここで止まる。
     */
    setFeature(testDb, 'account-2', 'templates', false);
    const other = await app.request('/api/templates/tpl-2', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: '更新後' }),
    }, env);
    expect(other.status).toBe(403);
    expect(await other.json()).toMatchObject({
      code: 'FEATURE_DISABLED',
      featureId: 'templates',
    });
  });

  it('担当範囲が限定されたスタッフは、範囲外accountの対象を更新できない', async () => {
    seedScopedStaff(testDb, 'scoped-1', 'account-2');
    const app = routeApp(staff('scoped-1', 'staff'));
    const foreign = await app.request('/api/templates/tpl-1', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: '更新後' }),
    }, env);
    expect(foreign.status).toBe(403);
    expect(await foreign.json()).toMatchObject({
      success: false,
      error: 'このLINEアカウントを操作する権限がありません',
    });
    const own = await app.request('/api/templates/tpl-2', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: '更新後' }),
    }, env);
    expect(own.status).toBe(200);
  });

  it('対象の所属accountで機能がオフなら 403 で止まる', async () => {
    setFeature(testDb, 'account-1', 'templates', false);
    const app = routeApp(staff('env-owner'));
    const response = await app.request('/api/templates/tpl-1', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: '更新後' }),
    }, env);
    expect(response.status).toBe(403);
    expect(await response.json()).toMatchObject({
      code: 'FEATURE_DISABLED',
      featureId: 'templates',
    });
  });

  it('明示したaccountが対象の所属と食い違うなら拒否する（改変account）', async () => {
    const app = routeApp(staff('env-owner'));
    const byQuery = await app.request('/api/templates/tpl-1?account_id=account-2', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: '更新後' }),
    }, env);
    expect(byQuery.status).toBe(403);
    expect(await byQuery.json()).toMatchObject({ code: 'LINE_ACCOUNT_MISMATCH' });

    const byBody = await app.request('/api/templates/tpl-1', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: '更新後', accountId: 'account-2' }),
    }, env);
    expect(byBody.status).toBe(403);
    expect(await byBody.json()).toMatchObject({ code: 'LINE_ACCOUNT_MISMATCH' });
  });

  it('明示したaccountが対象の所属と一致するなら従来どおり通る', async () => {
    const app = routeApp(staff('env-owner'));
    const response = await app.request('/api/templates/tpl-1?account_id=account-1', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: '更新後' }),
    }, env);
    expect(response.status).toBe(200);
  });

  it('所属accountがNULL（共用）の対象は従来の解決順を変えない', async () => {
    const app = routeApp(staff('env-owner'));
    const response = await app.request('/api/templates/tpl-shared', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: '更新後' }),
    }, env);
    // 共用対象のaccount解決はしない。account無指定の更新は従来どおり400。
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ code: 'LINE_ACCOUNT_REQUIRED' });
  });

  it('存在しない対象IDは解決せず従来どおり400を返す', async () => {
    const app = routeApp(staff('env-owner'));
    const response = await app.request('/api/templates/no-such-id', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: '更新後' }),
    }, env);
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ code: 'LINE_ACCOUNT_REQUIRED' });
  });

  it('V6オートメーション定義の稼働切替も対象の所属accountで通る', async () => {
    // #1063: automation_definitions の行は旧 automations 表に無い。
    // 旧表だけを見る所有解決だと V6 ルールへの操作が全部 LINE_ACCOUNT_REQUIRED で止まる。
    setFeature(testDb, 'account-1', 'automations', true);
    const app = routeApp(staff('env-owner'));
    const response = await app.request('/api/automations/auto-def-1/status', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ status: 'stopped' }),
    }, env);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ success: true });
  });

  it('V6オートメーション定義の改訂下書きも対象の所属accountで通る', async () => {
    // 一覧の「編集する」が「編集用の下書きを作れませんでした」になる原因と同根。
    setFeature(testDb, 'account-1', 'automations', true);
    const app = routeApp(staff('env-owner'));
    const response = await app.request('/api/automations/auto-def-1/draft', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({}),
    }, env);
    expect(response.status).toBe(200);
  });

  it('旧 automations 表だけにある行も従来どおり解決する', async () => {
    setFeature(testDb, 'account-1', 'automations', true);
    const app = routeApp(staff('env-owner'));
    const response = await app.request('/api/automations/auto-legacy-1/status', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ status: 'stopped' }),
    }, env);
    expect(response.status).toBe(200);
  });

  it('スタッフ未設定の経路でも、対象の所属accountで機能判定だけを行う', async () => {
    // middleware は機能ゲートであり、最終認可は handler 側の requireRole が担う。
    // staff が無いときも従来どおり scope 検査は行わず、機能の有効性だけを見る。
    const app = routeApp(undefined);
    const response = await app.request('/api/rich-menu-groups/rmg-1', {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ chatBarText: '更新後' }),
    }, env);
    expect(response.status).toBe(200);
  });

  it('たまる決めごとの停止（isActiveのみのPUT）も対象の所属accountで通る', async () => {
    // #1075: PUT /api/mileage/rules/:id は {isActive} だけを送り、
    // account を載せない。所有照合が無いと LINE_ACCOUNT_REQUIRED で止まる。
    setFeature(testDb, 'account-1', 'mileage', true);
    const app = routeApp(staff('env-owner'));
    const response = await app.request('/api/mileage/rules/mileage-rule-1', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ isActive: false }),
    }, env);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ success: true });
  });

  it('たまる決めごとの削除も対象の所属accountで通る', async () => {
    setFeature(testDb, 'account-1', 'mileage', true);
    const app = routeApp(staff('env-owner'));
    const response = await app.request('/api/mileage/rules/mileage-rule-1', {
      method: 'DELETE',
    }, env);
    expect(response.status).toBe(200);
  });
});
