import { beforeEach, afterEach, expect, test, vi } from 'vitest';
import { createTestD1, type SqliteD1 } from '../test-utils/d1-sqlite.js';
import { runEventBookingAction } from './event-booking-action.js';
import { applyFormLayoutEffects } from './form-layout-effects.js';
import { emptyLayout } from '@line-crm/shared';
import { runActionRows, type ScenarioActionRow } from './scenario-actions.js';
vi.mock('./event-bus.js',()=>({fireEvent:vi.fn()}));
let fixture:SqliteD1;
beforeEach(()=>{
 fixture=createTestD1({foreignKeys:true});
 fixture.raw.exec(`INSERT INTO line_accounts(id,channel_id,name,channel_access_token,channel_secret) VALUES ('a1','c1','店1','t','s'),('a2','c2','店2','t','s');
 INSERT INTO friends(id,line_user_id,line_account_id) VALUES ('f1','U1','a1'),('f2','U2','a1'),('f3','U3','a2');
 INSERT INTO events(id,line_account_id,name,is_published,lifecycle_status,max_bookings_per_friend,requires_approval,reminder_day_before_enabled,reminder_hours_before) VALUES ('e1','a1','イベント',1,'published',NULL,0,1,1);
 INSERT INTO event_slots(id,event_id,starts_at,ends_at,capacity,sort_order) VALUES ('s0','e1','2020-01-01T09:00:00Z','2020-01-01T10:00:00Z',1,0),('s1','e1','2099-01-01T09:00:00Z','2099-01-01T10:00:00Z',1,9),('s2','e1','2099-01-02T09:00:00Z','2099-01-02T10:00:00Z',1,1);`);
});
afterEach(()=>fixture.raw.close());
const bookings=()=>fixture.raw.prepare('SELECT friend_id,slot_id,status FROM event_bookings ORDER BY slot_id,friend_id').all();
test('表示の並び順ではなく次の日時の空きへ申し込み、再送で増えない。通知もそろう',async()=>{
 const result=await runEventBookingAction(fixture.db,{eventId:'e1'},'f1','answer1:action0');expect(result.reason).toBeNull();
 expect(bookings()).toEqual([{friend_id:'f1',slot_id:'s1',status:'confirmed'}]);
 await runEventBookingAction(fixture.db,{eventId:'e1'},'f1','answer1:action0');expect(bookings()).toHaveLength(1);
 expect(fixture.raw.prepare('SELECT kind FROM event_booking_reminders ORDER BY kind').all()).toEqual([{kind:'day_before'},{kind:'hours_before'}]);
 await runEventBookingAction(fixture.db,{eventId:'e1'},'f2','answer2:action0');expect(bookings().map((r:any)=>r.slot_id)).toEqual(['s1','s2']);
});
test('指定した回だけへ申し込み、満席なら別の回へ動かさず理由を残す',async()=>{
 await runEventBookingAction(fixture.db,{eventId:'e1',slotId:'s2'},'f1','a1');
 const result=await runEventBookingAction(fixture.db,{eventId:'e1',slotId:'s2'},'f2','a2');expect(result).toMatchObject({reason:'申し込める空きがありません',bookingIds:[]});
 expect(bookings()).toEqual([{friend_id:'f1',slot_id:'s2',status:'confirmed'}]);
 expect(fixture.raw.prepare("SELECT COUNT(*) n FROM audit_events WHERE source_kind='event_booking_action'").get()).toEqual({n:2});
});
test('その友だちのそのイベントだけを取消し、通知を止めて待ちの繰り上げを登録する',async()=>{
 await runEventBookingAction(fixture.db,{eventId:'e1',slotId:'s1'},'f1','register1');await runEventBookingAction(fixture.db,{eventId:'e1',slotId:'s2'},'f2','register2');
 await runEventBookingAction(fixture.db,{eventId:'e1',op:'cancel'},'f1','cancel1');
 expect(bookings()).toEqual([{friend_id:'f1',slot_id:'s1',status:'cancelled'},{friend_id:'f2',slot_id:'s2',status:'confirmed'}]);
 expect(fixture.raw.prepare("SELECT COUNT(*) n FROM event_booking_reminders WHERE booking_id=(SELECT id FROM event_bookings WHERE friend_id='f1') AND status='cancelled'").get()).toEqual({n:2});
 expect(fixture.raw.prepare('SELECT COUNT(*) n FROM event_waitlist_promotion_jobs').get()).toEqual({n:1});
 await runEventBookingAction(fixture.db,{eventId:'e1',op:'cancel'},'f1','cancel1');
 const none=await runEventBookingAction(fixture.db,{eventId:'e1',op:'cancel'},'f1','cancel2');expect(none.reason).toBe('申し込みがありません');
});
test('空き無し・申し込み無しでも、失敗時に止める設定に関係なくほかの行うことを続ける',async()=>{
 fixture.raw.exec('UPDATE event_slots SET capacity=0');
 const layout=emptyLayout();layout.options.afterActions=[{kind:'research_action',actionType:'event_booking',config:{eventId:'e1'},onFailure:'stop'},{kind:'research_action',actionType:'event_booking',config:{eventId:'e1',op:'cancel'},onFailure:'stop'},{kind:'send_text',text:'お礼'}];
 const pushText=vi.fn(async()=>undefined);
 const r=await applyFormLayoutEffects({db:fixture.db,layout,friendId:'f1',answers:{},idempotencyPrefix:'answer',pushText});
 expect(r.failedEffects).toEqual([]);expect(pushText).toHaveBeenCalledWith('お礼','afterAction:2');expect(bookings()).toEqual([]);
 const reasons=fixture.raw.prepare("SELECT json_extract(after_json,'$.reason') reason FROM audit_events WHERE source_kind='event_booking_action'").all();expect(reasons).toEqual([{reason:'申し込める空きがありません'},{reason:'申し込みがありません'}]);
});
test('同時申込・待ちの仮押さえ・停止回・締め切り・他店のIDを守る',async()=>{
 await Promise.all([runEventBookingAction(fixture.db,{eventId:'e1',slotId:'s1'},'f1','race1'),runEventBookingAction(fixture.db,{eventId:'e1',slotId:'s1'},'f2','race2')]);expect(bookings()).toHaveLength(1);
 await expect(runEventBookingAction(fixture.db,{eventId:'e1'},'f3','wrong')).rejects.toThrow('このアカウント');
 fixture.raw.exec("UPDATE event_slots SET is_active=0 WHERE id='s2'");expect((await runEventBookingAction(fixture.db,{eventId:'e1'},'f2','closed')).bookingIds).toEqual([]);
});
test('承認ありは承認待ちにし、友だちの申込上限と必須回答を飛ばさない',async()=>{
 fixture.raw.exec('UPDATE events SET requires_approval=1,max_bookings_per_friend=1');
 await runEventBookingAction(fixture.db,{eventId:'e1'},'f1','first');expect(bookings()).toEqual([{friend_id:'f1',slot_id:'s1',status:'requested'}]);expect(fixture.raw.prepare('SELECT COUNT(*) n FROM event_booking_reminders').get()).toEqual({n:0});
 expect((await runEventBookingAction(fixture.db,{eventId:'e1'},'f1','second')).reason).toBe('申し込める空きがありません');
 fixture.raw.exec(`UPDATE events SET questions_json='[{"id":"q1","required":true}]'`);
 expect((await runEventBookingAction(fixture.db,{eventId:'e1'},'f2','required')).reason).toContain('必須質問');
});
test('待ちの席を数え、締め切り直前の回を飛ばし、同じ工程の並走も1件にする',async()=>{
 fixture.raw.exec(`INSERT INTO event_waitlist(id,line_account_id,event_id,slot_id,friend_id,identity_key,party_size,status,created_at,updated_at) VALUES ('w1','a1','e1','s1','f2','solo:f2',1,'offered','2026-01-01','2026-01-01');`);
 await Promise.all([runEventBookingAction(fixture.db,{eventId:'e1'},'f1','same'),runEventBookingAction(fixture.db,{eventId:'e1'},'f1','same')]);
 expect(bookings()).toEqual([{friend_id:'f1',slot_id:'s2',status:'confirmed'}]);
 const soon=new Date(Date.now()+3600000).toISOString();fixture.raw.prepare('UPDATE event_slots SET starts_at=?,is_active=1 WHERE id=?').run(soon,'s1');fixture.raw.exec("DELETE FROM event_waitlist;UPDATE events SET entry_cutoff_hours_before=2");
 expect((await runEventBookingAction(fixture.db,{eventId:'e1',slotId:'s1'},'f2','cutoff')).bookingIds).toEqual([]);
});

