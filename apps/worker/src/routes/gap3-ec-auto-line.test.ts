import {afterEach,beforeEach,expect,test,vi} from 'vitest';
import {gapFixture,gapApp,gapCall,gapOwner} from '../test-utils/gap1.js';
import {ecAutoLine} from './ec-auto-line.js';
import {ingestBehavior,processAutoLineMock} from '../features/ec-commerce/ec-auto-line.js';
import {encryptCredential} from '@line-crm/db';
let d:ReturnType<typeof gapFixture>;
const encryptionKey=btoa('x'.repeat(32));
const at=new Date('2026-10-16T03:00:00Z'); // noon in Tokyo
beforeEach(()=>{d=gapFixture();vi.stubGlobal('fetch',vi.fn(()=>{throw new Error('external_forbidden');}));d.raw.exec("INSERT INTO ec_connectors(id,line_account_id,provider,shop_domain,status,created_at,updated_at) VALUES('ec','a','ec_cube','example.test','connected','now','now')");});
afterEach(()=>{d.raw.close();vi.unstubAllGlobals();vi.useRealTimers();});
const app=(s=gapOwner,im=false)=>gapApp(d,[ecAutoLine],s,im,{LINE_CREDENTIAL_ENCRYPTION_KEY:encryptionKey});
const rule={waitMinutes:60,messages:[{type:'text',text:'お忘れ物があります'}],testMode:true,expectedVersion:0};
async function enable(kind='cart'){
 let r=await gapCall(app(),`/api/ec/auto-line/rules/${kind}?account_id=a`,'PUT',rule);expect(r.status).toBe(200);
 r=await gapCall(app(),`/api/ec/auto-line/rules/${kind}/enable?account_id=a`,'POST',{enabled:true,confirmed:true,testMode:true,expectedVersion:1},'enable-'+kind);expect(r.status).toBe(200);
}
function scheduled(id='e',product='p',kind='cart',due='2026-10-16T02:00:00Z'){
 d.raw.prepare("INSERT INTO ec_behavior_events(id,account_id,friend_id,type,product_id,product_snapshot_json,occurred_at,received_at,dedupe_key) VALUES(?,'a','f',?,?,?,?,'now',?)").run(id,kind==='browse'?'product_view':'cart_add',product,'{}','2026-10-16T01:00:00Z',id);
 d.raw.prepare("INSERT INTO ec_auto_line_sends(id,account_id,rule_kind,friend_id,product_id,trigger_event_id,scheduled_at,original_due_at,messages_snapshot_json) VALUES(?,'a',?,'f',?,?,?,?,?)").run('send-'+id,kind,product,id,due,due,'[]');
}
const states=()=>d.raw.prepare('SELECT status FROM ec_auto_line_sends ORDER BY id').all();
test('EC-02/15/17/18/19/20: 初期停止・版・確認・冪等・代理は理由つき停止だけを監査',async()=>{
 const initial=(await (await gapCall(app(),'/api/ec/auto-line/rules?account_id=a')).json() as any).data;expect(initial.every((r:any)=>r.enabled===false)).toBe(true);
 expect((await gapCall(app(),'/api/ec/auto-line/rules/cart?account_id=a','PUT',{...rule,enabled:true})).status).toBe(400);
 await enable();expect((await gapCall(app(),'/api/ec/auto-line/rules/cart/enable?account_id=a','POST',{enabled:true,confirmed:true,testMode:true,expectedVersion:1},'enable-cart')).status).toBe(200);
 expect(d.raw.prepare('SELECT count(*) n FROM ec_auto_line_rule_events').get()).toEqual({n:2});
 expect((await gapCall(app(),'/api/ec/auto-line/rules/cart?account_id=a','PUT',rule)).status).toBe(409);
 for(const s of [{...gapOwner,readOnly:true},{...gapOwner,role:'staff' as const}])expect((await gapCall(app(s),'/api/ec/auto-line/rules/cart?account_id=a','PUT',rule)).status).toBe(403);
 expect((await gapCall(app(gapOwner,true),'/api/ec/auto-line/rules/cart/enable?account_id=a','POST',{enabled:true,confirmed:true,testMode:true,expectedVersion:2})).status).toBe(403);
 expect((await gapCall(app(gapOwner,true),'/api/ec/auto-line/rules/cart?account_id=a','PUT',{...rule,enabled:false,reason:'緊急停止',expectedVersion:2})).status).toBe(200);
 expect(d.raw.prepare('SELECT impersonation_id,reason FROM ec_auto_line_rule_events WHERE impersonation_id IS NOT NULL').get()).toEqual({impersonation_id:'im',reason:'緊急停止'});expect(fetch).not.toHaveBeenCalled();
});
test('EC-03/04/05/06/07: 10分待機・直前の購入・宣伝停止・3種類共通で1日1通',async()=>{
 await enable();scheduled();await processAutoLineMock(d.db,new Date('2026-10-16T02:09:00Z'));expect(states()).toEqual([{status:'scheduled'}]);
 await processAutoLineMock(d.db,at);expect(states()).toEqual([{status:'simulated'}]);
 await enable('browse');scheduled('e2','p2','browse');await processAutoLineMock(d.db,at);expect(states()).toEqual([{status:'simulated'},{status:'skipped_cap'}]);
 d.raw.exec("DELETE FROM ec_auto_line_sends;DELETE FROM ec_behavior_events");scheduled();d.raw.exec("INSERT INTO ec_behavior_events(id,account_id,friend_id,type,product_id,product_snapshot_json,occurred_at,received_at,dedupe_key) VALUES('buy','a','f','purchase','other','{}','2026-10-16T01:50:00Z','now','buy')");
 await processAutoLineMock(d.db,at);expect(states()).toEqual([{status:'skipped_purchased'}]);
 d.raw.exec("DELETE FROM ec_auto_line_sends;DELETE FROM ec_behavior_events;INSERT INTO friend_delivery_consents(line_account_id,friend_id,purpose,state,reason,source) VALUES('a','f','marketing','revoked','本人','liff')");scheduled();await processAutoLineMock(d.db,at);expect(states()).toEqual([{status:'skipped_opted_out'}]);expect(fetch).not.toHaveBeenCalled();
});
test('EC-08/09/13/27: 夜は朝へ・古いカゴを除外・本文は予定時の控え',async()=>{
 await enable();scheduled('night','p','cart','2026-10-16T14:00:00Z');await processAutoLineMock(d.db,new Date('2026-10-16T14:10:00Z'));
 expect(d.raw.prepare('SELECT scheduled_at FROM ec_auto_line_sends').get()).toEqual({scheduled_at:'2026-10-16T23:00:00.000Z'});
 await processAutoLineMock(d.db,new Date('2026-10-16T23:00:00Z'));expect(states()).toEqual([{status:'simulated'}]);
 scheduled('stale','other','cart','2026-10-17T01:00:00Z');await processAutoLineMock(d.db,new Date('2026-10-17T05:00:00Z'));expect(states()).toContainEqual({status:'skipped_late'});
});
test('EC-23/24/25: 署名・時刻・重複・同意・他店の本人を使わない',async()=>{
 const event={eventId:'event',customerId:'unknown',productId:'p',type:'cart_add',occurredAt:at.toISOString(),trackingConsent:true};
 expect(await ingestBehavior(d.db,'a',{...event,trackingConsent:false},at)).toMatchObject({accepted:false});
 expect(await ingestBehavior(d.db,'a',event,at)).toMatchObject({accepted:true,matched:false});expect(await ingestBehavior(d.db,'a',event,at)).toMatchObject({duplicate:true});
 await expect(ingestBehavior(d.db,'a',{...event,customerId:'different'},at)).rejects.toThrow('idempotency_conflict');
 expect((await gapCall(app(),'/api/ec/events','POST',event)).status).toBe(401);
 const secret='mock-connector-secret-32-characters-long';d.raw.prepare('UPDATE ec_connectors SET inbound_secret_encrypted=?').run(await encryptCredential(secret,encryptionKey));
 const timestamp=String(Math.floor(Date.now()/1000)),raw=JSON.stringify({...event,eventId:'signed',occurredAt:new Date().toISOString()});
 const key=await crypto.subtle.importKey('raw',new TextEncoder().encode(secret),{name:'HMAC',hash:'SHA-256'},false,['sign']);const signature=Array.from(new Uint8Array(await crypto.subtle.sign('HMAC',key,new TextEncoder().encode(timestamp+'.'+raw))),x=>x.toString(16).padStart(2,'0')).join('');
 const response=await app().request('/api/ec/events',{method:'POST',headers:{'x-line-account-id':'a','x-nen-timestamp':timestamp,'x-nen-signature':signature},body:raw});expect(response.status).toBe(202);
 const insert=d.raw.prepare("INSERT INTO ec_behavior_events(id,account_id,type,product_id,product_snapshot_json,occurred_at,received_at,dedupe_key) VALUES(?,'a','restock','p','{}',?,?,?)");
 d.raw.transaction(()=>{for(let i=0;i<600;i++)insert.run('rate-'+i,new Date().toISOString(),new Date().toISOString(),'rate-'+i);})();
 expect((await app().request('/api/ec/events',{method:'POST',headers:{'x-line-account-id':'a','x-nen-timestamp':timestamp,'x-nen-signature':signature},body:raw})).status).toBe(429);expect(fetch).not.toHaveBeenCalled();
});

