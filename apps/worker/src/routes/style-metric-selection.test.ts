import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { Hono } from 'hono';
import { createTestD1 } from '../test-utils/d1-sqlite.js';
import { initializeAccountStyle } from '../services/style-setup.js';
import { styles } from './styles.js';
import type { Env } from '../worker-env.js';
vi.mock('../services/account-access.js', () => ({
  getVisibleLineAccountScope: async () => ({ accounts: [{ id: 'a' }], allowedAccountIds: ['a'], canSeeUnassigned: false }),
  canAccessAllLineAccounts: async (_db: unknown, _staff: unknown, ids: string[]) => ids.every(id => id === 'a'),
}));
let sql: ReturnType<typeof createTestD1>, app: Hono<Env>, readOnly = false;
const base = '/api/dashboard/style';
async function request(path = '', method = 'GET', body?: unknown) {
  const res = await app.request(`${base}${path}?account_id=a`, { method, headers: { 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) }, { DB: sql.db } as Env['Bindings']);
  return { status: res.status, body: await res.json() as { success: boolean; data: { version: number; metricIds: string[]; metricsCustomized: boolean } } };
}
beforeEach(async () => {
  readOnly = false; sql = createTestD1();
  sql.raw.exec("INSERT INTO tenants(id,name) VALUES('t','Tenant'); INSERT INTO line_accounts(id,tenant_id,channel_id,name,channel_access_token,channel_secret) VALUES('a','t','a','Account','fixture','fixture'); INSERT INTO staff_members(id,name,role,api_key,tenant_id) VALUES('owner','Owner','owner','fixture','t');");
  await initializeAccountStyle(sql.db, 'a', 't', 'owner');
  sql.raw.exec("UPDATE account_styles SET style='salon',cards_json=NULL,selected_at='2026-10-01T00:00:00Z',selection_mode='configured' WHERE line_account_id='a'");
  app = new Hono<Env>();
  app.use('*', async (c, next) => { c.set('staff', { id: 'owner', name: 'Owner', role: 'owner', tenantId: 't', readOnly } as Env['Variables']['staff']); await next(); });
  app.route('/', styles);
});
afterEach(() => sql.raw.close());

it('未選択defaultと同値の明示customを正確に分け、カードだけの保存では変更しない', async () => {
  const initial = await request();
  expect(initial.status).toBe(200);
  expect(initial.body.data.metricsCustomized).toBe(false);
  const custom = await request('/cards', 'PUT', { expectedVersion: initial.body.data.version, metricIds: initial.body.data.metricIds });
  expect(custom.status).toBe(200);
  expect(custom.body.data.metricIds).toEqual(initial.body.data.metricIds);
  expect(custom.body.data.metricsCustomized).toBe(true);
  const cardOnly = await request('/cards', 'PUT', { expectedVersion: custom.body.data.version, cards: [{ id: 'analytics', visible: false }] });
  expect(cardOnly.status).toBe(200);
  const reloaded = (await request()).body.data;
  expect(reloaded.metricsCustomized).toBe(true);
  expect(reloaded.metricIds).toEqual(initial.body.data.metricIds);
  const reset = await request('/cards', 'DELETE', { expectedVersion: reloaded.version });
  expect(reset.status).toBe(200);
  expect(reset.body.data.metricsCustomized).toBe(false);
  expect((await request()).body.data.metricsCustomized).toBe(false);
  expect(sql.raw.prepare("SELECT metrics_json FROM account_styles WHERE line_account_id='a'").get()).toEqual({ metrics_json: null });
});

it('空の明示customも順番を変えたcustomも再読込で保ち、競合・権限拒否で上書きしない', async () => {
  const initial = (await request()).body.data;
  const empty = await request('/cards', 'PUT', { expectedVersion: initial.version, metricIds: [] });
  expect(empty.body.data).toMatchObject({ metricsCustomized: true, metricIds: [] });
  const ordered = await request('/cards', 'PUT', { expectedVersion: empty.body.data.version, metricIds: ['noShowRate', 'bookings', 'recall'] });
  expect(ordered.status).toBe(200);
  expect((await request()).body.data).toMatchObject({ metricsCustomized: true, metricIds: ['noShowRate', 'bookings', 'recall'] });
  expect((await request('/cards', 'PUT', { expectedVersion: initial.version, metricIds: ['bookings'] })).status).toBe(409);
  readOnly = true;
  expect((await request('/cards', 'PUT', { expectedVersion: ordered.body.data.version, metricIds: ['bookings'] })).status).toBe(403);
  expect((await request()).body.data.metricIds).toEqual(['noShowRate', 'bookings', 'recall']);
  readOnly = false;
  expect((await request('/cards', 'PUT', { expectedVersion: ordered.body.data.version, metricIds: ['designationRate'] })).status).toBe(400);
  expect((await request()).body.data.metricIds).toEqual(['noShowRate', 'bookings', 'recall']);
});
