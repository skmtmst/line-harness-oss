import {beforeEach,afterEach,expect,test,vi} from 'vitest';
import {gapFixture,gapApp,gapCall,gapOwner} from '../test-utils/gap1.js';
import {inboxSla} from './inbox-sla.js';
import {assignInbox} from '../services/inbox-assignment.js';
let d:ReturnType<typeof gapFixture>;
beforeEach(()=>{d=gapFixture();d.raw.exec(`INSERT INTO chats(id,friend_id,status,last_customer_message_at,created_at,updated_at) VALUES('c','f','unread','2026-10-16T04:00:00Z','now','now'); INSERT INTO staff_presence(staff_id,away,last_seen_at) VALUES('s',0,'2026-10-16T04:00:00Z');`);});
afterEach(()=>{d.raw.close();vi.restoreAllMocks();});
const app=()=>gapApp(d,[inboxSla]);
const body={strategy:'even',targets:[{staffId:'s',priority:1,cap:1}],enabled:true,firstResponseMinutes:30,businessHoursOnly:false,expectedVersion:0};
test('SLA-01/02/08: 保存では付けず、受信時に一度だけ担当・記録を同時に確定',async()=>{
 const external=vi.spyOn(globalThis,'fetch');expect((await gapCall(app(),'/api/inbox/routing-settings?account_id=a','PUT',body)).status).toBe(200);
 expect(d.raw.prepare("SELECT assignee_staff_id FROM chats WHERE id='c'").get()).toEqual({assignee_staff_id:null});
 expect(await assignInbox(d.db,'a','f',new Date('2026-10-16T04:01:00Z'))).toBe(true);
 expect(await assignInbox(d.db,'a','f',new Date('2026-10-16T04:01:00Z'))).toBe(false);
 expect(d.raw.prepare('SELECT staff_id,strategy FROM inbox_assignment_logs').all()).toEqual([{staff_id:'s',strategy:'even'}]);expect(external).not.toHaveBeenCalled();
});
test.each(['priority','random_weighted'])('SLA-03/04/06: %sは不在・上限に渡さない',async strategy=>{
 expect((await gapCall(app(),'/api/inbox/routing-settings?account_id=a','PUT',{...body,strategy})).status).toBe(200);
 d.raw.exec("UPDATE staff_presence SET away=1");expect(await assignInbox(d.db,'a','f',new Date('2026-10-16T04:01:00Z'))).toBe(false);
 d.raw.exec("UPDATE staff_presence SET away=0; INSERT INTO chats(id,friend_id,assignee_staff_id,status,last_customer_message_at,created_at,updated_at) VALUES('c2','f2','s','unread','2026-10-16T04:00:00Z','now','now')");expect(await assignInbox(d.db,'a','f',new Date('2026-10-16T04:01:00Z'))).toBe(false);
});
test('SLA-17/18/19: 閲覧と他店を拒否し、古い版で対象者も上書きしない',async()=>{
 const path='/api/inbox/routing-settings?account_id=a';expect((await gapCall(app(),path,'PUT',body)).status).toBe(200);
 expect((await gapCall(app(),path,'PUT',{...body,strategy:'priority',targets:[]})).status).toBe(409);
 expect(((await (await gapCall(app(),path)).json()) as {data:{strategy:string}}).data.strategy).toBe('even');
 expect((await gapCall(gapApp(d,[inboxSla],{...gapOwner,readOnly:true}),path,'PUT',body)).status).toBe(403);
 expect((await gapCall(app(),path.replace('=a','=b'),'PUT',body)).status).toBe(404);
});

test.each(['even','priority','random_weighted'])('SLA-01/03/04: %s は対象者の順・件数・重みから正しい人へ振り分ける',async strategy=>{
 d.raw.exec("INSERT INTO staff_presence(staff_id,away,last_seen_at) VALUES('o',0,'2026-10-16T04:00:00Z'); INSERT INTO inbox_assignment_logs(id,account_id,chat_id,staff_id,strategy,decided_at,mutation_token) VALUES('old','a','c','s','even','2026-10-16T03:00:00Z','old')");
 expect((await gapCall(app(),'/api/inbox/routing-settings?account_id=a','PUT',{...body,strategy,targets:[{staffId:'s',priority:1,cap:10},{staffId:'o',priority:100,cap:10}]})).status).toBe(200);
 expect(await assignInbox(d.db,'a','f',new Date('2026-10-16T04:01:00Z'),()=>strategy==='random_weighted'?0.999:0)).toBe(true);
 expect(d.raw.prepare("SELECT assignee_staff_id FROM chats WHERE id='c'").get()).toEqual({assignee_staff_id:strategy==='priority'?'s':'o'});
});
test('自動割当の設定後にトークの権限を失った担当者は選ばない',async()=>{
 expect((await gapCall(app(),'/api/inbox/routing-settings?account_id=a','PUT',body)).status).toBe(200);
 d.raw.exec("UPDATE staff_members SET permission_keys='[]' WHERE id='s'");
 expect(await assignInbox(d.db,'a','f',new Date('2026-10-16T04:01:00Z'))).toBe(false);
 expect(d.raw.prepare("SELECT assignee_staff_id FROM chats WHERE id='c'").get()).toEqual({assignee_staff_id:null});
});

