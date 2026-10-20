import { sensitiveStepUpSatisfied } from '../lib/step-up.js';
import { afterEach, describe, expect, it } from 'vitest';
import { Hono } from 'hono';
import { app } from '../index.js';
import { type Env } from '../worker-env.js';
import { createTestD1 } from '../test-utils/d1-sqlite.js';
import { sensitiveOperationMiddleware, dangerousOperationPurpose } from './sensitive-step-up.js';
import { DEFAULT_TENANT_ID } from '@line-crm/shared';
import { sha256Hex } from './auth.js';
const opened: ReturnType<typeof createTestD1>[] = [];
afterEach(() => opened.splice(0).forEach(d => d.raw.close()));
describe('dangerous operations require reauthentication before releasing data or mutating', () => {
  it.each([
    ['GET','/api/friends/exports/job/download'], ['POST','/api/common-vars/exports/job/regenerate'], ['GET','/api/events/e/applicants.csv'],
    ['POST','/api/broadcasts/b/send'], ['POST','/api/broadcasts/b/send-segment'],
    ['POST','/api/ops/impersonation/start'], ['POST','/api/ops/impersonation/pii-reveal'],
    ['PATCH','/api/staff/member'], ['POST','/api/ops/members'], ['GET','/api/line-accounts/a/credentials'],
  ])('%s %s stops before the handler with missing, expired, wrong-session and consumed grants', async (method,path) => {
    const db=createTestD1();opened.push(db);
    db.raw.exec("INSERT INTO staff_members(id,name,role,api_key) VALUES ('actor','Fixture','owner','fixture-unused-key')");
    const tokenHash=await sha256Hex('fixture-grant'), sessionHash=await sha256Hex('fixture-session');
    const purpose=dangerousOperationPurpose(method,path)!;
    const a=new Hono<Env>();let reached=0;
    a.use('*',async(c,next)=>{c.set('staff',{id:'actor',name:'Fixture',role:'owner',readOnly:false});await next();});
    a.use('*',sensitiveOperationMiddleware);a.on(method,path,async c=>{if(!await sensitiveStepUpSatisfied(c,purpose))return c.json({code:'STEP_UP_REQUIRED'},401);reached++;return c.text('sensitive fixture');});
    const request=(token?:string,session='fixture-session')=>a.request(path,{method,headers:{Authorization:`Bearer lh_session:${session}`,...token?{'X-Step-Up-Token':token}:{}}},{DB:db.db} as Env['Bindings']);
    expect((await request()).status).toBe(401);expect(reached).toBe(0);
    db.raw.prepare("INSERT INTO admin_sessions(token_hash,staff_id,expires_at) VALUES (?, 'actor', ?)").run(sessionHash,new Date(Date.now()+60000).toISOString());
    db.raw.prepare("INSERT INTO auth_step_up_grants(token_hash,staff_id,purpose,session_token_hash,expires_at,created_at) VALUES (?, 'actor', ?, ?, ?, datetime('now'))").run(tokenHash,purpose,sessionHash,new Date(Date.now()-60000).toISOString());
    expect((await request('fixture-grant')).status).toBe(401);
    db.raw.prepare('UPDATE auth_step_up_grants SET expires_at=?').run(new Date(Date.now()+60000).toISOString());
    expect((await request('fixture-grant','other-session')).status).toBe(401);expect(reached).toBe(0);
    expect((await request('fixture-grant')).status).toBe(200);expect(reached).toBe(1);
    expect((await request('fixture-grant')).status).toBe(401);expect(reached).toBe(1);
  });
  it('also protects format=csv while leaving ordinary lists and auth bootstrap usable',()=>{
    expect(dangerousOperationPurpose('GET','/api/friends','csv')).toBe('data.export');
    expect(dangerousOperationPurpose('GET','/api/friends')).toBeNull();
    expect(dangerousOperationPurpose('POST','/api/auth/step-up')).toBeNull();
  });
});

it.each([
  ['PUT','/api/broadcasts/new'], ['POST','/api/broadcasts/new/send'],['POST','/api/broadcasts/new/retry-failed'],
  ['POST','/api/hq/broadcasts/run/targets/store/retry'],['GET','/api/media/item/download'],
])('mounted application %s %s denies API-key-only requests before sensitive work',async(method,path)=>{
  const db=createTestD1();opened.push(db);
  db.raw.prepare("INSERT INTO line_accounts(id,channel_id,name,channel_access_token,channel_secret,tenant_id) VALUES ('store','fixture-channel','Fixture','unused','unused',?)").run(DEFAULT_TENANT_ID);
  db.raw.exec("INSERT INTO broadcasts(id,title,message_type,message_content,line_account_id) VALUES ('new','Fixture','text','fixture','store'); UPDATE broadcasts SET status='scheduled' WHERE id='new'; INSERT INTO media(id,line_account_id,kind,filename,mime_type,size_bytes,r2_key) VALUES ('item','store','image','fixture.png','image/png',1,'media/fixture.png')");
  const res=await app.request(path,{method,headers:{Authorization:'Bearer fixture-master','CF-Connecting-IP':'203.0.113.47',...method==='PUT'?{'Content-Type':'application/json'}:{}},...method==='PUT'?{body:JSON.stringify({title:'Changed fixture',expectedVersion:1})}:{}},{DB:db.db,API_KEY:'fixture-master',DEPLOY_ENV:'test'} as Env['Bindings']);
  expect(res.status).toBe(401);expect(await res.json()).toMatchObject({success:false,error:{code:'STEP_UP_REQUIRED'}});
});

