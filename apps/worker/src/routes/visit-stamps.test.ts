import {featureEnforcementMiddleware} from '../middleware/feature-enforcement.js';
import {Hono} from 'hono';import {describe,it,expect,beforeEach,afterEach,vi} from 'vitest';
import {createTestD1,type SqliteD1} from '../test-utils/d1-sqlite.js';import {visitStamps} from './visit-stamps.js';import type {Env} from '../index.js';import {saveStampCard,grantStamps} from '../services/visit-stamps.js';
const tenant='00000000-0000-4000-8000-000000000001';let f:SqliteD1;let card:string;let app:Hono<Env>;let readonly=false;
beforeEach(async()=>{f=createTestD1();for(const a of ['shop','other'])f.raw.prepare('INSERT INTO line_accounts(id,name,channel_id,channel_secret,channel_access_token,tenant_id,login_channel_id) VALUES(?,?,?,\'unused\',\'token\',?,?)').run(a,a,a,tenant,'login-'+a);
 f.raw.exec("INSERT INTO friends(id,line_user_id,line_account_id) VALUES('friend','U-mine','shop'),('other-friend','U-other','other');");f.raw.prepare("INSERT INTO staff_members(id,name,role,api_key,tenant_id) VALUES('staff','店員','admin','unused',?)").run(tenant);
 card=(await saveStampCard(f.db,tenant,{name:'カード',accountIds:['shop'],active:true,expectedVersion:0,settings:{mode:'amount',amountUnit:1000,maxPerVisit:5,firstVisitBonus:0,expiryMonths:null,timezone:'Asia/Tokyo',multipliers:[],rankMultipliers:[],rewards:[{id:'reward',name:'特典',stamps:1}]}})).id;
 readonly=false;app=new Hono<Env>();app.use('/api/visit-stamps/*',async(c,next)=>{c.set('staff',{id:'staff',name:'店員',role:'admin',readOnly:readonly,tenantId:tenant});await next();});app.use('/api/visit-stamps/*',featureEnforcementMiddleware);app.route('/',visitStamps);
 vi.stubGlobal('fetch',vi.fn(async(_url,init)=>{const p=new URLSearchParams(init.body);return p.get('id_token')==='valid'&&p.get('client_id')==='login-shop'?new Response(JSON.stringify({sub:'U-mine'}),{status:200}):new Response('{}',{status:401});}));
});afterEach(()=>{f.raw.close();vi.unstubAllGlobals();});
function call(path:string,method='GET',body?:unknown,token='valid'){return app.request(`https://localhost${path}`,{method,headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},...(body?{body:JSON.stringify(body)}:{})},{DB:f.db} as Env['Bindings']);}
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