test('SLA-04: 担当できる人がいなければ店内に一度だけ知らせ、再実行と担当済みでは増やさない',async()=>{
 expect((await gapCall(app(),'/api/inbox/routing-settings?account_id=a','PUT',body)).status).toBe(200);
 d.raw.exec('UPDATE staff_presence SET away=1');
 await Promise.all([assignInbox(d.db,'a','f',new Date('2026-10-16T04:01:00Z')),assignInbox(d.db,'a','f',new Date('2026-10-16T04:01:00Z'))]);
 expect(d.raw.prepare("SELECT line_account_id,event_type,category FROM notifications WHERE event_type='inbox_assignment_unavailable'").all()).toEqual([{line_account_id:'a',event_type:'inbox_assignment_unavailable',category:'error'}]);
 d.raw.exec("UPDATE chats SET assignee_staff_id='s' WHERE id='c'");
 await assignInbox(d.db,'a','f',new Date('2026-10-16T04:01:00Z'));
 expect(d.raw.prepare("SELECT count(*) n FROM notifications WHERE event_type='inbox_assignment_unavailable'").get()).toEqual({n:1});
});

test('SLA-21/22: 一括割当は台帳に受け付け、再送と中断後の再開で割当を重複しない',async()=>{
 const {processFriendBulkRun}=await import('../features/friends/friend-bulk-runs.js');
 expect((await gapCall(app(),'/api/inbox/routing-settings?account_id=a','PUT',body)).status).toBe(200);
 const path='/api/inbox/routing/apply-unassigned?account_id=a';
 const first=await gapCall(app(),path,'POST',{},'test-routing-1');expect(first.status).toBe(202);
 const initial=await first.json() as {data:{id:string;status:string;total:number}};
 expect(initial.data).toMatchObject({status:'queued',total:1});
 const repeat=await gapCall(app(),path,'POST',{},'test-routing-1');expect((await repeat.json() as {data:{id:string}}).data.id).toBe(initial.data.id);
 const id=initial.data.id;
 await processFriendBulkRun(d.db,id,{now:'2026-10-16T04:01:00Z'});
 expect(d.raw.prepare('SELECT count(*) n FROM inbox_assignment_logs').get()).toEqual({n:1});
 // Simulate stopping after the assignment committed but before the item receipt did.
 d.raw.prepare("UPDATE friend_bulk_run_items SET status='queued',completed_at=NULL WHERE run_id=?").run(id);
 d.raw.prepare("UPDATE friend_bulk_runs SET status='queued' WHERE id=?").run(id);
 await processFriendBulkRun(d.db,id,{now:'2026-10-16T04:02:00Z'});
 const status=await gapCall(app(),`/api/inbox/routing/apply-unassigned/${id}?account_id=a`);
 expect(await status.json()).toMatchObject({data:{status:'success',assigned:1,skipped:0}});
 expect(d.raw.prepare('SELECT count(*) n FROM inbox_assignment_logs').get()).toEqual({n:1});
 expect((await gapCall(gapApp(d,[inboxSla],{...gapOwner,readOnly:true}),path,'POST',{},'denied')).status).toBe(403);
});

test('引き継がれた古い処理は担当も結果も書き換えない',async()=>{
 const {updateFriendBulkRunItem}=await import('@line-crm/db');
 expect((await gapCall(app(),'/api/inbox/routing-settings?account_id=a','PUT',body)).status).toBe(200);
 const response=await gapCall(app(),'/api/inbox/routing/apply-unassigned?account_id=a','POST',{},'lease-race');
 const id=(await response.json() as {data:{id:string}}).data.id;
 const item=d.raw.prepare('SELECT id FROM friend_bulk_run_items WHERE run_id=?').get(id) as {id:string};
 d.raw.prepare("UPDATE friend_bulk_run_items SET status='running',attempt_count=2 WHERE id=?").run(item.id);
 expect(await assignInbox(d.db,'a','f',new Date('2026-10-16T04:01:00Z'),()=>0,item.id,1)).toBe(false);
 await updateFriendBulkRunItem(d.db,item.id,{status:'skipped',now:'2026-10-16T04:01:00Z',expectedAttempt:1});
 expect(d.raw.prepare('SELECT status FROM friend_bulk_run_items WHERE id=?').get(item.id)).toEqual({status:'running'});
 expect(await assignInbox(d.db,'a','f',new Date('2026-10-16T04:01:00Z'),()=>0,item.id,2)).toBe(true);
 expect(d.raw.prepare('SELECT count(*) n FROM inbox_assignment_logs').get()).toEqual({n:1});
});

test('一括割当は 300 件を分割して処理し、別の店からは進捗を見られない',async()=>{
 const {processFriendBulkRun}=await import('../features/friends/friend-bulk-runs.js');
 const f=d.raw.prepare('INSERT INTO friends(id,line_user_id,line_account_id) VALUES(?,?,?)');
 const c=d.raw.prepare("INSERT INTO chats(id,friend_id,status,last_customer_message_at,created_at,updated_at) VALUES(?,?,'unread','2026-10-16T04:00:00Z','now','now')");
 d.raw.transaction(()=>{for(let i=0;i<299;i++){f.run(`bulk-f-${i}`,`bulk-u-${i}`,'a');c.run(`bulk-c-${i}`,`bulk-f-${i}`)}})();
 expect((await gapCall(app(),'/api/inbox/routing-settings?account_id=a','PUT',{...body,targets:[{staffId:'s',priority:1,cap:1000}]})).status).toBe(200);
 const response=await gapCall(app(),'/api/inbox/routing/apply-unassigned?account_id=a','POST',{},'bulk-300');
 const id=(await response.json() as {data:{id:string;total:number}}).data.id;
 for(let i=0;i<3;i++)await processFriendBulkRun(d.db,id,{now:'2026-10-16T04:01:00Z',limit:100});
 expect(d.raw.prepare("SELECT status,success_count FROM friend_bulk_runs WHERE id=?").get(id)).toEqual({status:'success',success_count:300});
 expect((await gapCall(app(),`/api/inbox/routing/apply-unassigned/${id}?account_id=b`)).status).toBe(404);
});
