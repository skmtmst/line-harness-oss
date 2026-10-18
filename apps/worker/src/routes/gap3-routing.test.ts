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
 expect(d.raw.prepare("SELECT operator_id FROM chats WHERE id='c'").get()).toEqual({operator_id:null});
 expect(await assignInbox(d.db,'a','f',new Date('2026-10-16T04:01:00Z'))).toBe(true);
 expect(await assignInbox(d.db,'a','f',new Date('2026-10-16T04:01:00Z'))).toBe(false);
 expect(d.raw.prepare('SELECT staff_id,strategy FROM inbox_assignment_logs').all()).toEqual([{staff_id:'s',strategy:'even'}]);expect(external).not.toHaveBeenCalled();
});
test.each(['priority','random_weighted'])('SLA-03/04/06: %sは不在・上限に渡さない',async strategy=>{
 expect((await gapCall(app(),'/api/inbox/routing-settings?account_id=a','PUT',{...body,strategy})).status).toBe(200);
 d.raw.exec("UPDATE staff_presence SET away=1");expect(await assignInbox(d.db,'a','f',new Date('2026-10-16T04:01:00Z'))).toBe(false);
 d.raw.exec("UPDATE staff_presence SET away=0; INSERT INTO chats(id,friend_id,operator_id,status,last_customer_message_at,created_at,updated_at) VALUES('c2','f2','s','unread','2026-10-16T04:00:00Z','now','now')");expect(await assignInbox(d.db,'a','f',new Date('2026-10-16T04:01:00Z'))).toBe(false);
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
 expect(d.raw.prepare("SELECT operator_id FROM chats WHERE id='c'").get()).toEqual({operator_id:strategy==='priority'?'s':'o'});
});