it('LIFFはスタッフIDを送らずPINだけで使用し、店員名を受け取る',async()=>{
 const {setStampPin}=await import('../services/visit-stamps.js');await setStampPin(f.db,'shop','staff','1234');
 await grantStamps(f.db,{cardId:card,friendId:'friend',accountId:'shop',count:2,reason:'試験',actorId:'staff',requestId:'pin-grant',kind:'manual'});
 const offered=await call(`/api/liff/visit-stamps/cards/${card}/rewards?accountId=shop`,'POST',{rewardId:'reward',requestId:'pin-offer'});const id=(await offered.json() as any).data.id;
 const result=await call(`/api/liff/visit-stamps/redemptions/${id}/use?accountId=shop`,'POST',{pin:'1234'});expect(result.status).toBe(200);expect((await result.json() as any).data).toMatchObject({staffName:'店員',staffId:'staff'});
});
it('店全体の記録を期間・友だち・種類で絞ってページ送りし、他店を混ぜない',async()=>{
 for(let i=0;i<3;i++)await grantStamps(f.db,{cardId:card,friendId:'friend',accountId:'shop',count:1,reason:'試験',actorId:'staff',requestId:'list-'+i,kind:'manual'});
 const first=await call('/api/visit-stamps/entries?accountId=shop&kind=manual&friendId=friend&page=1&pageSize=2');expect(first.status).toBe(200);const a=(await first.json() as any).data;expect(a.total).toBe(3);expect(a.items).toHaveLength(2);
 const b=(await (await call('/api/visit-stamps/entries?accountId=shop&kind=manual&page=2&pageSize=2')).json() as any).data;expect(b.items).toHaveLength(1);expect(a.items.map((r:any)=>r.id)).not.toContain(b.items[0].id);
 expect((await (await call('/api/visit-stamps/entries?accountId=shop&from=2099-01-01')).json() as any).data.items).toEqual([]);
 expect((await call('/api/visit-stamps/entries?accountId=shop&pageSize=201')).status).toBe(400);
 expect((await (await call('/api/visit-stamps/entries?accountId=other')).json() as any).data.items).toEqual([]);
});
it('紙写真は画像・5MB以内・本人だけ。申請の承認と却下理由を本人に返す',async()=>{
 const storage=new Map<string,Uint8Array>();const bucket={put:vi.fn(async(key:string,bytes:Uint8Array)=>{storage.set(key,bytes)}),get:vi.fn(async(key:string)=>storage.has(key)?{body:storage.get(key)}:null),delete:vi.fn(async(key:string)=>{storage.delete(key)})};
 async function upload(file:File){const body=new FormData();body.append('file',file);return app.request(`https://localhost/api/liff/visit-stamps/cards/${card}/paper-photos?accountId=shop`,{method:'POST',headers:{Authorization:'Bearer valid'},body},{DB:f.db,IMAGES:bucket} as unknown as Env['Bindings']);}
 expect((await upload(new File(['text'],'paper.txt',{type:'text/plain'}))).status).toBe(400);
 expect((await upload(new File(['not image'],'fake.png',{type:'image/png'}))).status).toBe(400);
 expect((await upload(new File([new Uint8Array(5*1024*1024+65537)],'big.png',{type:'image/png'}))).status).toBe(413);
 const photo=await upload(new File([Uint8Array.from([137,80,78,71,13,10,26,10])],'paper.png',{type:'image/png'}));expect(photo.status).toBe(201);const p=(await photo.json() as any).data;
 const own=await app.request(`https://localhost/api/liff/visit-stamps/paper-photos/${p.id}?accountId=shop`,{headers:{Authorization:'Bearer valid'}},{DB:f.db,IMAGES:bucket} as unknown as Env['Bindings']);expect(own.status).toBe(200);expect((await own.arrayBuffer()).byteLength).toBe(8);
 const submit=await call(`/api/liff/visit-stamps/cards/${card}/paper-requests?accountId=shop`,'POST',{photoUrl:p.photoUrl,stamps:3});expect(submit.status).toBe(201);const id=(await submit.json() as any).data.id;
 expect((await call(`/api/liff/visit-stamps/cards/${card}/paper-requests?accountId=shop`,'POST',{photoUrl:'https://outside.test/photo.png',stamps:3})).status).toBe(403);
 const list=`/api/liff/visit-stamps/cards/${card}/paper-requests?accountId=shop`;expect((await (await call(list)).json() as any).data[0].status).toBe('pending');
 expect((await call(`/api/visit-stamps/paper-requests/${id}/review`,'POST',{action:'reject',reason:'写真が不鮮明です'})).status).toBe(200);
 expect((await (await call(list)).json() as any).data[0]).toMatchObject({status:'rejected',reason:'写真が不鮮明です'});
 const res=await call(`/api/liff/visit-stamps/cards/${card}/paper-requests?accountId=shop`,'POST',{photoUrl:p.photoUrl,stamps:3});const second=(await res.json() as any).data.id;
 expect((await call(`/api/visit-stamps/paper-requests/${second}/review`,'POST',{action:'approve',reason:'確認しました'})).status).toBe(200);
 expect((await (await call(list)).json() as any).data.map((r:any)=>r.status).sort()).toEqual(['approved','rejected']);
 f.raw.exec("INSERT INTO friends(id,line_user_id,line_account_id,user_id) VALUES('someone','U-someone','shop','same-person');UPDATE friends SET user_id='same-person' WHERE id='friend'");
 vi.stubGlobal('fetch',vi.fn(async()=>new Response(JSON.stringify({sub:'U-someone'}))));
 expect((await (await call(list)).json() as any).data).toEqual([]);
 expect((await app.request(`https://localhost/api/liff/visit-stamps/paper-photos/${p.id}?accountId=shop`,{headers:{Authorization:'Bearer valid'}},{DB:f.db,IMAGES:bucket} as unknown as Env['Bindings'])).status).toBe(404);
});
it('専用キーを止めるとLIFFも手動押印も拒み、予約キー停止ではLIFFカードが読める',async()=>{
 f.raw.exec("INSERT INTO account_settings(line_account_id,key,value) VALUES('shop','feature.booking','false')");expect((await call('/api/liff/visit-stamps/cards?accountId=shop')).status).toBe(200);
 f.raw.exec("INSERT INTO account_settings(line_account_id,key,value) VALUES('shop','feature.visit_stamps','false')");expect((await call('/api/liff/visit-stamps/cards?accountId=shop')).status).toBe(403);
 expect((await call(`/api/visit-stamps/cards/${card}/grants`,'POST',{accountId:'shop',friendId:'friend',count:1,reason:'試験',requestId:'disabled'})).status).toBe(403);
});
