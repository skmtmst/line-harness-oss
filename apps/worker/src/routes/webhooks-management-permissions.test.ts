import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Hono } from 'hono';
import type { Env } from '../worker-env.js';
import { createTestD1, type SqliteD1 } from '../test-utils/d1-sqlite.js';
import { webhooks } from './webhooks.js';

const stepUp = vi.hoisted(() => vi.fn(async () => true));
vi.mock('../lib/step-up.js', async original => ({ ...await original<typeof import('../lib/step-up.js')>(), sensitiveStepUpSatisfied: stepUp }));
let db: SqliteD1;
const key = btoa('k'.repeat(32));
beforeEach(() => {
  stepUp.mockClear();
  db = createTestD1();
  db.raw.prepare(`INSERT INTO line_accounts (id, channel_id, name, channel_access_token, channel_secret)
    VALUES ('a1', 'fixture', '本店', 'fixture-token', 'fixture-secret')`).run();
  db.raw.prepare(`INSERT INTO outgoing_webhooks (id,name,url,event_types,line_account_id)
    VALUES ('out1','送り先','https://example.test/hook','["message"]','a1')`).run();
  db.raw.prepare(`INSERT INTO incoming_webhooks (id,name,line_account_id) VALUES ('in1','受け取り口','a1')`).run();
});
afterEach(() => db.raw.close());
function request(role: 'owner' | 'admin' | 'staff', path: string, method: string, body?: object) {
  const app = new Hono<Env>();
  app.use('*', async (c, next) => { c.set('staff', { id: 'fixture', name: '担当者', role, readOnly: false }); return next(); });
  app.route('/', webhooks);
  return app.request(path, { method, headers: { 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined },
    { DB: db.db, LINE_CREDENTIAL_ENCRYPTION_KEY: key });
}
function contents() {
  return ['incoming_webhooks', 'outgoing_webhooks', 'audit_events', 'auth_step_up_grants'].map(table => db.raw.prepare(`SELECT * FROM ${table}`).all());
}
describe('外部連携の定義と鍵の権限を分ける', () => {
  for (const direction of ['incoming', 'outgoing']) {
    const id = direction === 'incoming' ? 'in1' : 'out1';
    const path = `/api/webhooks/${direction}/${id}?lineAccountId=a1`;
    it(`${direction}: 管理者は名前と有効状態を変更できる`, async () => {
      const response = await request('admin', path, 'PUT', { name: '変更後', isActive: false });
      expect(response.status).toBe(200);
      expect(db.raw.prepare(`SELECT name,is_active FROM ${direction}_webhooks WHERE id=?`).get(id)).toEqual({ name: '変更後', is_active: 0 });
    });
    it(`${direction}: 担当者は通常編集も拒否する`, async () => {
      const before = contents();
      expect((await request('staff', path, 'PUT', { name: '変更不可' })).status).toBe(403);
      expect(contents()).toEqual(before);
    });
    it(`${direction}: 管理者のsecretと名前の同時要求は副作用前に403`, async () => {
      for (const secret of ['x'.repeat(32), '', null]) {
        const before = contents();
        const response = await request('admin', path, 'PUT', { secret, name: '一部だけも保存不可' });
        expect(response.status).toBe(403);
        expect(await response.json()).toMatchObject({ success: false, error: '合言葉の変更はオーナーだけができます' });
        expect(stepUp).not.toHaveBeenCalled();
        expect(contents()).toEqual(before);
      }
    });
    it(`${direction}: オーナーの鍵更新は既存の本人確認を通す`, async () => {
      expect((await request('owner', path, 'PUT', { secret: 'x'.repeat(32) })).status).toBe(200);
      expect(stepUp).toHaveBeenCalledOnce();
    });
    it(`${direction}: 管理者の削除・復元は拒否、オーナーは操作できる`, async () => {
      const before = contents();
      expect((await request('admin', path, 'DELETE')).status).toBe(403);
      expect((await request('admin', `/api/webhooks/${direction}/${id}/restore?lineAccountId=a1`, 'POST', {})).status).toBe(403);
      expect(contents()).toEqual(before);
      expect((await request('owner', path, 'DELETE')).status).toBe(200);
      expect((await request('owner', `/api/webhooks/${direction}/${id}/restore?lineAccountId=a1`, 'POST', {})).status).toBe(200);
    });
    it(`${direction}: 管理者は作成できる`, async () => {
      const response = await request('admin', `/api/webhooks/${direction}`, 'POST', {
        name: '新しい接続', lineAccountId: 'a1', url: 'https://example.test/new', eventTypes: ['friend_add'], sourceType: 'fixture',
      });
      expect(response.status).toBe(201);
      expect(stepUp).toHaveBeenCalledOnce();
      expect(db.raw.prepare(`SELECT name FROM ${direction}_webhooks WHERE name='新しい接続'`).get()).toEqual({ name: '新しい接続' });
    });
  }
  it('管理者は受信後の行動の定義を保存できる', async () => {
    const response = await request('admin', '/api/webhooks/incoming/in1/config?lineAccountId=a1', 'PATCH', {
      expectedVersion: 1, identityMatching: { methods: [], onNotFound: 'do_nothing' }, actions: [],
    });
    expect(response.status).toBe(200);
  });
  it('管理者にAPIの鍵の発行・停止・復元・入れ替えを広げない', async () => {
    const before = contents();
    for (const suffix of ['', '/key/revoke', '/key/reactivate', '/key/rotate']) {
      expect((await request('admin', `/api/webhooks/api-tokens${suffix}?lineAccountId=a1`, 'POST', { name: '鍵', scopes: ['read'] })).status).toBe(403);
    }
    expect(contents()).toEqual(before);
    expect(stepUp).not.toHaveBeenCalled();
  });
});


it('割当先を限定した管理者は、範囲外の作成・通常編集・行動の保存が副作用0', async () => {
  db.raw.prepare(`INSERT INTO staff_members (id,name,role,api_key,account_scope) VALUES ('fixture','管理者','admin','fixture-api-key','accounts')`).run();
  db.raw.prepare(`INSERT INTO staff_account_scopes (staff_id,line_account_id,created_at) VALUES ('fixture','a1','2026-11-01')`).run();
  db.raw.prepare(`INSERT INTO line_accounts (id,channel_id,name,channel_access_token,channel_secret) VALUES ('a2','other-channel','別の店','fixture','fixture')`).run();
  db.raw.prepare(`INSERT INTO outgoing_webhooks (id,name,url,event_types,line_account_id) VALUES ('out2','別店の送り先','https://example.test/hook','["friend_add"]','a2')`).run();
  db.raw.prepare(`INSERT INTO incoming_webhooks (id,name,line_account_id) VALUES ('in2','別店の受け取り口','a2')`).run();
  for (const direction of ['incoming','outgoing']) {
    const before = contents();
    const created = await request('admin', `/api/webhooks/${direction}`, 'POST', {
      name: '範囲外', lineAccountId: 'a2', url: 'https://example.test/outside', eventTypes: ['friend_add'],
    });
    expect(created.status).toBe(403);
    expect(contents()).toEqual(before);
    const id = direction === 'incoming' ? 'in2' : 'out2';
    const edited = await request('admin', `/api/webhooks/${direction}/${id}?lineAccountId=a2`, 'PUT', { name: '範囲外の編集', isActive: false });
    expect(edited.status).toBe(403);
    expect(contents()).toEqual(before);
  }
  const before = contents();
  const configured = await request('admin', '/api/webhooks/incoming/in2/config?lineAccountId=a2', 'PATCH', {
    expectedVersion: 1, identityMatching: { methods: [], onNotFound: 'do_nothing' }, actions: [],
  });
  expect(configured.status).toBe(404);
  expect(contents()).toEqual(before);
  // 同じ管理者の許可された店は、範囲を誤って狭めず通す。
  expect((await request('admin', '/api/webhooks/outgoing/out1?lineAccountId=a1', 'PUT', { name: '本店の編集' })).status).toBe(200);
});