test('EC-03/12/13/23: 本人の結び付けから予定を一度だけ作り、編集後も控えを保持',async()=>{
 // The existing identity resolver owns candidate approval; this fixture is an approved link.
 d.raw.exec("INSERT INTO ec_identity_links(id,tenant_id,candidate_id,source_key,shop_key,external_customer_id,line_account_id,friend_id,linked_at) VALUES('link','t','approved-candidate','ec_cube','example.test','customer','a','f','2026-10-16')");
 await enable();const event={eventId:'matched',customerId:'customer',productId:'p',type:'cart_add',occurredAt:'2026-10-16T01:00:00Z',trackingConsent:true};
 await ingestBehavior(d.db,'a',event,at);await ingestBehavior(d.db,'a',event,at);expect(d.raw.prepare('SELECT count(*) n FROM ec_auto_line_sends').get()).toEqual({n:1});
 expect((await gapCall(app(),'/api/ec/auto-line/rules/cart?account_id=a','PUT',{...rule,messages:[{type:'text',text:'変更後'}],expectedVersion:2})).status).toBe(200);
 expect(d.raw.prepare('SELECT messages_snapshot_json FROM ec_auto_line_sends').get()).toEqual({messages_snapshot_json:JSON.stringify(rule.messages)});
 await processAutoLineMock(d.db,at);expect(states()).toEqual([{status:'simulated'}]);expect(fetch).not.toHaveBeenCalled();
});

