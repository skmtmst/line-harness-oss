import { images } from './images.js';
import { Hono } from 'hono';
import { beforeEach,afterEach,expect,test,vi } from 'vitest';
import { createTestD1,type SqliteD1 } from '../test-utils/d1-sqlite.js';
import { getEffectivePhotoRewardPolicy,ensureLegacyPhotoRewardPolicy } from '@line-crm/db';
import { nenMembers } from './nen-members.js';
import { nenCampaigns } from './nen-campaigns.js';
import { automations } from './automations.js';
import { webhooks,processIncomingWebhookQueue,generateWebhookSecret } from './webhooks.js';
import { processNenDeliveries } from '../services/nen-engagement.js';
import type { Env } from '../worker-env.js';

const fireEvent=vi.hoisted(()=>vi.fn(async()=>{}));
vi.mock('../services/event-bus.js',()=>({fireEvent}));
let t:SqliteD1;
const key=btoa('a'.repeat(32));
const secret='s'.repeat(64);
beforeEach(()=>{
  t=createTestD1();fireEvent.mockClear();
  t.raw.prepare("INSERT INTO line_accounts(id,channel_id,name,channel_access_token,channel_secret) VALUES('a','ch','店','tok','sec')").run();
  t.raw.prepare("INSERT INTO friends(id,line_user_id,line_account_id,is_following) VALUES('f','Uf','a',1)").run();
  t.raw.prepare("INSERT INTO nen_pet_profiles(id,friend_id,name,created_at,updated_at) VALUES('p','f','犬','2026-01-01','2026-01-01')").run();
});
afterEach(()=>{t.raw.close();vi.useRealTimers();});
function app(role:'owner'|'staff'='owner') {
  const app=new Hono<Env>();app.use('*',async(c,next)=>{c.env={DB:t.db,LINE_CREDENTIAL_ENCRYPTION_KEY:key} as Env['Bindings'];c.set('staff',{id:'env-owner',name:'担当',role,readOnly:false,permissionKeys:['/automations','/nen-campaigns']});await next();});
  app.route('/',nenMembers);app.route('/',nenCampaigns);app.route('/',automations);app.route('/',webhooks);return app;
}
test('採用点は版が無くても、初期版を読む操作後でも100',async()=>{
 expect((await getEffectivePhotoRewardPolicy(t.db)).points).toBe(100);
 await ensureLegacyPhotoRewardPolicy(t.db);
 expect((await getEffectivePhotoRewardPolicy(t.db)).points).toBe(100);
});
test('検査待ち・隔離・検査記録なしの写真を審査へ出さない',async()=>{
 for(const status of ['pending','quarantined','clean','missing']) {
  t.raw.prepare("INSERT INTO nen_photo_submissions(id,friend_id,pet_id,r2_key,image_url,review_image_url,content_type,created_at,updated_at,line_account_id) VALUES(?,'f','p',?,'https://test/image','https://test/image','image/png','2026-01-01','2026-01-01','a')").run(status,status);
  if(status!=='missing') t.raw.prepare("INSERT INTO media_file_scans(id,line_account_id,subject_kind,subject_id,filename,mime_type,size_bytes,status,created_at,updated_at) VALUES(?,'a','photo',?,'a.png','image/png',1,?,'2026-01-01','2026-01-01')").run(status,status,status);
 }
 const response=await app().request('/api/nen-members/photos?accountId=a');expect(response.status).toBe(200);
 const body=await response.json() as {data:{id:string}[]};expect(body.data.map((p:{id:string})=>p.id)).toEqual(['clean']);
});
test('ペット削除は履歴を残し、一覧と次回の対象から外す',async()=>{
 const response=await app().request('/api/nen-campaigns/pets/p?lineAccountId=a',{method:'DELETE'});expect(response.status).toBe(200);
 expect(t.raw.prepare("SELECT archived_at FROM nen_pet_profiles WHERE id='p'").get()).toMatchObject({archived_at:expect.any(String)});
 const list=await app().request('/api/nen-campaigns/pets?lineAccountId=a');expect(list.status).toBe(200);
 expect(((await list.json()) as {data:unknown[]}).data).toEqual([]);
});
test.each(['/api/automation-drafts/x/publish','/api/automations/x/status'])('スタッフに公開・停止を許さない %s',async path=>{
 t.raw.prepare("INSERT INTO automation_definitions(id,line_account_id,name,status) VALUES('x','a','ルール','stopped')").run();
 expect((await app('staff').request(path,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({status:'active',lineAccountId:'a'})})).status).toBe(403);
});
function seedJob() {
 t.raw.prepare("INSERT INTO nen_campaign_settings(campaign_key,label,category,title,body_text,created_at,updated_at) VALUES('column','コラム','column','題','本文','2026-01-01','2026-01-01')").run();
 t.raw.prepare(`INSERT INTO nen_delivery_jobs(id,campaign_key,friend_id,line_account_id,source_key,payload,campaign_snapshot,scheduled_at,status,attempts,created_at,updated_at)
 VALUES('j','column','f','a','col','{}',?,'2026-01-01','processing',1,'2026-01-01','2026-01-01')`).run(JSON.stringify({campaign_key:'column',label:'コラム',category:'column',title:'題',body_text:'本文',is_enabled:1,delay_days:0,delivery_time:'10:00'}));
}
test('期限切れの送信中を回収し、同じ操作番号で送る',async()=>{
 seedJob(); const dispatch=vi.fn(async()=>new Response('{}',{status:200}));
 const result=await processNenDeliveries(t.db,{proxyBaseUrl:'https://proxy.invalid',defaultAccessToken:'x',now:new Date('2026-10-16T10:00:00+09:00'),proxyDispatch:dispatch as never});
 expect(result.sent).toBe(1);expect(dispatch).toHaveBeenCalledOnce();
 expect(t.raw.prepare("SELECT status,attempts FROM nen_delivery_jobs WHERE id='j'").get()).toEqual({status:'sent',attempts:2});
});
test('失敗後は1分待ち、期限まで再送しない',async()=>{
 seedJob();t.raw.prepare("UPDATE nen_delivery_jobs SET status='pending',attempts=0").run();
 const now=new Date('2026-10-16T10:00:00+09:00');vi.useFakeTimers();vi.setSystemTime(now);
 const dispatch=vi.fn(async()=>{throw new Error('network');});
 const options={proxyBaseUrl:'https://proxy.invalid',defaultAccessToken:'x',now,proxyDispatch:dispatch as never};
 expect((await processNenDeliveries(t.db,options)).failed).toBe(1);
 expect(t.raw.prepare("SELECT next_attempt_at FROM nen_delivery_jobs WHERE id='j'").get()).toEqual({next_attempt_at:'2026-10-16T01:01:00.000Z'});
 await processNenDeliveries(t.db,options);expect(dispatch).toHaveBeenCalledOnce();
});
async function sign(value:string) {const k=await crypto.subtle.importKey('raw',new TextEncoder().encode(secret),{name:'HMAC',hash:'SHA-256'},false,['sign']);return [...new Uint8Array(await crypto.subtle.sign('HMAC',k,new TextEncoder().encode(value)))].map(b=>b.toString(16).padStart(2,'0')).join('');}
async function receive(timestamp:string,eventId:string,body='{"value":1}',signature?:string) {
 return app().request('/api/webhooks/incoming/w/receive',{method:'POST',headers:{'Content-Type':'application/json','X-Webhook-Timestamp':timestamp,'X-Webhook-Event-Id':eventId,'X-Webhook-Signature':signature??await sign(`${timestamp}.${eventId}.${body}`)},body});
}
function seedWebhook(){t.raw.prepare("INSERT INTO incoming_webhooks(id,name,source_type,secret,line_account_id,is_active) VALUES('w','受信','generic',?,'a',1)").run(secret);}
test('署名は時刻と出来事IDを必須にし、改変と古い受信を拒む',async()=>{
 seedWebhook();const ts=String(Math.floor(Date.now()/1000));
 expect((await receive(ts,'',undefined,await sign('{"value":1}'))).status).toBe(401);
 expect((await receive(String(Number(ts)-301),'event-0001')).status).toBe(401);
 expect((await receive(ts,'event-0002',undefined,await sign(`${ts}.event-0001.{"value":1}`))).status).toBe(401);
});
test('受信は処理前に202を返す。暗号化した待ち行列を回収し一度だけ実行',async()=>{
 seedWebhook();const ts=String(Math.floor(Date.now()/1000));
 const response=await receive(ts,'event-0001');expect(response.status).toBe(202);expect(fireEvent).not.toHaveBeenCalled();
 const queued=t.raw.prepare('SELECT payload_encrypted,status FROM incoming_webhook_queue').get() as {payload_encrypted:string;status:string};
 expect(queued.status).toBe('pending');expect(queued.payload_encrypted).not.toContain('value');
 expect(await processIncomingWebhookQueue({DB:t.db,LINE_CREDENTIAL_ENCRYPTION_KEY:key} as Env['Bindings'])).toBe(1);expect(fireEvent).toHaveBeenCalledOnce();
 expect((await receive(ts,'event-0001')).status).toBe(200);
 expect(await processIncomingWebhookQueue({DB:t.db,LINE_CREDENTIAL_ENCRYPTION_KEY:key} as Env['Bindings'])).toBe(0);expect(fireEvent).toHaveBeenCalledOnce();
});

