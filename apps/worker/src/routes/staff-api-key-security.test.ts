import { beforeEach, afterEach, expect, it } from 'vitest';
import { getStaffByApiKey, createAdminSession, createStepUpGrant } from '@line-crm/db';
import { Hono } from 'hono';
import type { Env } from '../worker-env.js';
import { sha256Hex } from '../middleware/auth.js';
import { staffApiKey } from './staff-api-key.js';
import { createTestD1, type SqliteD1 } from '../test-utils/d1-sqlite.js';

let fixture: SqliteD1;
beforeEach(()=>{
  fixture=createTestD1({loginPolicy:'off'});
  fixture.raw.prepare("INSERT INTO staff_members(id,name,role,api_key,is_active) VALUES ('synthetic-staff','Synthetic','staff','lh_synthetic_key',1)").run();
});
afterEach(()=>fixture.raw.close());

it('S04 rejects a revoked staff key even if its old plaintext record still exists',async()=>{
  fixture.raw.prepare("INSERT INTO platform_settings(key,value,updated_by) VALUES ('auth.staff_api_key.revoked_at:synthetic-staff','2026-10-13T00:00:00','synthetic-staff')").run();
  expect(await getStaffByApiKey(fixture.db,'lh_synthetic_key')).toBeNull();
});
it('S04 records the last successful key match without storing the credential in metadata',async()=>{
  expect(await getStaffByApiKey(fixture.db,'lh_synthetic_key')).not.toBeNull();
  const row=fixture.raw.prepare("SELECT value FROM platform_settings WHERE key='auth.staff_api_key.last_used_at:synthetic-staff'").get() as {value:string}|undefined;
  expect(row?.value).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  expect(JSON.stringify(row)).not.toContain('lh_synthetic_key');
});

async function request(method: string, options: { credential?: 'session'|'api-key'; readOnly?: boolean; purpose?: string; grant?: boolean; proxy?: boolean; unbound?: boolean } = {}) {
  const hash = await sha256Hex('synthetic-session');
  const expires = new Date(Date.now()+3600000).toISOString();
  await createAdminSession(fixture.db, hash, 'synthetic-staff', expires);
  if (options.grant !== false) await createStepUpGrant(fixture.db, { tokenHash: await sha256Hex('synthetic-grant'), staffId: 'synthetic-staff', purpose: options.purpose ?? 'auth.api_key', expiresAt: expires, sessionTokenHash: options.unbound ? null : hash });
  const app = new Hono<Env>();
  app.use('*', async(c,next)=>{
    c.set('staff', { id:'synthetic-staff',name:'Synthetic',role:'staff',readOnly:options.readOnly ?? false,credential:options.credential ?? 'session' });
    if (options.proxy) c.set('impersonation', {} as never);
    await next();
  });
  app.route('/',staffApiKey);
  return app.request('/api/auth/api-key',{method,headers:{ Authorization:'Bearer lh_session:synthetic-session', 'X-Step-Up-Token':'synthetic-grant' }},{DB:fixture.db} as Env['Bindings']);
}

it('S04 returns a replacement key once, revokes old keys and sessions, and audits without credentials',async()=>{
  const response = await request('POST');
  expect(response.status).toBe(200);
  expect(response.headers.get('cache-control')).toContain('no-store');
  const body = await response.json() as {data:{apiKey:string;loginRequired:boolean}};
  expect(body.data.apiKey).toMatch(/^lh_[a-f0-9]{64}$/);
  expect(body.data.loginRequired).toBe(true);
  expect(await getStaffByApiKey(fixture.db,'lh_synthetic_key')).toBeNull();
  expect(await getStaffByApiKey(fixture.db,body.data.apiKey)).not.toBeNull();
  expect(fixture.raw.prepare('SELECT COUNT(*) n FROM admin_sessions').get()).toEqual({n:0});
  expect(fixture.raw.prepare('SELECT COUNT(*) n FROM auth_step_up_grants').get()).toEqual({n:0});
  const audits=fixture.raw.prepare('SELECT * FROM audit_events').all();
  expect(audits).toHaveLength(1);
  expect(JSON.stringify(audits)).not.toContain(body.data.apiKey);
  expect(JSON.stringify(audits)).not.toContain('lh_synthetic_key');
  // GET metadata does not repeat the secret; a new authenticated session is required in production.
  const metadata=await request('GET');
  expect(await metadata.text()).not.toContain(body.data.apiKey);
});
it('S04 revoke returns no secret and disables the retired replacement too',async()=>{
  const response=await request('DELETE');
  expect(response.status).toBe(200);
  expect(await response.text()).not.toContain('apiKey');
  const key=(fixture.raw.prepare('SELECT api_key FROM staff_members').get() as {api_key:string}).api_key;
  expect(await getStaffByApiKey(fixture.db,key)).toBeNull();
  expect(await getStaffByApiKey(fixture.db,'lh_synthetic_key')).toBeNull();
});
it.each([{credential:'api-key' as const},{readOnly:true},{proxy:true}])('S04 rejects forbidden credential/access context %j',async options=>{
  expect((await request('POST',options)).status).toBe(403);
  expect((fixture.raw.prepare('SELECT api_key FROM staff_members').get() as {api_key:string}).api_key).toBe('lh_synthetic_key');
});
it.each([{purpose:'operations.control'},{grant:false},{unbound:true}])('S04 rejects missing, unrelated, or unbound confirmation %j',async options=>{
  expect((await request('POST',options)).status).toBe(401);
});
it('S04 atomic key replacement rolls back if the mandatory audit write fails',async()=>{
  fixture.raw.exec("CREATE TRIGGER deny_key_audit BEFORE INSERT ON audit_events BEGIN SELECT RAISE(ABORT,'synthetic audit unavailable'); END;");
  expect((await request('POST')).status).toBe(500);
  expect((fixture.raw.prepare('SELECT api_key FROM staff_members').get() as {api_key:string}).api_key).toBe('lh_synthetic_key');
  expect(fixture.raw.prepare('SELECT COUNT(*) n FROM admin_sessions').get()).toEqual({n:1});
});
