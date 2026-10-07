import {Hono} from 'hono';import {describe,it,expect,beforeEach,afterEach,vi} from 'vitest';
import {createTestD1,type SqliteD1} from '../test-utils/d1-sqlite.js';import {hqBroadcasts} from './hq-broadcasts.js';import {broadcasts} from './broadcasts.js';import type {Env} from '../index.js';
let f:SqliteD1,app:Hono<Env>;
const tenant='00000000-0000-4000-8000-000000000001';
beforeEach(()=>{f=createTestD1();f.raw.prepare("INSERT INTO line_accounts(id,name,channel_id,channel_secret,channel_access_token,tenant_id) VALUES('shop','試験','channel','unused','token',?)").run(tenant);
 f.raw.prepare("INSERT INTO staff_members(id,name,role,api_key,tenant_id) VALUES('owner','統括','owner','unused',?)").run(tenant);f.raw.exec("INSERT INTO friends(id,line_user_id,line_account_id) VALUES('friend','U-friend','shop')");
 app=new Hono<Env>();app.use('/api/*',async(c,next)=>{c.set('staff',{id:'owner',name:'統括',role:'owner',tenantId:tenant,readOnly:false});await next();});app.route('/',hqBroadcasts);app.route('/',broadcasts);
 vi.stubGlobal('fetch',vi.fn(async(url:string)=>new Response(JSON.stringify(url.endsWith('consumption')?{totalUsage:0}:{type:'limited',value:100}),{status:200})));
});afterEach(()=>{f.raw.close();vi.unstubAllGlobals();});
const call=(path:string,method='GET',body?:unknown,confirm=false)=>app.request(path,{method,headers:{'Content-Type':'application/json',...(confirm?{'X-Confirm-Irreversible':'broadcast-send'}:{})},...(body?{body:JSON.stringify(body)}:{})},{DB:f.db} as Env['Bindings']);
describe('統括からの配信API',()=>{
 it('送信確認を要求し、作った店の配信を店側から変更・削除・再送できない',async()=>{
  const r=await call('/api/hq/broadcasts','POST',{requestId:'run',title:'お知らせ',messageType:'text',messageContent:'本文',accountIds:['shop'],accountTagIds:[],excludedAccountIds:[],audience:{kind:'all'},scheduledAt:null});expect(r.status).toBe(201);
  const id=(await r.json() as any).data.id;
  expect((await call(`/api/hq/broadcasts/${id}/send`,'POST',{expectedVersion:1})).status).toBe(428);
  expect((await call(`/api/hq/broadcasts/${id}/send`,'POST',{expectedVersion:1},true)).status).toBe(200);
  const child=(f.raw.prepare('SELECT id FROM broadcasts').get() as {id:string}).id;
  for(const [method,suffix] of [['PUT',''],['DELETE',''],['POST','/stop'],['POST','/retry-failed'],['POST','/send-segment']])expect((await call(`/api/broadcasts/${child}${suffix}`,method,{title:'変更'},true)).status).toBe(403);
 });
 it('担当店だけに制限された管理者は統括の配信を作れない',async()=>{
  f.raw.exec("UPDATE staff_members SET role='admin',account_scope='accounts' WHERE id='owner'");
  expect((await call('/api/hq/broadcasts')).status).toBe(403);
 });
});
