import {Hono} from 'hono';import {describe,it,expect,beforeEach,afterEach,vi} from 'vitest';
import {createTestD1,type SqliteD1} from '../test-utils/d1-sqlite.js';import {visitStamps} from './visit-stamps.js';import type {Env} from '../index.js';import {saveStampCard,grantStamps} from '../services/visit-stamps.js';
const tenant='00000000-0000-4000-8000-000000000001';let f:SqliteD1;let card:string;let app:Hono<Env>;let readonly=false;
beforeEach(async()=>{f=createTestD1();for(const a of ['shop','other'])f.raw.prepare('INSERT INTO line_accounts(id,name,channel_id,channel_secret,channel_access_token,tenant_id,login_channel_id) VALUES(?,?,?,\'unused\',\'token\',?,?)').run(a,a,a,tenant,'login-'+a);
 f.raw.exec("INSERT INTO friends(id,line_user_id,line_account_id) VALUES('friend','U-mine','shop'),('other-friend','U-other','other');");f.raw.prepare("INSERT INTO staff_members(id,name,role,api_key,tenant_id) VALUES('staff','店員','admin','unused',?)").run(tenant);
 card=(await saveStampCard(f.db,tenant,{name:'カード',accountIds:['shop'],active:true,expectedVersion:0,settings:{mode:'amount',amountUnit:1000,maxPerVisit:5,firstVisitBonus:0,expiryMonths:null,timezone:'Asia/Tokyo',multipliers:[],rankMultipliers:[],rewards:[{id:'reward',name:'特典',stamps:1}]}})).id;
 readonly=false;app=new Hono<Env>();app.use('/api/visit-stamps/*',async(c,next)=>{c.set('staff',{id:'staff',name:'店員',role:'admin',readOnly:readonly,tenantId:tenant});await next();});app.route('/',visitStamps);
 vi.stubGlobal('fetch',vi.fn(async(_url,init)=>{const p=new URLSearchParams(init.body);return p.get('id_token')==='valid'&&p.get('client_id')==='login-shop'?new Response(JSON.stringify({sub:'U-mine'}),{status:200}):new Response('{}',{status:401});}));
});afterEach(()=>{f.raw.close();vi.unstubAllGlobals();});
function call(path:string,method='GET',body?:unknown,token='valid'){return app.request(path,{method,headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},...(body?{body:JSON.stringify(body)}:{})},{DB:f.db} as Env['Bindings']);}
describe('スタンプAPIの本人・店舗・権限',()=>{
 it('LIFFは指定店舗のIDトークンでだけ本人のカードを読む',async()=>{
  expect((await call('/api/liff/visit-stamps/cards?accountId=shop')).status).toBe(200);
  expect((await call('/api/liff/visit-stamps/cards?accountId=shop','GET',undefined,'invalid')).status).toBe(401);
  expect((await call('/api/liff/visit-stamps/cards?accountId=other')).status).toBe(401);
 });
 it('LIFFの特典選択では使用済みにならず、PINなしの使用を拒否する',async()=>{
  await grantStamps(f.db,{cardId:card,friendId:'friend',accountId:'shop',count:2,reason:'試験',actorId:'staff',requestId:'grant',kind:'manual'});
  const r=await call(`/api/liff/visit-stamps/cards/${card}/rewards?accountId=shop`,'POST',{rewardId:'reward',requestId:'request'});expect(r.status).toBe(201);
  const id=(await r.json() as any).data.id;
  expect((await call(`/api/liff/visit-stamps/redemptions/${id}/use?accountId=shop`,'POST',{staffId:'staff'})).status).toBe(400);
  expect(f.raw.prepare('SELECT status FROM visit_stamp_redemptions').get()).toEqual({status:'offered'});
 });
 it('会計を後から記録すると金額で押し、再送でも押印数を増やさない',async()=>{
  f.raw.exec("INSERT INTO rt_organizations(id,account_id,name) VALUES('org','shop','試験');INSERT INTO rt_stores(id,organization_id,name,code,line_account_id) VALUES('store','org','店','STORE','shop');INSERT INTO rt_reservations(id,store_id,source,customer_name,guest_count,starts_at,ends_at,status,line_uid) VALUES('visit','store','walk_in','試験',1,datetime('now'),datetime('now','+1 hour'),'visited','U-mine')");
  const url='/api/visit-stamps/visits/restaurant/visit/checkout';expect((await call(url,'POST',{amount:3500})).status).toBe(200);expect((await call(url,'POST',{amount:3500})).status).toBe(200);
  expect(f.raw.prepare('SELECT balance FROM visit_stamp_wallets').get()).toEqual({balance:3});expect((await call(url,'POST',{amount:4500})).status).toBe(409);
 });
 it('閲覧のみは押印・設定を変更できず、別店舗の友だちも押せない',async()=>{
  const input={accountId:'shop',friendId:'other-friend',count:1,reason:'試験',requestId:'wrong'};
  expect((await call(`/api/visit-stamps/cards/${card}/grants`,'POST',input)).status).toBe(403);
  readonly=true;expect((await call(`/api/visit-stamps/cards/${card}/grants`,'POST',{...input,friendId:'friend'})).status).toBe(403);
 });
});
