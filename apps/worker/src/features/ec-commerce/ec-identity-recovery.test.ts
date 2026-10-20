import {afterEach,beforeEach,expect,test,vi} from 'vitest';
import {createTestD1,type SqliteD1} from '../../test-utils/d1-sqlite.js';
import {detectEcIdentityCandidates,recoverEcIdentityPending} from './ec-identity-recovery.js';
import {decideIdentityCandidate} from '../identity/identity-candidates.js';
import {processEcEvent} from './ec-event-processing.js';
import {getLineAccountById,upsertEcEventReadModels} from '@line-crm/db';
import type {EcEvent} from './member-snapshot.js';
let t:SqliteD1;
const now='2026-10-16T00:00:00Z';
const event:EcEvent={event_id:'ec-000001',event_type:'ec.order.confirmed',occurred_at:now,customer_id:'customer1',customer_identity:{email:'verified@example.test',email_verified:true},order:{number:'order1',total:1000}};
beforeEach(()=>{t=createTestD1();
 t.raw.prepare("INSERT INTO line_accounts(id,channel_id,name,channel_access_token,channel_secret) VALUES('a','cha','店','token','secret'),('b','chb','他店','token','secret')").run();
 t.raw.prepare("INSERT INTO friends(id,line_user_id,line_account_id,metadata) VALUES('f','Uf','a',?),('other','Uother','b',?)").run(JSON.stringify({email:'verified@example.test',email_verified:true}),JSON.stringify({email:'verified@example.test',email_verified:true}));
 t.raw.prepare("INSERT INTO ec_connectors(id,line_account_id,provider,shop_domain,event_types_json,identity_rules_json,created_at,updated_at) VALUES('c','a','ec_cube','shop.example','[]','[]',?,?)").run(now,now);
 t.raw.prepare("INSERT INTO ec_events(id,source,external_event_id,event_type,line_account_id,customer_id,payload,status,received_at,updated_at) VALUES('e','eccube:a',?,'ec.order.confirmed','a','customer1',?,'identity_pending',?,?)").run(event.event_id,JSON.stringify(event),now,now);
});
afterEach(()=>t.raw.close());
test('保存した照合ルールだけで候補を作り、別の店を候補にしない',async()=>{
 t.raw.prepare("INSERT INTO friends(id,line_user_id,line_account_id,metadata) VALUES('invalid','Uinvalid','a','null')").run();
 expect(await detectEcIdentityCandidates(t.db,'e',event,'a')).toBe(0);
 t.raw.prepare("UPDATE ec_connectors SET identity_rules_json='[\"verified_email\"]'").run();
 expect(await detectEcIdentityCandidates(t.db,'e',event,'a')).toBe(1);
 expect(t.raw.prepare('SELECT right_subject_id FROM identity_candidates').all()).toEqual([{right_subject_id:'f'}]);
 expect(JSON.stringify(t.raw.prepare('SELECT * FROM identity_candidates').all())).not.toContain('verified@example.test');
});
test('購読していない出来事は副作用を動かさず記録する',async()=>{
 t.raw.prepare("UPDATE ec_events SET status='received'").run();
 expect(await processEcEvent(t.db,{account:(await getLineAccountById(t.db,'a'))!,lineAccountId:'a',event:{...event},eventRowId:'e',now})).toBe('skipped');
 expect(t.raw.prepare("SELECT status,error_message FROM ec_events WHERE id='e'").get()).toEqual({status:'skipped',error_message:'event_not_subscribed'});
 expect(t.raw.prepare('SELECT COUNT(*) n FROM workflow_steps').get()).toEqual({n:0});
});
test('承認した範囲で結び付けた後、確認待ちの注文を再処理待ちへ戻す',async()=>{
 t.raw.prepare("UPDATE ec_connectors SET identity_rules_json='[\"verified_email\"]',event_types_json='[\"ec.order.confirmed\"]'").run();
 await upsertEcEventReadModels(t.db,{eventId:'e',sourceKey:'eccube:a',externalEventId:event.event_id,eventType:event.event_type,lineAccountId:'a',customerId:'customer1',order:event.order,occurredAt:now},now);
 await detectEcIdentityCandidates(t.db,'e',event,'a');
 const candidate=t.raw.prepare('SELECT id,version FROM identity_candidates').get() as {id:string;version:number};
 await decideIdentityCandidate(t.db,{id:'env-owner',name:'担当',tenantId:'00000000-0000-4000-8000-000000000001'},candidate.id,{expectedVersion:candidate.version,decision:'linked',reason:'購入情報を確認',reprocess:{mode:'non_delivery_actions',from:null,to:null}});
 expect(await recoverEcIdentityPending(t.db,now)).toBe(1);
 const row=t.raw.prepare("SELECT status,friend_id,identity_recovery_mode,payload FROM ec_events WHERE id='e'").get() as {status:string;friend_id:string;identity_recovery_mode:string;payload:string};
 expect(row).toMatchObject({status:'received',friend_id:'f',identity_recovery_mode:'non_delivery_actions'});
 expect(JSON.parse(row.payload).line_user_id).toBe('Uf');
 expect(await recoverEcIdentityPending(t.db,now)).toBe(0);
});
test('未照合の古い100件が、友だちが見つかった注文の回収を塞がない',async()=>{
 const insert=t.raw.prepare(`INSERT INTO ec_events(id,source,external_event_id,event_type,line_account_id,payload,status,received_at,updated_at)
   VALUES (?,'eccube:a',?,'ec.order.confirmed','a',?,'identity_pending','2020-01-01T00:00:00Z',?)`);
 for(let i=0;i<100;i++) insert.run(`unresolved-${i}`,`old-${i}`,JSON.stringify({...event,event_id:`old-${i}`}),now);
 t.raw.prepare("UPDATE ec_events SET line_user_id='Uf' WHERE id='e'").run();
 expect(await recoverEcIdentityPending(t.db,now)).toBe(1);
 expect(t.raw.prepare("SELECT status,friend_id FROM ec_events WHERE id='e'").get()).toEqual({status:'received',friend_id:'f'});
});
