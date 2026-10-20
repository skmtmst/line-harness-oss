import { afterEach,beforeEach,describe,expect,it } from 'vitest';
import { Hono } from 'hono';
import type { Env } from '../worker-env.js';
import { personalDataRetention } from './personal-data-retention.js';
import { createTestD1 } from '../test-utils/d1-sqlite.js';
import { sha256Hex } from '../middleware/auth.js';
let db:ReturnType<typeof createTestD1>;
beforeEach(async()=>{db=createTestD1({foreignKeys:false});db.raw.exec(`INSERT INTO line_accounts(id,channel_id,name,channel_access_token,channel_secret,tenant_id) VALUES ('a','a','Fixture','unused','unused','ta'),('b','b','Other','unused','unused','tb');
INSERT INTO staff_members(id,name,role,api_key,tenant_id) VALUES ('actor','Fixture','owner','unused-fixture','ta');`);
  db.raw.prepare('INSERT INTO admin_sessions(token_hash,staff_id,expires_at,step_up_at) VALUES (?,?,?,?)').run(await sha256Hex('fixture-session'),'actor',new Date(Date.now()+60000).toISOString(),new Date().toISOString());
});afterEach(()=>db.raw.close());
function app(role:'owner'|'admin'|'staff'='owner',readOnly=false){const a=new Hono<Env>();a.use('*',async(c,next)=>{c.set('staff',{id:'actor',name:'Fixture',role,tenantId:'ta',readOnly});await next();});a.route('/',personalDataRetention);return a;}
const path='/api/account-settings/personal-data-retention';
const policy={enabled:true,hold:false,responseDays:30,blockedFriendDays:365};
const request=(accountId='a',version=0,session=true)=>({method:'PUT',headers:{'Content-Type':'application/json',...session?{Authorization:'Bearer lh_session:fixture-session'}:{}},body:JSON.stringify({accountId,expectedVersion:version,policy})});
describe('retention policy is scoped, permissioned, versioned and reauthenticated',()=>{
  it('returns the disabled proposal, saves after step-up, rejects stale versions, and honors the stored versioned policy',async()=>{
    const a=app(),env={DB:db.db} as Env['Bindings'];const initial=await a.request(path+'?accountId=a',{},env);expect(await initial.json()).toMatchObject({data:{version:0,policy:{enabled:false}}});
    const saved=await a.request(path,request(),env);expect(saved.status).toBe(200);expect(await saved.json()).toMatchObject({data:{version:1,policy}});
    expect((await a.request(path,request(),env)).status).toBe(409);
    expect(await (await a.request(path+'?accountId=a',{},env)).json()).toMatchObject({data:{version:1,policy}});
  });
  it('refuses foreign stores before saving and never returns their settings',async()=>{
    const env={DB:db.db} as Env['Bindings'];expect((await app().request(path+'?accountId=b',{},env)).status).toBe(403);expect((await app().request(path,request('b'),env)).status).toBe(403);expect(db.raw.prepare('SELECT COUNT(*) n FROM account_settings').get()).toEqual({n:0});
  });
  it('missing reauthentication, read-only and staff cannot change retention',async()=>{
    const env={DB:db.db} as Env['Bindings'];expect((await app().request(path,request('a',0,false),env)).status).toBe(401);
    expect((await app('owner',true).request(path,request(),env)).status).toBe(403);expect((await app('staff').request(path,request(),env)).status).toBe(403);expect(db.raw.prepare('SELECT COUNT(*) n FROM account_settings').get()).toEqual({n:0});
  });
});

it('audit failure rolls back the policy change instead of enabling deletion without evidence',async()=>{
  db.raw.exec("CREATE TRIGGER fixture_audit_fail BEFORE INSERT ON audit_events BEGIN SELECT RAISE(ABORT,'fixture_failure'); END;");
  const res=await app().request(path,request(),{DB:db.db} as Env['Bindings']);expect(res.status).toBe(500);
  expect(db.raw.prepare('SELECT COUNT(*) n FROM account_settings').get()).toEqual({n:0});
});

it('simultaneous saves have one winner and one policy audit, without overwriting the winner', async () => {
  const target = app(), env = { DB: db.db } as Env['Bindings'];
  const responses = await Promise.all([target.request(path, request(), env), target.request(path, request(), env)]);
  expect(responses.map(response => response.status).sort()).toEqual([200, 409]);
  expect(db.raw.prepare("SELECT COUNT(*) n FROM audit_events WHERE action='privacy.retention.policy'").get()).toEqual({ n: 1 });
  expect(await (await target.request(path + '?accountId=a', {}, env)).json()).toMatchObject({ data: { version: 1, policy } });
});

it.each([null, [], 'enabled', { ...policy, responseDays: '30' }, { ...policy, blockedFriendDays: 3651 }])('rejects malformed policy %j without saving or auditing success', async invalid => {
  const init = request(); init.body = JSON.stringify({ accountId: 'a', expectedVersion: 0, policy: invalid });
  const response = await app().request(path, init, { DB: db.db } as Env['Bindings']);
  expect(response.status).toBe(422);
  expect(db.raw.prepare('SELECT COUNT(*) n FROM account_settings').get()).toEqual({ n: 0 });
  expect(db.raw.prepare("SELECT COUNT(*) n FROM audit_events WHERE action='privacy.retention.policy'").get()).toEqual({ n: 0 });
});
