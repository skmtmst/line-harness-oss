import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { Hono } from 'hono';
import { DEFAULT_TENANT_ID } from '@line-crm/shared';
import type { Env } from '../index.js';
import type { AuthenticatedStaff } from '../middleware/auth.js';
import { createTestD1, type SqliteD1 } from '../test-utils/d1-sqlite.js';
import { broadcasts } from './broadcasts.js';

// Only the background kick is replaced; route guards, account lookup, condition SQL and D1 writes are real.
const kick = vi.hoisted(() => vi.fn(async () => {}));
vi.mock('../services/broadcast.js', async original => ({
  ...await original<Record<string, unknown>>(), processQueuedBroadcasts: kick,
}));
let fixture: SqliteD1;
const condition = { operator: 'OR', rules: ['allowed', 'outside'].map(text => ({ type: 'name', value: { text, targets: ['display'] } })) };

beforeEach(() => {
  fixture = createTestD1();
  fixture.raw.prepare('INSERT OR IGNORE INTO tenants(id,name) VALUES (?,?)').run('other-tenant', 'Other');
  for (const [id, tenant] of [['own', DEFAULT_TENANT_ID], ['other', 'other-tenant']]) {
    fixture.raw.prepare(`INSERT INTO line_accounts(id,name,channel_id,channel_secret,channel_access_token,tenant_id)
      VALUES (?,?,?,'unused','unused',?)`).run(id, id, id, tenant);
  }
  for (const id of ['operator', 'second']) {
    fixture.raw.prepare(`INSERT INTO staff_members(id,name,role,api_key,tenant_id,account_scope,invite_status)
      VALUES (?,?,'owner',?,?,'all','active')`).run(id, id, id, DEFAULT_TENANT_ID);
  }
  for (const [id, account, name] of [['own-friend', 'own', 'allowed'], ['other-friend', 'other', 'outside']]) {
    fixture.raw.prepare(`INSERT INTO friends(id,line_user_id,display_name,line_account_id,is_following)
      VALUES (?,?,?,?,1)`).run(id, 'U' + id, name, account);
  }
  fixture.raw.prepare(`INSERT INTO broadcasts(id,title,message_type,message_content,target_type,status,line_account_id,segment_conditions,track_links)
    VALUES ('scope-check','Scope check','text','{{name}} さん','segment','draft','own',?,0)`).run(JSON.stringify(condition));
  vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('External network is forbidden'); }));
});
afterEach(() => { expect(fetch).not.toHaveBeenCalled(); vi.restoreAllMocks(); vi.unstubAllGlobals(); fixture.raw.close(); });

async function request(kind: 'preview-count' | 'send' | 'send-segment', person: Partial<AuthenticatedStaff> = {}, conditions = condition) {
  const app = new Hono<Env>();
  app.use('*', async (c, next) => {
    c.set('staff', { id: 'operator', name: 'Operator', role: 'owner', readOnly: false, tenantId: DEFAULT_TENANT_ID, ...person });
    await next();
  });
  app.route('/', broadcasts);
  return app.request('/api/broadcasts/scope-check/' + kind, kind === 'preview-count' ? {} : {
    method: 'POST', headers: { 'content-type': 'application/json', 'x-confirm-irreversible': 'broadcast-send' },
    body: JSON.stringify({ conditions }),
  }, { DB: fixture.db } as Env['Bindings']);
}

it.each(['own', null])('preview-countはORでも所属外を数えない: %s', async account => {
  fixture.raw.prepare("UPDATE broadcasts SET line_account_id=? WHERE id='scope-check'").run(account);
  const response = await request('preview-count');
  expect(response.status, await response.clone().text()).toBe(200);
  expect(await response.json()).toMatchObject({ data: { count: 1 } });
});

it.each([
  { kind: 'send' as const, account: 'own' }, { kind: 'send-segment' as const, account: 'own' },
  { kind: 'send' as const, account: null }, { kind: 'send-segment' as const, account: null },
])('他統括の名前なしを混ぜず、自己範囲の配信は通す: %j', async ({ kind, account }) => {
  fixture.raw.prepare("UPDATE friends SET display_name=NULL WHERE id='other-friend'").run();
  const mixed = { operator: 'OR', rules: [{ type: 'name', value: { text: 'allowed', targets: ['display'] } }, { type: 'tag_not_exists', value: 'none' }] };
  fixture.raw.prepare("UPDATE broadcasts SET line_account_id=?,segment_conditions=? WHERE id='scope-check'").run(account, JSON.stringify(mixed));
  const response = await request(kind, {}, mixed as typeof condition);
  expect(response.status, await response.clone().text()).toBe(202);
  expect(fixture.raw.prepare("SELECT status,total_count FROM broadcasts WHERE id='scope-check'").get())
    .toMatchObject({ status: 'sending', ...(kind === 'send' ? { total_count: 1 } : {}) });
});

it.each(['preview-count', 'send', 'send-segment'] as const)('%s: 他統括の配信は既存404で伏せる', async kind => {
  fixture.raw.prepare("UPDATE broadcasts SET line_account_id='other' WHERE id='scope-check'").run();
  const response = await request(kind);
  expect(response.status).toBe(404);
  expect(fixture.raw.prepare("SELECT status FROM broadcasts WHERE id='scope-check'").get()).toEqual({ status: 'draft' });
  expect(kick).not.toHaveBeenCalled();
});

it.each(['preview-count', 'send', 'send-segment'] as const)('%s: 未割当を見られない統括ではNULL配信を既存404にする', async kind => {
  fixture.raw.prepare("UPDATE broadcasts SET line_account_id=NULL WHERE id='scope-check'").run();
  expect((await request(kind, { tenantId: 'other-tenant' })).status).toBe(404);
  expect(fixture.raw.prepare("SELECT status FROM broadcasts WHERE id='scope-check'").get()).toEqual({ status: 'draft' });
});

it.each(['preview-count', 'send', 'send-segment'] as const)('%s: 入力集合を適用できないSQLなら配信を始めない', async kind => {
  const builder = kind === 'send-segment' ? 'buildPublicSegmentQuery' : 'buildSegmentQuery';
  vi.spyOn(await import('../services/segment-query.js'), builder)
    .mockReturnValue({ sql: 'SELECT f.id, f.line_user_id, f.display_name FROM friends AS f WHERE 1=1', bindings: [] });
  const response = await request(kind);
  if (kind === 'preview-count') {
    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({ success: false });
  } else {
    expect(response.status).toBeGreaterThanOrEqual(400);
  }
  expect(fixture.raw.prepare("SELECT status FROM broadcasts WHERE id='scope-check'").get()).toEqual({ status: 'draft' });
  expect(kick).not.toHaveBeenCalled();
});