test('EC-03/06/20/28: 店内の予定だけを模擬実行・実績0・再実行と閲覧と代理を守る',async()=>{
 vi.useFakeTimers();vi.setSystemTime(at);await enable();scheduled();
 d.raw.exec("INSERT INTO ec_behavior_events(id,account_id,friend_id,type,product_id,product_snapshot_json,occurred_at,received_at,dedupe_key) VALUES('other','b','other-f','cart_add','p','{}','2026-10-16T01:00:00Z','now','other'); INSERT INTO ec_auto_line_sends(id,account_id,rule_kind,friend_id,product_id,trigger_event_id,scheduled_at,original_due_at,messages_snapshot_json) VALUES('other-send','b','cart','other-f','p','other','2026-10-16T02:00:00Z','2026-10-16T02:00:00Z','[]')");
 const url='/api/ec/auto-line/simulate?account_id=a';
 for(const [staff,im]of [[{...gapOwner,readOnly:true},false],[gapOwner,true]]as const)expect((await gapCall(app(staff,im),url,'POST',{testMode:true})).status).toBe(403);
 expect((await gapCall(app(),url,'POST',{testMode:false})).status).toBe(400);
 const result=(await (await gapCall(app(),url,'POST',{testMode:true})).json() as any).data;expect(result).toEqual({processed:1,sent:false,testMode:true});
 expect((await (await gapCall(app(),url,'POST',{testMode:true})).json() as any).data.processed).toBe(0);
 expect(d.raw.prepare("SELECT status FROM ec_auto_line_sends WHERE account_id='b'").get()).toEqual({status:'scheduled'});
 expect((await (await gapCall(app(),'/api/ec/auto-line/stats?account_id=a')).json() as any).data).toMatchObject({sent:0,simulated:1,clicks:null,purchases:null});
});

test('EC-03: 購入が事前確認の直後に増えても、最後のUPDATEで模擬配信を止める',async()=>{
 await enable();scheduled();let injected=false;const original=d.db.prepare.bind(d.db);
 const racing={...d.db,prepare(sql:string){
  if(!injected&&sql.startsWith('UPDATE ec_auto_line_sends SET status=?')){
   injected=true;d.raw.exec("INSERT INTO ec_behavior_events(id,account_id,friend_id,type,product_id,product_snapshot_json,occurred_at,received_at,dedupe_key) VALUES('last-buy','a','f','purchase','p','{}','2026-10-16T02:59:59Z','now','last-buy')");
  }
  return original(sql);
 }} as D1Database;
 await processAutoLineMock(racing,at);expect(injected).toBe(true);expect(states()).toEqual([{status:'skipped_purchased'}]);
});

test('EC-11: 在庫が事前確認の直後に0へ戻っても最後のUPDATEで止める',async()=>{
 await enable('restock');scheduled('r','p','restock');d.raw.exec("INSERT INTO ec_behavior_events(id,account_id,type,product_id,product_snapshot_json,occurred_at,received_at,dedupe_key) VALUES('stock','a','restock','p','{\"stock\":5}','2026-10-16T02:55:00Z','now','stock')");
 let injected=false;const original=d.db.prepare.bind(d.db);
 const racing={...d.db,prepare(sql:string){if(!injected&&sql.startsWith('UPDATE ec_auto_line_sends SET status=?')){injected=true;d.raw.exec("INSERT INTO ec_behavior_events(id,account_id,type,product_id,product_snapshot_json,occurred_at,received_at,dedupe_key) VALUES('stock0','a','restock','p','{\"stock\":0}','2026-10-16T02:59:59Z','now','stock0')");}return original(sql);}} as D1Database;
 await processAutoLineMock(racing,at);expect(injected).toBe(true);expect(states()).toEqual([{status:'skipped_stock'}]);
});