test('回収後に古い送信役が失敗しても新しい成功を上書きしない',async()=>{
 seedJob();let release!:()=>void;let entered!:()=>void;
 const blocked=new Promise<void>(resolve=>{release=resolve;});const started=new Promise<void>(resolve=>{entered=resolve;});
 let calls=0;const dispatch=vi.fn(async()=>{calls++;if(calls===1){entered();await blocked;throw new Error('network');}return new Response('{}',{status:200});});
 const options={proxyBaseUrl:'https://proxy.invalid',defaultAccessToken:'x',proxyDispatch:dispatch as never};
 const first=processNenDeliveries(t.db,{...options,now:new Date('2026-10-16T10:00:00+09:00')});await started;
 const second=await processNenDeliveries(t.db,{...options,now:new Date('2026-10-16T10:06:00+09:00')});expect(second.sent).toBe(1);
 release();await first;
 expect(t.raw.prepare("SELECT status,last_error FROM nen_delivery_jobs WHERE id='j'").get()).toEqual({status:'sent',last_error:null});
});
test('旧ルールの所属なし・別アカウントを動かさない',async()=>{
 for(const [id,accountId] of [['unassigned',null],['valid','a'],['other','b']])t.raw.prepare("INSERT INTO automations(id,name,event_type,actions,line_account_id) VALUES(?,?,'tag_change','[]',?)").run(id,id,accountId);
 const actual=await vi.importActual<typeof import('../services/event-bus.js')>('../services/event-bus.js');
 await actual.fireEvent(t.db,'tag_change',{friendId:'f',sourceEventId:'scope-event',eventData:{}},undefined,'a');
 expect(t.raw.prepare('SELECT automation_id FROM automation_logs').all()).toEqual([{automation_id:'valid'}]);
});
test('手動以外で付けたタグも、所属と安定した出来事IDを渡す',async()=>{
 t.raw.prepare("INSERT INTO tags(id,name,line_account_id) VALUES('tag','会員','a')").run();
 const {attachTagAndFireSideEffects,detachTagAndFireSideEffects}=await import('../features/friends/friend-tag-attach.js');
 await attachTagAndFireSideEffects(t.db,'f','tag');
 expect(fireEvent.mock.calls[0]).toMatchObject([expect.anything(),'tag_change',{friendId:'f',sourceEventId:expect.any(String),eventData:{tagId:'tag',action:'add'}},undefined,'a']);
 await detachTagAndFireSideEffects(t.db,'f','tag','source-remove');
 expect(fireEvent.mock.calls[1]).toMatchObject([expect.anything(),'tag_change',{friendId:'f',sourceEventId:expect.any(String),eventData:{tagId:'tag',action:'remove'}},undefined,'a']);
});