it.each(['POST','PUT'])('scheduled broadcast %s cannot bypass the guard via create/update',async method=>{
  const db=createTestD1();opened.push(db);const a=new Hono<Env>();let reached=0;
  a.use('*',async(c,next)=>{c.set('staff',{id:'actor',name:'Fixture',role:'owner',readOnly:false});await next();});
  a.use('*',sensitiveOperationMiddleware);a.on(method,'/api/broadcasts/item',c=>{reached++;return c.json({success:true});});
  const send=(saveAsDraft:boolean)=>a.request('/api/broadcasts/item',{method,headers:{'Content-Type':'application/json'},body:JSON.stringify({saveAsDraft,scheduledAt:'2030-01-01T00:00:00Z'})},{DB:db.db} as Env['Bindings']);
  expect((await send(false)).status).toBe(401);expect(reached).toBe(0);
  expect((await send(true)).status).toBe(200);expect(reached).toBe(1);
});

async function concurrentGrantFixture() {
  const db = createTestD1(); opened.push(db);
  db.raw.exec("INSERT INTO staff_members(id,name,role,api_key) VALUES ('actor','Fixture','owner','unused-fixture')");
  const expires = new Date(Date.now() + 60000).toISOString();
  db.raw.prepare('INSERT INTO admin_sessions(token_hash,staff_id,expires_at) VALUES (?, ?, ?)')
    .run(await sha256Hex('session'), 'actor', expires);
  db.raw.prepare(`INSERT INTO auth_step_up_grants(token_hash,staff_id,purpose,session_token_hash,expires_at,created_at) VALUES (?, ?, ?, ?, ?, datetime('now'))`)
    .run(await sha256Hex('grant'), 'actor', 'data.export', await sha256Hex('session'), expires);
  const app = new Hono<Env>();
  app.use('*', async (c, next) => {
    c.set('staff', { id: 'actor', name: 'Fixture', role: 'owner', readOnly: false });
    await next();
  });
  app.get('/export', async c => {
    const checks = await Promise.all(Array.from({ length: 3 }, () => sensitiveStepUpSatisfied(c, 'data.export')));
    return c.json({ checks, otherPurpose: await sensitiveStepUpSatisfied(c, 'secrets.reveal') }, checks.every(Boolean) ? 200 : 401);
  });
  const request = () => app.request('/export', { headers: { Authorization: 'Bearer lh_session:session', 'X-Step-Up-Token': 'grant' } }, { DB: db.db } as Env['Bindings']);
  return { db, request };
}

it('parallel guards in one request share one grant; another purpose and request cannot reuse it', async () => {
  const { db, request } = await concurrentGrantFixture();
  const response = await request();
  expect(response.status).toBe(200);
  expect(await response.json()).toEqual({ checks: [true, true, true], otherPurpose: false });
  expect(db.raw.prepare('SELECT COUNT(*) n FROM auth_step_up_grants WHERE consumed_at IS NOT NULL').get()).toEqual({ n: 1 });
  const replay = await request();
  expect(replay.status).toBe(401);
  expect(await replay.json()).toEqual({ checks: [false, false, false], otherPurpose: false });
});

it('two simultaneous requests cannot spend the same grant twice', async () => {
  const { db, request } = await concurrentGrantFixture();
  const responses = await Promise.all([request(), request()]);
  expect(responses.map(response => response.status).sort()).toEqual([200, 401]);
  expect(db.raw.prepare('SELECT COUNT(*) n FROM auth_step_up_grants WHERE consumed_at IS NOT NULL').get()).toEqual({ n: 1 });
});

it.each(['read-only', 'impersonation'] as const)('%s stops before consuming a grant or releasing output', async mode => {
  const { db } = await concurrentGrantFixture();
  const app = new Hono<Env>(); let reached = 0;
  app.use('*', async (c, next) => {
    c.set('staff', { id: 'actor', name: 'Fixture', role: 'owner', readOnly: mode === 'read-only' });
    if (mode === 'impersonation') c.set('impersonation', { id: 'proxy', tenantId: 'other-tenant', mode: 'write', piiRevealed: true, startedAt: new Date().toISOString() });
    await next();
  });
  app.use('*', sensitiveOperationMiddleware);
  app.get('/api/friends/export', c => { reached++; return c.text('private'); });
  const response = await app.request('/api/friends/export', { headers: { Authorization: 'Bearer lh_session:session', 'X-Step-Up-Token': 'grant' } }, { DB: db.db } as Env['Bindings']);
  expect(response.status).toBe(403); expect(reached).toBe(0);
  expect(db.raw.prepare('SELECT COUNT(*) n FROM auth_step_up_grants WHERE consumed_at IS NOT NULL').get()).toEqual({ n: 0 });
});
