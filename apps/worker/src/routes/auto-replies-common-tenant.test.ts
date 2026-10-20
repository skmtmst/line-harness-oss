import { describe, expect, it } from 'vitest';
import { Hono } from 'hono';
import { DEFAULT_TENANT_ID } from '@line-crm/shared';
import { createTestD1 } from '../test-utils/d1-sqlite.js';
import type { Env } from '../worker-env.js';
import { autoReplies } from './auto-replies.js';

describe('common auto-replies tenant boundary', () => {
  it.each(['create', 'convert'])('F1: trial owner cannot %s a global rule', async (operation) => {
    const { db, raw } = createTestD1();
    raw.exec("INSERT INTO tenants(id,name) VALUES('trial','Trial'); INSERT INTO line_accounts(id,channel_id,name,channel_access_token,channel_secret,tenant_id) VALUES('a','ch','A','','','trial')");
    const app = new Hono<Env>();
    app.use('*', async (c, next) => { c.set('staff', { id: 'o', name: 'Owner', role: 'owner', readOnly: false, tenantId: 'trial' }); await next(); });
    app.route('/', autoReplies);
    const body = { keyword: 'test', responseContent: 'reply', lineAccountId: operation === 'create' ? null : 'a', isActive: false };
    const send = (path: string, method: string, payload: unknown) => app.request(path, { method, headers: { 'content-type': 'application/json' }, body: JSON.stringify(payload) }, { DB: db } as Env['Bindings']);
    const created = await send('/api/auto-replies?account_id=a', 'POST', body);
    if (operation === 'create') expect(created.status).toBe(403);
    else {
      expect(created.status).toBe(201);
      const { data } = await created.json() as { data: { id: string } };
      expect((await send(`/api/auto-replies/${data.id}`, 'PUT', { lineAccountId: null })).status).toBe(403);
    }
    expect(raw.prepare('SELECT count(*) n FROM auto_replies WHERE line_account_id IS NULL').get()).toEqual({ n: 0 });
  });
  it('F1: platform owner keeps global creation', async () => {
    const { db } = createTestD1();
    const app = new Hono<Env>();
    app.use('*', async (c, next) => { c.set('staff', { id: 'env-owner', name: 'Owner', role: 'owner', readOnly: false, tenantId: DEFAULT_TENANT_ID }); await next(); });
    app.route('/', autoReplies);
    const res = await app.request('/api/auto-replies', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ keyword: 'test', responseContent: 'reply', lineAccountId: null, isActive: false }) }, { DB: db } as Env['Bindings']);
    expect(res.status).toBe(201);
  });
});
