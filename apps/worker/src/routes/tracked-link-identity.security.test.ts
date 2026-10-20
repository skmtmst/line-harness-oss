import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createTestD1, type SqliteD1 } from '../test-utils/d1-sqlite.js';
import { Hono } from 'hono';
import type { Env } from '../worker-env.js';
import { tenantPublicBoundaryMiddleware } from '../middleware/tenant-public-boundary.js';
import { trackedLinks } from './tracked-links.js';
import { issueTrackedLinkIdentity } from '../services/tracked-link-identity.js';
import { appendFriendToTrackedLinks } from '../services/auto-track.js';
import { getTrackedLinkById, getLinkClicks } from '@line-crm/db';
import { navigationProof } from '../lib/navigation-proof.js';
const jobs = vi.hoisted(() => ({ record: vi.fn(), process: vi.fn() }));
vi.mock('../services/tracked-click-steps.js', () => ({ recordTrackedClick: jobs.record, processTrackedClick: jobs.process }));
let fixture: SqliteD1;
let env: Env['Bindings'];
let tokenValid: boolean;
const app = new Hono<Env>().use('/api/liff/*', tenantPublicBoundaryMiddleware).route('/', trackedLinks);
const ctx = { waitUntil: () => {}, passThroughOnException: () => {} } as unknown as ExecutionContext;
beforeEach(() => {
  fixture = createTestD1({ foreignKeys: false });
  fixture.raw.exec(`INSERT INTO line_accounts(id,channel_id,name,channel_access_token,channel_secret,login_channel_id)
    VALUES('a','bot-a','A','token','secret-a','login-a'),('b','bot-b','B','token','secret-b','login-b');
    INSERT INTO friends(id,line_user_id,line_account_id) VALUES('fa','Ua','a'),('fa2','Ua2','a'),('fb','Ub','b'),('legacy','Ulegacy',NULL);
    INSERT INTO scenarios(id,name,trigger_type,line_account_id) VALUES('sc-b','B','manual','b');
    INSERT INTO tracked_links(id,name,original_url,line_account_id,short_code,tag_id)
    VALUES('link-a','A','https://destination.test','a','short-a','tag-a'),('link-b','B','https://destination.test','b','short-b',NULL),
      ('link-null','Legacy','https://destination.test',NULL,'short-null',NULL);`);
  env = { DB: fixture.db, WORKER_URL: 'https://worker.test', LINE_LOGIN_CHANNEL_ID: 'login-a' } as Env['Bindings'];
  jobs.record.mockImplementation(async (_db, plan) => ({ id: 'click', plan }));
  jobs.process.mockResolvedValue(undefined);
  tokenValid = true;
  vi.stubGlobal('fetch', vi.fn(async (_url: string, init?: RequestInit) => {
    const channel = new URLSearchParams(init?.body as string).get('client_id');
    return tokenValid && channel === 'login-a' ? Response.json({ sub: 'Ua' }) : new Response('{}', { status: 400 });
  }));
});
afterEach(() => { fixture.raw.close(); vi.unstubAllGlobals(); vi.useRealTimers(); });
function click(query = '', link = 'short-a') {
  return app.request(`https://worker.test/t/${link}${query}`, { redirect: 'manual' }, env, ctx);
}
async function token(friend = 'fa', linkId = 'link-a') {
  const link = (await getTrackedLinkById(fixture.db, linkId))!;
  return (await issueTrackedLinkIdentity(fixture.db, link, friend))!;
}
function exchange(idToken: unknown = 'valid', linkId = 'short-a') {
  return app.request('https://worker.test/api/liff/tracked-link-identity', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ idToken, linkId }),
  }, env, ctx);
}

