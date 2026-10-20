import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Hono } from 'hono';
import { createTestD1, type SqliteD1 } from '../test-utils/d1-sqlite.js';
import { signedLiffState } from '../test-utils/liff-oauth.js';
import { navigationProof } from '../lib/navigation-proof.js';
import { signCrossAccountToken } from '../lib/cross-account-token.js';
import { liffRoutes } from './liff.js';
import type { Env } from '../worker-env.js';

let f: SqliteD1;
let env: Env['Bindings'];
const instance = new Hono<Env>().route('/', liffRoutes);
beforeEach(() => {
  f = createTestD1();
  f.raw.exec(`INSERT INTO tenants(id,name) VALUES('tenant','Tenant');
    INSERT INTO line_accounts(id,channel_id,name,channel_access_token,channel_secret,tenant_id,liff_id,login_channel_id,login_channel_secret)
    VALUES('a','ch-a','A','','','tenant','100-a','login-a','login-secret');
    INSERT INTO friends(id,line_user_id,line_account_id) VALUES('friend','Ufriend','a');
    INSERT INTO users(id,tenant_id,display_name) VALUES('source','tenant','Source'),('existing','tenant','Existing');`);
  env = { DB: f.db, LINE_CHANNEL_SECRET: 'secret', LINE_LOGIN_CHANNEL_ID: 'login-a', LINE_LOGIN_CHANNEL_SECRET: 'login-secret', LINE_CHANNEL_ACCESS_TOKEN: 'fake-token', LIFF_URL: 'https://liff.line.me/100-a' } as Env['Bindings'];
  vi.stubGlobal('fetch', vi.fn(async (url: string) => {
    if (url.includes('/oauth2/v2.1/token')) return Response.json({ access_token: 'mock', id_token: 'mock' });
    if (url.includes('/oauth2/v2.1/verify')) return Response.json({ sub: 'Ufriend', name: 'Friend' });
    if (url.endsWith('/v2/profile')) return Response.json({ userId: 'Ufriend', displayName: 'Friend' });
    if (url.endsWith('/v2/bot/info')) return Response.json({ basicId: '@test' });
    throw new Error('No real external requests');
  }));
});
afterEach(() => { vi.unstubAllGlobals(); f.raw.close(); });

async function callback(data: Record<string, string>, cookieOverride?: string) {
  const signed = await signedLiffState(env.LINE_CHANNEL_SECRET, data);
  return instance.request(`https://worker.test/auth/callback?code=mock&state=${encodeURIComponent(signed.state)}`, { headers: { Cookie: cookieOverride ?? signed.cookie } }, env);
}

describe('OAuth and cross-account navigation', () => {
  it('F7: raw uid never chooses a user, even in otherwise valid signed state', async () => {
    expect((await callback({ account: 'ch-a', uid: 'source' })).status).toBe(200);
    const row = f.raw.prepare('SELECT user_id FROM friends WHERE id=?').get('friend') as { user_id: string };
    expect(row.user_id).not.toBe('source');
    expect(row.user_id).toBeTruthy();
    expect(f.raw.prepare('SELECT tenant_id FROM users WHERE id=?').get(row.user_id)).toEqual({ tenant_id: 'tenant' });
  });
  it('F7: unsigned or browser-mismatched state cannot reach token exchange or data writes', async () => {
    const raw = btoa(JSON.stringify({ account: 'ch-a', uid: 'source' }));
    expect((await instance.request(`/auth/callback?code=mock&state=${raw}`, {}, env)).status).toBe(400);
    expect((await callback({ account: 'ch-a' }, 'lh_liff_oauth=another-browser')).status).toBe(400);
    expect(fetch).not.toHaveBeenCalled();
    expect(f.raw.prepare('SELECT user_id FROM friends WHERE id=?').get('friend')).toEqual({ user_id: null });
  });
  it('F4/F25: unsigned external redirects fail while authenticated wrapped destinations still work', async () => {
    f.raw.exec(`INSERT INTO account_styles(line_account_id,style,selection_mode,selected_at,updated_at,answers_json)
      VALUES('a','consult','configured',datetime('now'),datetime('now'),'{"privateAnswer":"hidden"}')`);
    const target = 'https://business.example/thanks';
    const unsigned = await callback({ account: 'ch-a', redirect: target });
    expect(unsigned.headers.get('location')).toBeNull();
    const proof = await navigationProof('secret', 'redirect:100-a', target);
    const signed = await callback({ account: 'ch-a', redirect: target, redirectProof: proof });
    expect(signed.headers.get('location')).toBe(target);
    const config = await instance.request(`/api/liff/config?liffId=100-a&redirect=${encodeURIComponent(target)}&redirectProof=${proof}`, {}, env);
    expect(config.status).toBe(200);
    expect(config.headers.get('Cache-Control')).toBe('no-store');
    const body = await config.json();
    expect(body).toMatchObject({ data: { style: 'consult', accountId: 'a', redirectTarget: target } });
    expect(JSON.stringify(body)).not.toMatch(/privateAnswer|answers_json|selection_mode|login-secret/);
    const changed = await instance.request(`/api/liff/config?liffId=100-a&redirect=https://evil.example&redirectProof=${proof}`, {}, env);
    expect(await changed.json()).toMatchObject({ data: { style: 'consult', redirectTarget: null } });
  });
  async function link(token: string, cookie = 'browser-secret', confirmed = true) {
    return instance.request('/api/liff/link', { method: 'POST', headers: { 'content-type': 'application/json', Cookie: `__Host-lh_cross_account=${cookie}` }, body: JSON.stringify({ idToken: 'mock', crossAccountToken: token, confirmCrossAccountLink: confirmed }) }, env);
  }
  it('F8: forwarded tokens, absent confirmation and changing an existing identity are rejected', async () => {
    const token = await signCrossAccountToken('secret', { userId: 'source', targetAccountId: 'a', browserNonce: 'browser-secret' });
    expect((await link(token, 'victim-browser')).status).toBe(400);
    expect((await link(token, 'browser-secret', false)).status).toBe(400);
    f.raw.exec("UPDATE friends SET user_id='existing' WHERE id='friend'");
    expect((await link(token)).status).toBe(400);
    expect(f.raw.prepare('SELECT user_id FROM friends WHERE id=?').get('friend')).toEqual({ user_id: 'existing' });
  });
  it('F8: confirmed browser-bound linking succeeds only once', async () => {
    const token = await signCrossAccountToken('secret', { userId: 'source', targetAccountId: 'a', browserNonce: 'browser-secret' });
    expect((await link(token)).status).toBe(200);
    expect((await link(token)).status).toBe(400);
    expect(f.raw.prepare('SELECT user_id FROM friends WHERE id=?').get('friend')).toEqual({ user_id: 'source' });
  });
});
