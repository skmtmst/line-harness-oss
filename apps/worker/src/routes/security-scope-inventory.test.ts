import { afterEach, describe, expect, it } from 'vitest';
import { Hono } from 'hono';
import type { Env } from '../worker-env.js';
import { DEFAULT_TENANT_ID } from '@line-crm/shared';
import { tenantScopeMiddleware } from '../middleware/tenant-scope.js';
import { profileRefresh } from './profile-refresh.js';
import { usersGrouped } from './users-grouped.js';
import { stripe } from './stripe.js';
import { trafficPools } from './traffic-pools.js';
import { googleSheets } from './google-sheets.js';
import { createTestD1 } from '../test-utils/d1-sqlite.js';

const opened: ReturnType<typeof createTestD1>[] = [];
afterEach(() => { opened.splice(0).forEach(db => db.raw.close()); });
function fixture() {
  const db = createTestD1({ foreignKeys: false }); opened.push(db);
  db.raw.exec(`INSERT INTO line_accounts (id,channel_id,name,channel_access_token,channel_secret,tenant_id)
    VALUES ('a','ca','Own store','unused','unused','ta'), ('b','cb','Other store','unused','unused','tb');
    INSERT INTO staff_members(id,name,role,api_key,tenant_id) VALUES ('sa','Own staff','owner','unused-a','ta'),('sb','Other staff','owner','unused-b','tb');
    INSERT INTO friends(id,line_user_id,line_account_id,display_name,picture_url,metadata)
      VALUES ('fa','Ua','a','Own fixture','https://profile.line-scdn.net/identity-fixture','{"email":"own@example.invalid"}'),
      ('fb','Ub','b','Other fixture','https://profile.line-scdn.net/identity-fixture','{"email":"other@example.invalid"}');
    INSERT INTO tags(id,name,line_account_id) VALUES ('tag-a','shared','a'),('tag-b','shared','b');
    INSERT INTO friend_tags(friend_id,tag_id) VALUES ('fa','tag-a'),('fb','tag-b');
    INSERT INTO messages_log(id,friend_id,direction,message_type,content,line_account_id)
      VALUES ('mb','fb','outgoing','text','fixture-content','b');
    INSERT INTO stripe_events(id,stripe_event_id,event_type,friend_id,amount,processed_at)
      VALUES ('ea','sea','payment','fa',1,'2026-10-16'),('eb','seb','payment','fb',2,'2026-10-16');
    INSERT INTO traffic_pools(id,slug,name,active_account_id,created_at,updated_at)
      VALUES ('pa','own','Own pool','a','2026-10-16','2026-10-16'),('pb','other','Other pool','b','2026-10-16','2026-10-16');`);
  return db;
}
function server(db: ReturnType<typeof createTestD1>, router: Hono<Env>, tenantId = 'ta', role: 'owner'|'admin'|'staff' = 'owner') {
  const app = new Hono<Env>();
  app.use('*', async (c, next) => {
    c.set('staff', { id: tenantId === 'ta' ? 'sa' : 'sb', name: 'Fixture', role, readOnly: false, tenantId });
    await next();
  });
  app.use('*', tenantScopeMiddleware);
  app.route('/', router);
  return { request: (path: string, init?: RequestInit) => app.request(path, init, { DB: db.db } as Env['Bindings']) };
}
const post = (data: unknown): RequestInit => ({ method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) });