test('人数の空きがあっても同じ人を同じ回へ重ねず、次の回を選ぶ',async()=>{
 fixture.raw.exec('UPDATE event_slots SET capacity=10');
 await runEventBookingAction(fixture.db,{eventId:'e1'},'f1','one');
 await runEventBookingAction(fixture.db,{eventId:'e1'},'f1','two');
 expect(bookings()).toEqual([{friend_id:'f1',slot_id:'s1',status:'confirmed'},{friend_id:'f1',slot_id:'s2',status:'confirmed'}]);
 expect((await runEventBookingAction(fixture.db,{eventId:'e1',slotId:'s1'},'f1','specific')).bookingIds).toEqual([]);
});

test('1回だけの行うことが並走しても、別の回へ重ねて申し込まない',async()=>{
 fixture.raw.exec(`INSERT INTO scenarios(id,name,trigger_type) VALUES ('scenario','案内','manual');
 INSERT INTO scenario_actions(id,scenario_id,hook,action_type,config_json,repeat_on_refire) VALUES ('booking-action','scenario','scenario_completed','event_booking','{"eventId":"e1"}',0);`);
 const action=fixture.raw.prepare("SELECT * FROM scenario_actions WHERE id='booking-action'").get() as ScenarioActionRow;
 await Promise.all([runActionRows(fixture.db,[action],'f1'),runActionRows(fixture.db,[action],'f1')]);
 expect(bookings()).toEqual([{friend_id:'f1',slot_id:'s1',status:'confirmed'}]);
});