test('検査前の画像はURLを知っていても本体を取れない',async()=>{
 const get=vi.fn(async()=>({body:new Uint8Array([1,2,3]),httpMetadata:{contentType:'image/png'},etag:'fixture'}));
 const instance=new Hono<Env>();instance.use('*',async(c,next)=>{c.env={DB:t.db,IMAGES:{get}} as unknown as Env['Bindings'];await next();});instance.route('/',images);
 const response=await instance.request('/images/nen-photo-public/f/unscanned.png');
 expect(response.status).toBe(409);expect(get).not.toHaveBeenCalled();
});
test.each([[0,1],[1,5],[2,30]])('%i回目の失敗は%i分待ちを記録する',async(attempts,minutes)=>{
 seedJob();t.raw.prepare("UPDATE nen_delivery_jobs SET status='pending',attempts=?").run(attempts);
 const now=new Date('2026-10-16T10:00:00+09:00');
 await processNenDeliveries(t.db,{proxyBaseUrl:'https://proxy.invalid',defaultAccessToken:'x',now,proxyDispatch:(async()=>{throw new Error('network');}) as never});
 expect(t.raw.prepare("SELECT next_attempt_at FROM nen_delivery_jobs WHERE id='j'").get()).toEqual({next_attempt_at:new Date(now.getTime()+minutes*60_000).toISOString()});
});
test('初回と再試行3回を使った配信は自動で5回目を送らない',async()=>{
 seedJob();t.raw.prepare("UPDATE nen_delivery_jobs SET status='failed',attempts=4,next_attempt_at='2026-01-01'").run();
 const dispatch=vi.fn(async()=>new Response('{}',{status:200}));
 await processNenDeliveries(t.db,{proxyBaseUrl:'https://proxy.invalid',defaultAccessToken:'x',now:new Date('2026-10-16T10:00:00+09:00'),proxyDispatch:dispatch as never});
 expect(dispatch).not.toHaveBeenCalled();
});