describe('S07 unqualified resource IDs and aggregate requests stay in the staff account scope', () => {
  it.each(['owner','admin','staff'] as const)('grouped users: %s never receives another store member or merged private contact', async role => {
    const db = fixture();
    const response = await server(db, usersGrouped, 'ta', role).request('/api/users-grouped');
    expect(response.status).toBe(200);
    const body = await response.json() as any;
    expect(body.data.total).toBe(1);
    expect(body.data.rows[0].accounts.map((a: any) => a.accountId)).toEqual(['a']);
    expect(JSON.stringify(body)).not.toContain('other@example.invalid');
    expect(JSON.stringify(body)).not.toContain('Other fixture');
    // Same binding and same isolate cache, different tenant. A cache warmed by
    // the first caller must never supply their records to the second caller.
    const other = await server(db, usersGrouped, 'tb', role).request('/api/users-grouped');
    const second = await other.json() as any;
    expect(second.data.rows[0].accounts.map((a: any) => a.accountId)).toEqual(['b']);
    expect(JSON.stringify(second)).not.toContain('own@example.invalid');
  });
  it('grouped user cache is also isolated between database bindings', async () => {
    const first = fixture(), second = fixture();
    second.raw.exec("UPDATE friends SET display_name='Second binding' WHERE id='fa'");
    await server(first, usersGrouped).request('/api/users-grouped');
    const response = await server(second, usersGrouped).request('/api/users-grouped');
    expect(JSON.stringify(await response.json())).toContain('Second binding');
  });
  it.each(['owner', 'admin', 'staff'] as const)('%s assigned to one store cannot see the other store in the same tenant', async role => {
    const db = fixture();
    db.raw.exec("UPDATE line_accounts SET tenant_id='ta' WHERE id='b'");
    const app = server(db, usersGrouped, 'ta', role);
    const broad = await (await app.request('/api/users-grouped')).json() as any;
    expect(broad.data.rows[0].accounts).toHaveLength(2);
    db.raw.exec("UPDATE staff_members SET account_scope='accounts' WHERE id='sa'; INSERT INTO staff_account_scopes(staff_id,line_account_id,created_at) VALUES ('sa','a','2026-10-16')");
    const narrow = await (await app.request('/api/users-grouped')).json() as any;
    expect(narrow.data.rows[0].accounts.map((a: any) => a.accountId)).toEqual(['a']);
    const stripeResult = await (await server(db, stripe, 'ta', role).request('/api/integrations/stripe/events')).json() as any;
    expect(stripeResult.data.map((event: any) => event.id)).toEqual(['ea']);
    const pools = await (await server(db, trafficPools, 'ta', role).request('/api/traffic-pools')).json() as any;
    expect(pools.data.map((pool: any) => pool.id)).toEqual(['pa']);
  });
  it.each(['owner','admin','staff'] as const)('Stripe history and pool list: %s only receives owned rows', async role => {
    const db = fixture();
    const app = server(db, stripe, 'ta', role);
    const all = await (await app.request('/api/integrations/stripe/events')).json() as any;
    expect(all.data.map((e: any) => e.id)).toEqual(['ea']);
    const foreign = await (await app.request('/api/integrations/stripe/events?friendId=fb')).json() as any;
    expect(foreign.data).toEqual([]);
    const pools = await (await server(db, trafficPools, 'ta', role).request('/api/traffic-pools')).json() as any;
    expect(pools.data.map((p: any) => p.id)).toEqual(['pa']);
  });
  it('diagnostic aggregates do not count a hidden store or use its message to remove an own tag', async () => {
    const db = fixture(), app = server(db, profileRefresh);
    const content = await app.request('/api/admin/content-leak-check', post({ tagName: 'shared', contentSubstring: 'fixture-content' }));
    expect(content.status).toBe(200);
    expect((await content.json() as any).data).toEqual({ unique_in_tag: 1, same_friend_overlap: 0, person_overlap: 0 });
    const coverage = await app.request('/api/admin/broadcast-coverage', post({ tagName: 'shared', contentSubstring: 'fixture-content' }));
    expect(coverage.status).toBe(200);
    const data = (await coverage.json() as any).data;
    expect(data.perAccount.map((r: any) => r.account_id)).toEqual(['a']);
    expect(data.person).toEqual({ unique_total: 1, unique_received: 0, unique_not_received: 1 });
    expect(data.tagLeakBreakdown[0].person_dup).toBe(0);
    const tags = await app.request('/api/admin/tag-leak-check', post({ tagsA: ['shared'], tagsB: ['shared'] }));
    expect(tags.status).toBe(200);
    expect((await tags.json() as any).data).toEqual({ unique_a: 1, unique_b: 1, leaked: 1 });
    const removed = await app.request('/api/admin/tag-remove-content-dups', post({ tagName: 'shared', contentSubstring: 'fixture-content' }));
    expect(removed.status).toBe(200);
    expect((await removed.json() as any).data.removedRows).toBe(0);
    expect(db.raw.prepare('SELECT COUNT(*) n FROM friend_tags').get()).toEqual({ n: 2 });
    db.raw.exec("INSERT INTO messages_log(id,friend_id,direction,message_type,content,line_account_id) VALUES ('ma','fa','outgoing','text','fixture-content','a')");
    expect((await (await app.request('/api/admin/tag-remove-content-dups', post({ tagName: 'shared', contentSubstring: 'fixture-content' }))).json() as any).data.removedRows).toBe(1);
    expect(db.raw.prepare('SELECT friend_id FROM friend_tags').all()).toEqual([{ friend_id: 'fb' }]);
  });
  it('a broadcast cannot be reset through its bare foreign ID, including deduplicated account sets', async () => {
    const db = fixture(), app = server(db, profileRefresh);
    db.raw.exec(`INSERT INTO broadcasts(id,title,message_type,message_content,status,target_type,line_account_id,account_ids)
      VALUES ('foreign','Foreign fixture','text','fixture','sent','all','b',NULL),
      ('mixed','Mixed fixture','text','fixture','sent','multi-account-dedup','a','["a","b"]'),
      ('foreign-anchor','Foreign owner fixture','text','fixture','sent','multi-account-dedup','b','["a"]'),
      ('own','Own fixture','text','fixture','sent','all','a',NULL);`);
    for (const id of ['foreign','mixed','foreign-anchor']) {
      const response = await app.request(`/api/admin/broadcasts/${id}/reset-to-draft`, post({}));
      expect(response.status).toBe(404);
      expect(db.raw.prepare('SELECT status FROM broadcasts WHERE id=?').get(id)).toEqual({ status: 'sent' });
    }
    expect((await app.request('/api/admin/broadcasts/own/reset-to-draft', post({}))).status).toBe(200);
    expect(db.raw.prepare("SELECT status FROM broadcasts WHERE id='own'").get()).toEqual({ status: 'draft' });
  });
});

