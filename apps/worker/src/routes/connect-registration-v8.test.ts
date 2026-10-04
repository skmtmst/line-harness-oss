import {afterEach,beforeEach,expect,test,vi} from 'vitest';
import {Hono} from 'hono';
import type Database from 'better-sqlite3';
import type {Env} from '../index.js';
import {createTestD1} from '../test-utils/d1-sqlite.js';
const prepared=vi.hoisted(()=>vi.fn());
vi.mock('../services/line-account-connect.js',async importOriginal=>({...await importOriginal<typeof import('../services/line-account-connect.js')>(),prepareLineConnection:prepared}));
vi.mock('../lib/step-up.js',async importOriginal=>({...await importOriginal<typeof import('../lib/step-up.js')>(),sensitiveStepUpSatisfied:async()=>true}));
vi.mock('@line-crm/line-sdk',async importOriginal=>({...await importOriginal<typeof import('@line-crm/line-sdk')>(),LineClient:class{async getFollowerIds(){throw new Error('LINE API error: 403 Forbidden')}}}));
import {lineAccounts} from './line-accounts.js';
let sql:Database.Database,db:D1Database,app:Hono<Env>;
beforeEach(()=>{
 const f=createTestD1({foreignKeys:true});sql=f.raw;db=f.db;
 sql.exec("INSERT INTO tenants(id,name) VALUES ('t','試験'); INSERT INTO line_accounts(id,name,channel_id,channel_access_token,channel_secret,tenant_id) VALUES ('parent','親','test-parent','fixture','fixture','t'); INSERT INTO staff_members(id,name,role,api_key,tenant_id,account_scope) VALUES ('owner','管理','owner','fixture-owner','t','all'),('s','担当','staff','fixture-staff','t','accounts'); INSERT INTO line_account_tags(id,tenant_id,name,created_at,updated_at) VALUES ('tag','t','分類','fixture','fixture')");
 app=new Hono<Env>();app.use('*',async(c,next)=>{c.set('staff',{id:'owner',name:'管理',role:'owner',readOnly:false,tenantId:'t'});await next()});app.route('/',lineAccounts);
 prepared.mockReset();prepared.mockResolvedValue({success:true,channelAccessToken:'fixture-issued',bot:{displayName:'試験公式',pictureUrl:null,basicId:'@fixture'},liffId:'200123-existing',steps:[1,2,3,4].map(order=>({order,state:'passed',message:'確認済み'})),webhook:{expectedUrl:'https://worker.test/webhook',registeredUrl:'https://worker.test/webhook',active:true,testPassed:true}});
});
afterEach(()=>sql.close());
const body={channelId:'123',channelSecret:'fixture-secret',loginChannelId:'200123',loginChannelSecret:'fixture-login',tagIds:['tag'],staffIds:['s'],parentLineAccountId:'parent',liffId:'200123-existing'};
async function request(input:unknown){return app.request('/api/line-accounts/connect',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(input)},{DB:db,WORKER_URL:'https://worker.test',LINE_CREDENTIAL_ENCRYPTION_KEY:btoa('0'.repeat(32))} as Env['Bindings'])}
test('one connect request saves all registration fields without returning credentials',async()=>{
 const response=await request(body),json=await response.json() as any;expect(response.status,JSON.stringify(json)).toBe(201);
 const id=json.data.id;
 expect(sql.prepare('SELECT parent_line_account_id,liff_id FROM line_accounts WHERE id=?').get(id)).toEqual({parent_line_account_id:'parent',liff_id:'200123-existing'});
 expect(sql.prepare('SELECT tag_id FROM line_account_tag_links WHERE line_account_id=?').all(id)).toEqual([{tag_id:'tag'}]);
 expect(sql.prepare('SELECT staff_id FROM staff_account_scopes WHERE line_account_id=?').all(id)).toEqual([{staff_id:'s'}]);
 expect(prepared).toHaveBeenCalledWith(expect.objectContaining({liffId:'200123-existing'}));
 expect(JSON.stringify(json)).not.toContain('fixture-secret');expect(JSON.stringify(json)).not.toContain('fixture-issued');
});
test('invalid references stop before external LINE changes',async()=>{
 expect((await request({...body,tagIds:['missing']})).status).toBe(403);expect(prepared).not.toHaveBeenCalled();
 expect((sql.prepare('SELECT COUNT(*) n FROM line_accounts').get() as {n:number}).n).toBe(1);
});