test('合言葉はサーバーの乱数32バイトから毎回新しく作る',()=>{
 const random=vi.spyOn(crypto,'getRandomValues');
 try {
  const first=generateWebhookSecret(),second=generateWebhookSecret();
  expect(first).toMatch(/^[a-f0-9]{64}$/);expect(second).not.toBe(first);
  expect(random.mock.calls).toHaveLength(2);
  expect(random.mock.calls.every(([bytes])=>(bytes?.byteLength??0)>=32)).toBe(true);
 } finally {random.mockRestore();}
});

test('配信の保存・止める・誕生日設定をアカウント付きで監査に残す',async()=>{
 seedJob();
 const request=(path:string,body:unknown)=>app().request(path+'?lineAccountId=a',{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
 expect((await request('/api/nen-campaigns/settings/column',{isEnabled:true,title:'保存する題',bodyText:'本文',delayDays:0,deliveryTime:'10:00'})).status).toBe(200);
 expect((await request('/api/nen-campaigns/settings/column/enabled',{isEnabled:false})).status).toBe(200);
 expect((await request('/api/nen-campaigns/birthday-coupon',{isEnabled:true,codePrefix:'NEN',benefitLabel:'誕生日',discountAmount:500,validityDays:30})).status).toBe(200);
 await vi.waitFor(()=>expect(t.raw.prepare("SELECT action,line_account_id,target_id FROM audit_events WHERE action LIKE 'nen.%' ORDER BY action").all()).toEqual([
  {action:'nen.birthday_coupon.save',line_account_id:'a',target_id:'a'},
  {action:'nen.campaign.save',line_account_id:'a',target_id:'column'},
  {action:'nen.campaign.stop',line_account_id:'a',target_id:'column'},
 ]));
});