it.each([
  '/api/message-templates', '/api/message-templates/foreign', '/api/entry-route-genres',
  '/api/entry-route-genres/foreign', '/api/account-settings/link-base-url',
  '/api/account-settings/tracked-link-base-url', '/api/search-console/performance',
  '/api/nen-members/photo-reward-policy/versions', '/api/manual-links',
])('S07 legacy global resource %s cannot be claimed by another tenant owner/admin', async path => {
  const db = fixture();
  const handler = new Hono<Env>(); handler.all('*', c => c.body(null, 204));
  for (const role of ['owner', 'admin'] as const) {
    for (const method of ['GET','POST','PUT','PATCH','DELETE']) {
      expect((await server(db, handler, 'ta', role).request(path, { method })).status).toBe(403);
    }
  }
  // Legacy default tenant keeps access, but an account-restricted member of
  // that same tenant cannot claim the unassigned data either.
  db.raw.prepare('UPDATE staff_members SET tenant_id=? WHERE id=?').run(DEFAULT_TENANT_ID, 'sb');
  expect((await server(db, handler, DEFAULT_TENANT_ID).request(path)).status).toBe(204);
  db.raw.prepare("UPDATE staff_members SET account_scope='accounts' WHERE id='sb'").run();
  expect((await server(db, handler, DEFAULT_TENANT_ID).request(path)).status).toBe(403);
});


it.each([
  ['POST', '/api/integrations/google-sheets/disconnect'],
  ['PUT', '/api/integrations/google-sheets/target'],
  ['POST', '/api/integrations/google-sheets/sync'],
])('S07 %s %s checks the body account even with an allowed query account', async (method, path) => {
  const db = fixture();
  const app = server(db, googleSheets);
  for (const suffix of ['', '?account_id=a']) {
    const response = await app.request(path + suffix, { ...post({ accountId: 'b', confirmed: true, spreadsheet: 'A'.repeat(44) }), method });
    expect(response.status).toBe(403);
  }
});
