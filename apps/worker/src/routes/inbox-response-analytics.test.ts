import {afterEach,beforeEach,expect,test} from 'vitest';
import {gapFixture,gapApp,gapCall,gapOwner} from '../test-utils/gap1.js';
import {inboxSla} from './inbox-sla.js';
let d:ReturnType<typeof gapFixture>;
beforeEach(()=>{d=gapFixture();d.raw.exec(`INSERT INTO inbox_response_samples(id,account_id,staff_id,reply_kind,pending_since,due_at,responded_at,is_first_response) VALUES
 ('r1','a','s','manual','2026-11-05T00:00:00Z','2026-11-05T00:15:00Z','2026-11-05T00:10:00Z',1),
 ('r2','a','s','manual','2026-11-05T00:00:00Z','2026-11-05T00:15:00Z','2026-11-05T00:20:00Z',1),
 ('r3','a','o','manual','2026-11-05T00:00:00Z',NULL,'2026-11-05T00:05:00Z',1),
 ('r4','a',NULL,'automatic',NULL,NULL,'2026-11-05T00:01:00Z',0),
 ('r5','b',NULL,'automatic',NULL,NULL,'2026-11-05T00:01:00Z',0);`)});
afterEach(()=>d.raw.close());
const path='/api/analytics/inbox-response?account_id=a&from=2026-11-02&to=2026-11-08';
test('担当別中央値・期限内割合と自動応答を分け、他店を混ぜない',async()=>{
 const res=await gapCall(gapApp(d,[inboxSla]),path);expect(res.status).toBe(200);
 const body=await res.json() as {data:{summary:{medianFirstResponseMinutes:number;withinSlaRate:number;overdueCount:number;totalCount:number};byStaff:Array<{staffId:string;medianFirstResponseMinutes:number;withinSlaRate:number|null;count:number}>;automatic:{count:number;deletedCount:number;unavailableCount:number};weekly:unknown[]}};
 expect(body.data.byStaff).toEqual(expect.arrayContaining([expect.objectContaining({staffId:'s',medianFirstResponseMinutes:15,withinSlaRate:50,count:2}),expect.objectContaining({staffId:'o',withinSlaRate:null,count:1})]));
 expect(body.data.summary).toEqual({medianFirstResponseMinutes:10,withinSlaRate:50,overdueCount:1,totalCount:4});
 expect(body.data.automatic).toEqual({count:1,deletedCount:0,unavailableCount:1});expect(body.data.weekly.length).toBe(1);
});
test('スタッフと閲覧のみは自分だけ、他店と不正な期間は拒否',async()=>{
 const staff={...gapOwner,id:'s',role:'staff' as const};
 for(const readOnly of [false,true]){
  const res=await gapCall(gapApp(d,[inboxSla],{...staff,readOnly}),path);
  const body=await res.json() as {data:{byStaff:Array<{staffId:string}>;automatic:unknown}};
  expect(body.data.byStaff.map(x=>x.staffId)).toEqual(['s']);expect(body.data.automatic).toBeNull();
 }
 expect((await gapCall(gapApp(d,[inboxSla]),path.replace('account_id=a','account_id=b'))).status).toBe(404);
 expect((await gapCall(gapApp(d,[inboxSla]),path.replace('2026-11-02&to','2028-11-02&to'))).status).toBe(400);
});

test('会話が削除されても期限内割合と週別件数は残り、一覧には現在の会話だけを出す',async()=>{
 d.raw.pragma('foreign_keys = ON');
 d.raw.exec(`INSERT INTO chats(id,friend_id,status,created_at,updated_at) VALUES('c1','f','unread','now','now'),('c2','f2','unread','now','now');
 UPDATE inbox_response_samples SET chat_id='c1' WHERE id='r1'; UPDATE inbox_response_samples SET chat_id='c2' WHERE id='r2'; DELETE FROM chats WHERE id='c1';`);
 const app=gapApp(d,[inboxSla]);
 const res=await gapCall(app,path);expect(res.status).toBe(200);
 const body=await res.json() as {data:{byStaff:Array<{staffId:string;count:number;deletedCount:number;withinSlaRate:number}>;weekly:Array<{count:number}>}};
 expect(body.data.byStaff.find(x=>x.staffId==='s')).toMatchObject({count:2,deletedCount:1,withinSlaRate:50});
 const result=await gapCall(app,`/api/analytics/inbox-response/conversations?account_id=a&from=2026-11-02&to=2026-11-08&staffId=s&staffDeleted=0`);
 expect(result.status).toBe(200);
 expect((await result.json() as {data:{items:Array<{chatId:string}>}}).data.items.map(x=>x.chatId)).toEqual(['c2']);
});
test('会話一覧は受信箱の権限・店・自分の担当を必ず照らす',async()=>{
 const url='/api/analytics/inbox-response/conversations?account_id=a&from=2026-11-02&to=2026-11-08&staffId=s&staffDeleted=0';
 const staff={...gapOwner,id:'s',role:'staff' as const,permissionKeys:['/chats']};
 expect((await gapCall(gapApp(d,[inboxSla],staff),url)).status).toBe(200);
 expect((await gapCall(gapApp(d,[inboxSla],{...staff,permissionKeys:[]}),url)).status).toBe(403);
 expect((await gapCall(gapApp(d,[inboxSla],staff),url.replace('staffId=s','staffId=o'))).status).toBe(403);
 expect((await gapCall(gapApp(d,[inboxSla],staff),url.replace('account_id=a','account_id=b'))).status).toBe(404);
});
test('自動の返事も削除前後で別の件数を保ち、会話の一覧を権限で守る',async()=>{
 d.raw.pragma('foreign_keys = ON');
 d.raw.exec(`INSERT INTO chats(id,friend_id,status,created_at,updated_at) VALUES('auto-chat','f','unread','now','now'); UPDATE inbox_response_samples SET chat_id='auto-chat' WHERE id='r4'; DELETE FROM chats WHERE id='auto-chat'`);
 const app=gapApp(d,[inboxSla]);
 const body=await (await gapCall(app,path)).json() as {data:{automatic:{count:number;deletedCount:number;unavailableCount:number}}};
 expect(body.data.automatic).toEqual({count:1,deletedCount:1,unavailableCount:0});
 const url='/api/analytics/inbox-response/conversations?account_id=a&from=2026-11-02&to=2026-11-08&staffId=&staffDeleted=0&kind=automatic';
 const result=await gapCall(app,url);expect(result.status).toBe(200);
 expect((await result.json() as {data:{items:unknown[]}}).data.items).toEqual([]);
 expect((await gapCall(gapApp(d,[inboxSla],{...gapOwner,id:'s',role:'staff',permissionKeys:['/chats']}),url)).status).toBe(403);
});
test('退職した担当者の記録は未割当とは分けて削除された担当者にまとめる',async()=>{
 d.raw.pragma('foreign_keys = ON');
 d.raw.exec("UPDATE staff SET staff_member_id=NULL WHERE staff_member_id='s'; DELETE FROM staff_members WHERE id='s'");
 const res=await gapCall(gapApp(d,[inboxSla]),path);expect(res.status).toBe(200);
 const body=await res.json() as {data:{byStaff:Array<{staffId:string|null;staffDeleted:boolean;staffName:string;count:number}>}};
 expect(body.data.byStaff).toContainEqual(expect.objectContaining({staffId:null,staffDeleted:true,staffName:'削除された担当者',count:2}));
});
