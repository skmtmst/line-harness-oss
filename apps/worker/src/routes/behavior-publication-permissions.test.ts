import { createTestD1, type SqliteD1 } from '../test-utils/d1-sqlite.js';
import { Hono } from 'hono';
import { beforeEach, afterEach, describe, expect, test } from 'vitest';
import { hasDeliveryAccess } from '@line-crm/shared';
import { scenarios } from './scenarios.js';
import { friendAddRules } from './friend-add-rules.js';
import { richMenuGroups } from './rich-menu-groups.js';
import { forms } from './forms.js';
import type { Env } from '../worker-env.js';

let t: SqliteD1;
beforeEach(() => { t = createTestD1(); t.raw.prepare("INSERT INTO scenarios (id,name,trigger_type) VALUES ('s','試験','manual')").run(); });
afterEach(() => t.raw.close());
const keys = ['/scenarios', 'scenario.definition.edit', 'scenario.definition.publish', '/friend-add-settings', 'friend_add.definition.publish', '/rich-menus', 'richmenu.definition.publish', 'richmenu.definition.archive', '/form-submissions', 'form.definition.publish', 'form.definition.archive'];
function app(role: 'staff' | 'owner', readOnly = false) {
  const app = new Hono<Env>();
  app.use('*', async (c, next) => { c.env = { DB: t.db } as Env['Bindings']; c.set('staff', { id: 'env-owner', role, name: '担当', permissionKeys: keys, readOnly }); await next(); });
  app.route('/', scenarios); app.route('/', friendAddRules); app.route('/', richMenuGroups); app.route('/', forms);
  return app;
}

describe('編集と公開・停止の権限を分ける', () => {
  test.each([
    ['POST', '/api/scenarios/s/publish'],
    ['POST', '/api/friend-add-rules/r/publish'], ['POST', '/api/friend-add-rules/r/stop'],
    ['POST', '/api/friend-add-runs/r/retry'], ['POST', '/api/friend-add-rules/drafts'],
    ['PATCH', '/api/friend-add-rules/reorder'],
    ['POST', '/api/rich-menu-groups/r/publish'], ['POST', '/api/rich-menu-groups/r/unpublish'],
    ['DELETE', '/api/rich-menu-groups/r'],
    ['POST', '/api/forms/f/publish'], ['POST', '/api/forms/f/archive'],
    ['DELETE', '/api/forms/f'],
  ])('%s %s はスタッフの編集権限で実行できない', async (method, path) => {
    const response = await app('staff').request(path, { method, headers: { 'Content-Type': 'application/json' }, body: '{}' });
    expect(response.status).toBe(403);
  });
  test('管理者も閲覧のみの代理ログイン中は公開できない', async () => {
    const response = await app('owner', true).request('/api/scenarios/s/publish', { method: 'POST' });
    expect(response.status).toBe(403);
  });
  test('編集と公開・テストは共通の権限表でも分離する', () => {
    const staff = { role: 'staff', permissionKeys: keys };
    expect(hasDeliveryAccess(staff, 'scenarios', 'edit')).toBe(true);
    expect(hasDeliveryAccess(staff, 'scenarios', 'publish')).toBe(false);
    expect(hasDeliveryAccess(staff, 'richMenus', 'test')).toBe(true);
    expect(hasDeliveryAccess(staff, 'richMenus', 'edit')).toBe(false);
  });
});