describe('tracked click caller identity and current ownership', () => {
  it.each(['?f=fa', '?f=fb', '?lu=Ua', '?lu=Ub', '?f=fa&lu=Ub', '?identity=broken&f=fa'])('keeps unsigned or malformed identity anonymous: %s', async query => {
    expect((await click(query)).status).toBe(302);
    expect(jobs.record).toHaveBeenCalledWith(fixture.db, expect.objectContaining({ friendId: null, conversionPointIds: [] }));
    expect(jobs.process).toHaveBeenCalledWith(env, 'click', expect.objectContaining({ friendId: null }));
  });
  it('accepts signed short and UUID links and ignores unsigned identity overrides', async () => {
    const signed = await token();
    for (const id of ['short-a', 'link-a']) {
      expect((await click(`?identity=${signed}&f=fa2&lu=Ub`, id)).status).toBe(302);
      expect(jobs.record).toHaveBeenLastCalledWith(fixture.db, expect.objectContaining({ friendId: 'fa', accountId: 'a' }));
    }
  });
  it('does not mint identity for a same-account impersonation request or foreign friend', async () => {
    expect(await token('fb')).toBeNull();
    const response = await exchange();
    expect(response.status).toBe(200);
    const body = await response.json() as { data: { token: string } };
    await click(`?identity=${body.data.token}&f=fa2`);
    expect(jobs.record).toHaveBeenLastCalledWith(fixture.db, expect.objectContaining({ friendId: 'fa' }));
    tokenValid = false;
    expect((await exchange()).status).toBe(401);
    expect((await exchange('', 'short-a')).status).toBe(401);
    expect((await exchange('valid', 'short-b')).status).toBe(401);
    expect((await exchange({}, 'short-a')).status).toBe(400);
  });
  it('rejects changed friend, link, signature, stale and future expiry representations', async () => {
    const signed = await token();
    const [payload] = signed.split('.');
    const original = JSON.parse(atob(payload.replaceAll('-', '+').replaceAll('_', '/')));
    const now = Math.floor(Date.now() / 1000);
    for (const data of [
      { ...original, friend: 'fa2' }, { ...original, account: 'b' }, { ...original, link: 'link-b' },
      { ...original, iat: now - 5, exp: now - 1 }, { ...original, iat: now + 1, exp: now + 5 },
      { ...original, exp: now + 31 * 86400 }, { ...original, exp: `${now + 1}` },
    ]) {
      const altered = btoa(JSON.stringify(data)).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '');
      // Even correctly signed expired or malformed claims must be refused.
      const signature = await navigationProof('secret-a', 'tracked-click-identity:v1', altered);
      const candidate = data.friend === 'fa2' ? `${altered}.${signed.split('.')[1]}` : `${altered}.${signature}`;
      await click(`?identity=${candidate}`);
      expect(jobs.record).toHaveBeenLastCalledWith(fixture.db, expect.objectContaining({ friendId: null }));
    }
    await click(`?identity=${signed}`, 'short-b');
    expect(jobs.record).toHaveBeenLastCalledWith(fixture.db, expect.objectContaining({ friendId: null }));
    fixture.raw.prepare('UPDATE friends SET line_account_id=? WHERE id=?').run('b', 'fa');
    await click(`?identity=${signed}`);
    expect(jobs.record).toHaveBeenLastCalledWith(fixture.db, expect.objectContaining({ friendId: null }));
    fixture.raw.exec("INSERT INTO tenants(id,name)VALUES('other-tenant','Other'); UPDATE line_accounts SET tenant_id='other-tenant' WHERE id='a'");
    fixture.raw.prepare('UPDATE friends SET line_account_id=NULL WHERE id=?').run('fa');
    await click(`?identity=${signed}`);
    expect(jobs.record).toHaveBeenLastCalledWith(fixture.db, expect.objectContaining({ friendId: null }));
  });
  it('uses scenario ownership and refuses NULL account crossing', async () => {
    fixture.raw.exec("UPDATE tracked_links SET line_account_id=NULL,scenario_id='sc-b' WHERE id='link-a'");
    expect(await token('fa')).toBeNull();
    const signed = await token('fb');
    await click(`?identity=${signed}`);
    expect(jobs.record).toHaveBeenLastCalledWith(fixture.db, expect.objectContaining({ friendId: 'fb', accountId: 'b' }));
    expect(await token('fa', 'link-null')).toBeNull();
  });
  it('decorates each pushed recipient with a valid signed identity and strips old raw identity', async () => {
    const decorated = await appendFriendToTrackedLinks(fixture.db, 'https://worker.test/t/short-a?f=fb', 'https://worker.test', 'fa');
    const url = new URL(decorated);
    expect(url.searchParams.has('f')).toBe(false);
    expect(url.searchParams.get('identity')).toBeTruthy();
    await click(url.search);
    expect(jobs.record).toHaveBeenLastCalledWith(fixture.db, expect.objectContaining({ friendId: 'fa' }));
  });
  it('does not issue identity for stopped accounts or inactive links', async () => {
    fixture.raw.exec("UPDATE line_accounts SET is_active=0 WHERE id='a'");
    expect((await exchange()).status).toBe(503);
    expect(await token()).toBeNull();
    fixture.raw.exec("UPDATE tracked_links SET is_active=0 WHERE id='link-a'");
    expect((await exchange()).status).toBe(404);
  });
  it('refuses orphaned scenario ownership and suspending tenants even for previously valid signatures', async () => {
    const signed = await token();
    fixture.raw.exec("INSERT INTO tenants(id,name,status)VALUES('tenant-a','A','suspended'); UPDATE line_accounts SET tenant_id='tenant-a' WHERE id='a'");
    await click(`?identity=${signed}`);
    expect(jobs.record).toHaveBeenLastCalledWith(fixture.db, expect.objectContaining({ friendId: null }));
    expect((await exchange()).status).toBe(503);
    fixture.raw.exec("UPDATE tracked_links SET line_account_id=NULL,scenario_id='missing' WHERE id='link-a'; UPDATE line_accounts SET is_default=1,tenant_id=NULL WHERE id='a'");
    expect(await token('legacy')).toBeNull();
    expect((await exchange()).status).toBe(404);
  });
  it('supports legacy NULL identities only with the default tenant signing account', async () => {
    fixture.raw.exec("UPDATE line_accounts SET is_default=1 WHERE id='a'");
    const signed = await token('legacy', 'link-null');
    expect(signed).toBeTruthy();
    await click(`?identity=${signed}`, 'short-null');
    expect(jobs.record).toHaveBeenLastCalledWith(fixture.db, expect.objectContaining({ friendId: 'legacy', accountId: null }));
    fixture.raw.exec("UPDATE friends SET line_account_id='a' WHERE id='legacy'");
    await click(`?identity=${signed}`, 'short-null');
    expect(jobs.record).toHaveBeenLastCalledWith(fixture.db, expect.objectContaining({ friendId: null }));
  });
  it('keeps verified default-tenant NULL friends and their click history visible', async () => {
    fixture.raw.exec("UPDATE friends SET line_account_id=NULL WHERE id='fa'");
    const response = await exchange();
    expect(response.status).toBe(200);
    const body = await response.json() as { data: { token: string } };
    await click(`?identity=${body.data.token}`);
    expect(jobs.record).toHaveBeenLastCalledWith(fixture.db, expect.objectContaining({ friendId: 'fa', accountId: 'a', identityVerified: true }));
    fixture.raw.exec("INSERT INTO link_clicks(id,tracked_link_id,friend_id,clicked_at)VALUES('legacy-click','link-a','fa','2026-01-01')");
    expect((await getLinkClicks(fixture.db, 'link-a'))[0].friend_id).toBe('fa');
  });
  it('rejects NULL friends outside the default tenant and a friend reassigned to another account', async () => {
    const signed = await token('legacy');
    expect(signed).toBeTruthy();
    fixture.raw.exec("INSERT INTO link_clicks(id,tracked_link_id,friend_id,clicked_at)VALUES('legacy-click','link-a','legacy','2026-01-01'); INSERT INTO tenants(id,name)VALUES('other','Other'); UPDATE line_accounts SET tenant_id='other' WHERE id='a'");
    expect(await token('legacy')).toBeNull();
    await click(`?identity=${signed}`);
    expect(jobs.record).toHaveBeenLastCalledWith(fixture.db, expect.objectContaining({ friendId: null }));
    expect((await getLinkClicks(fixture.db, 'link-a'))[0].friend_id).toBeNull();
    fixture.raw.exec("UPDATE line_accounts SET tenant_id=NULL WHERE id='a'; UPDATE friends SET line_account_id='b' WHERE id='legacy'");
    await click(`?identity=${signed}`);
    expect(jobs.record).toHaveBeenLastCalledWith(fixture.db, expect.objectContaining({ friendId: null }));
  });
  it('hides foreign historical friend IDs and names from link click history', async () => {
    fixture.raw.exec(`INSERT INTO link_clicks(id,tracked_link_id,friend_id,clicked_at) VALUES
      ('bad','link-a','fb','2026-01-01'),('good','link-a','fa','2026-01-02');`);
    const clicks = await getLinkClicks(fixture.db, 'link-a');
    expect(clicks.find(row => row.id === 'bad')).toMatchObject({ friend_id: null, friend_display_name: null });
    expect(clicks.find(row => row.id === 'good')?.friend_id).toBe('fa');
  });
});
