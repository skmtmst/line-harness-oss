import {beforeEach,afterEach,test,expect,vi} from 'vitest';
import {broadcastAb} from './broadcast-ab.js';
import {broadcasts} from './broadcasts.js';
import {setBroadcastApprovalThreshold} from '../features/broadcasts/broadcast-approval.js';
import {abWinner,splitAb,startAbMock,decideAbTests} from '../features/broadcasts/broadcast-ab.js';
import {gapFixture,gapApp,gapCall,gapOwner} from '../test-utils/gap1.js';
import type {SqliteD1} from '../test-utils/d1-sqlite.js';
let d:SqliteD1;const p='/api/broadcasts/br/ab-test';
beforeEach(()=>{d=gapFixture();d.raw.exec("INSERT INTO tags(id,name,line_account_id) VALUES('audience','対象','a');INSERT INTO broadcasts(id,title,message_type,message_content,target_type,target_tag_id,line_account_id) VALUES('br','試す','text','A','tag','audience','a')");const add=d.raw.prepare("INSERT INTO friends(id,line_user_id,display_name,line_account_id) VALUES(?,?,?,'a')"),tag=d.raw.prepare("INSERT INTO friend_tags(friend_id,tag_id) VALUES(?,'audience')");d.raw.transaction(()=>{for(let i=0;i<2400;i++){const id='abf'+i;add.run(id,'U'+id,id);tag.run(id);}})();vi.stubGlobal('fetch',vi.fn(()=>{throw new Error('external_forbidden');}));});
afterEach(()=>{d.raw.close();vi.unstubAllGlobals();});
async function configure(){const app=gapApp(d,[broadcastAb]);for(const [key,v] of [['A',1],['B',2]] as const)expect((await gapCall(app,`/api/broadcasts/br/variants/${key}`,'PUT',{text:key,expectedVersion:v})).status).toBe(200);expect((await gapCall(app,p,'PUT',{testRatioPct:20,metric:'click',decideAfterMinutes:60,undecidedPolicy:'stop',expectedVersion:3})).status).toBe(200);}
test('AB-01 AB-02 AB-09 AB-11 AB-12: 2案・重ならない宛先・承認解除・途中変更禁止',async()=>{
 await configure();const r=await startAbMock(d.db,'br',4,2400,'start');expect(r.counts).toEqual({A:240,B:240,R:1920});expect(d.raw.prepare('SELECT count(DISTINCT friend_id) n FROM broadcast_ab_recipients').get()).toEqual({n:2400});expect((await gapCall(gapApp(d,[broadcastAb]),'/api/broadcasts/br/variants/B','PUT',{text:'変更',expectedVersion:5})).status).toBe(409);expect(fetch).not.toHaveBeenCalled();
 d.raw.exec("UPDATE broadcasts SET target_type='all'");await expect(startAbMock(d.db,'br',5,2400,'bad')).rejects.toThrow();
});
test('AB-03 AB-04 AB-06 AB-18: 判定は一度・小さい差は止め24時間で期限切れ',async()=>{
 expect(abWinner({sent:1000,clicks:120},{sent:1000,clicks:60}).winner).toBe('A');expect(abWinner({sent:1000,clicks:100},{sent:1000,clicks:104}).winner).toBeNull();expect(abWinner({sent:49,clicks:49},{sent:1000,clicks:0}).winner).toBeNull();
 await configure();await startAbMock(d.db,'br',4,2400,'start');const now=new Date(Date.now()+2*3600000);await decideAbTests(d.db,now);await decideAbTests(d.db,now);expect(d.raw.prepare('SELECT status FROM broadcast_ab_tests').get()).toEqual({status:'undecided'});expect(d.raw.prepare("SELECT count(*) n FROM broadcast_ab_recipients WHERE variant_key='R' AND state='sent'").get()).toEqual({n:0});expect(d.raw.prepare("SELECT count(*) n FROM notifications WHERE event_type='broadcast_ab_undecided'").get()).toEqual({n:1});await decideAbTests(d.db,new Date(now.getTime()+86400001));expect(d.raw.prepare('SELECT status FROM broadcast_ab_tests').get()).toEqual({status:'expired'});
});
test('AB-05 AB-15 AB-16 AB-23: 手で選ぶのも同時に一度、代理は禁止',async()=>{
 await configure();await startAbMock(d.db,'br',4,2400,'start');await decideAbTests(d.db,new Date(Date.now()+2*3600000));const url='/api/broadcasts/br/ab-test/choose';
 const request=(variant:string,im=false)=>gapApp(d,[broadcastAb],gapOwner,im).request(url,{method:'POST',headers:{'Content-Type':'application/json','Idempotency-Key':variant,'X-Confirm-Irreversible':'broadcast-send'},body:JSON.stringify({variant,confirmedRecipientCount:1920,testMode:true})});
 expect((await request('A',true)).status).toBe(403);const rs=await Promise.all([request('A'),request('B')]);expect(rs.map(x=>x.status).sort()).toEqual([200,409]);expect(d.raw.prepare('SELECT winner FROM broadcast_ab_tests').get()).toEqual({winner:'A'});expect(await (await request('A')).json()).toMatchObject({data:{variant:'A',testMode:true},replayed:true});
});
test('AB-06 AB-23: 配信機能を止めた店の判定の仕事は進めない',async()=>{
 await configure();await startAbMock(d.db,'br',4,2400,'off-start');
 d.raw.exec("INSERT INTO account_settings(id,line_account_id,key,value) VALUES('ab-off','a','feature.broadcasts','false')");
 await decideAbTests(d.db,new Date(Date.now()+2*3600000));
 expect(d.raw.prepare('SELECT status FROM broadcast_ab_tests').get()).toEqual({status:'testing'});
 expect(d.raw.prepare("SELECT COUNT(*) n FROM notifications WHERE event_type='broadcast_ab_undecided'").get()).toEqual({n:0});expect(fetch).not.toHaveBeenCalled();
});
test('AB-08 AB-22 Q-01: 少人数・閲覧のみ・他店を拒否',async()=>{
 expect(()=>splitAb(Array.from({length:1284},(_,i)=>String(i)),20)).toThrow('AB_AUDIENCE_TOO_SMALL');expect((await gapCall(gapApp(d,[broadcastAb],{...gapOwner,readOnly:true}),p,'PUT',{})).status).toBe(403);d.raw.exec("UPDATE broadcasts SET line_account_id='b' WHERE id='br'");expect((await gapCall(gapApp(d,[broadcastAb]),'/api/broadcasts/br/ab-result')).status).toBe(404);
});
test('AB-01 AB-23: 実際の送信APIでも模擬指定なしは409、模擬指定と同じキーだけで開始',async()=>{
 await configure();const app=gapApp(d,[broadcastAb,broadcasts]);
 const request=(testMode?:boolean)=>app.request('/api/broadcasts/br/send',{method:'POST',headers:{'Content-Type':'application/json','Idempotency-Key':'send-api','X-Confirm-Irreversible':'broadcast-send'},body:JSON.stringify({expectedVersion:4,confirmedRecipientCount:2400,testMode})});
 const approval=await request(true);expect(approval.status).toBe(409);expect(d.raw.prepare('SELECT status FROM broadcast_ab_tests').get()).toEqual({status:'draft'});
 await setBroadcastApprovalThreshold(d.db,'a',10000);
 const denied=await request();expect(denied.status).toBe(409);expect(await denied.json()).toMatchObject({error:'test_mode_required'});
 expect(d.raw.prepare('SELECT status FROM broadcast_ab_tests').get()).toEqual({status:'draft'});
 const started=await request(true);expect(started.status).toBe(202);expect(await started.json()).toMatchObject({data:{status:'testing',testMode:true}});
 expect((await request(true)).status).toBe(202);expect(d.raw.prepare('SELECT COUNT(*) n FROM broadcast_ab_recipients').get()).toEqual({n:2400});
 const changed=await app.request('/api/broadcasts/br/send',{method:'POST',headers:{'Content-Type':'application/json','Idempotency-Key':'send-api','X-Confirm-Irreversible':'broadcast-send'},body:JSON.stringify({expectedVersion:4,confirmedRecipientCount:2401,testMode:true})});expect(changed.status).toBe(409);expect(await changed.json()).toMatchObject({error:'idempotency_conflict'});
 expect(d.raw.prepare('SELECT status FROM broadcasts').get()).toEqual({status:'draft'});expect(fetch).not.toHaveBeenCalled();
});
