import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getBookingSyncRules, saveBookingSyncRules, listBookingSyncNotices, validateBookingSyncRules } from '@line-crm/db';
import { createTestD1, type SqliteD1 } from '../test-utils/d1-sqlite.js';
import { getBookingAutoAssign, saveBookingAutoAssign, notifyBookingConflicts } from './booking-channels.js';
import { evaluateBookingSyncNotices } from './booking-sync-rules.js';
import type { Env } from '../index.js';
const send=vi.hoisted(()=>vi.fn(async(_env:unknown,_input:unknown)=>false));
vi.mock('./booking-automatic-line.js',()=>({sendAutomaticBookingLine:send}));
let db:SqliteD1;
const now=new Date('2027-10-10T01:00:00Z');
const input={autoAssign:true,notifyConflicts:true,notifyCalendarDisconnected:true,notifyDailyLimit:true,dailyLimit:3,nearLimitRemaining:1,expectedVersion:0};
beforeEach(()=>{
 send.mockClear();db=createTestD1();
 db.raw.exec(`INSERT INTO line_accounts(id,name,channel_id,channel_secret,channel_access_token) VALUES('a','試験店','test','test','test'),('b','別店','other','other','other');
 INSERT INTO staff(id,line_account_id,name,display_name) VALUES('s','a','担当','担当'),('s2','b','別店の担当','別店の担当');
 INSERT INTO menus(id,line_account_id,name,duration_minutes,base_price) VALUES('m','a','試験メニュー',60,0);`);
});
afterEach(()=>db.raw.close());
function reserve(id:string,at='2027-10-10T10:00:00Z',source='import',status='confirmed'){
 db.raw.prepare(`INSERT INTO bookings(id,line_account_id,friend_id,staff_id,menu_id,starts_at,ends_at,block_ends_at,status,price_at_booking,requested_at,source)
 VALUES(?,'a','f','s','m',?,datetime(?,'+1 hour'),datetime(?,'+1 hour'),?,0,?,?)`).run(id,at,at,at,status,now.toISOString(),source);
}
const env=()=>({DB:db.db} as Env['Bindings']);
describe('人の予約の自動で合わせるルール',()=>{
 it('保存は版を検査し、存在しない非0版と古い版を拒否する',async()=>{
  expect(await saveBookingSyncRules(db.db,'a',{...input,expectedVersion:2})).toBe(false);
  expect(await saveBookingSyncRules(db.db,'a',input)).toBe(true);
  expect(await saveBookingSyncRules(db.db,'a',input)).toBe(false);
  expect((await getBookingSyncRules(db.db,'a')).version).toBe(1);
 });
 it('既存の自動割り当てと双方向で同期し、旧APIの変更も版に含める',async()=>{
  await saveBookingSyncRules(db.db,'a',input);expect(await getBookingAutoAssign(db.db,'a')).toBe(true);
  await saveBookingAutoAssign(db.db,'a',false);expect(await getBookingSyncRules(db.db,'a')).toMatchObject({autoAssign:false,version:2});
  expect(await saveBookingSyncRules(db.db,'a',{...input,expectedVersion:1})).toBe(false);
  expect(await saveBookingSyncRules(db.db,'a',{...input,expectedVersion:2})).toBe(true);
  expect((await getBookingSyncRules(db.db,'a')).version).toBe(3);
  expect((await getBookingSyncRules(db.db,'b')).autoAssign).toBe(false);
 });
 it('カレンダーの固定項目をOFFにする入力と不正な上限を拒否する',()=>{
  expect(validateBookingSyncRules(input)).toBe(true);
  expect(validateBookingSyncRules({...input,excludeCalendarBusy:false})).toBe(false);
  expect(validateBookingSyncRules({...input,dailyLimit:0})).toBe(false);
  expect(validateBookingSyncRules({...input,nearLimitRemaining:3})).toBe(false);
 });
 it('LINE以外の予約が入った未接続担当へ、重複しない知らせを残す',async()=>{
  reserve('b1');await evaluateBookingSyncNotices(env(),'a',now);await evaluateBookingSyncNotices(env(),'a',now);
  const notices=await listBookingSyncNotices(db.db,'a');expect(notices).toHaveLength(1);
  expect(notices[0]).toMatchObject({kind:'calendar_disconnected',staffId:'s',status:'open',date:'2027-10-10'});
  expect(await listBookingSyncNotices(db.db,'b')).toHaveLength(0);
 });
 it('LINEだけの予約には未接続通知を出さず、接続で通知が解消する',async()=>{
  reserve('liff',undefined,'liff');await evaluateBookingSyncNotices(env(),'a',now);expect(await listBookingSyncNotices(db.db,'a')).toHaveLength(0);
  reserve('external','2027-10-10T12:00:00Z');await evaluateBookingSyncNotices(env(),'a',now);
  db.raw.exec("INSERT INTO google_calendar_connections(id,line_account_id,staff_id,calendar_id,auth_type) VALUES('gc','a','s','test-calendar','service_account')");
  await evaluateBookingSyncNotices(env(),'a',now);
  expect((await listBookingSyncNotices(db.db,'a')).find(n=>n.kind==='calendar_disconnected')?.status).toBe('resolved');
 });
 it('店舗の日付で上限を数え、取消済みは除き、完了済みはその日の件数に含める',async()=>{
  await saveBookingSyncRules(db.db,'a',{...input,notifyConflicts:false,notifyCalendarDisconnected:false});
  reserve('b1','2027-10-10T10:00:00Z','liff','completed');reserve('b2','2027-10-10T12:00:00Z','liff');
  reserve('cancel','2027-10-10T11:00:00Z','liff','cancelled');reserve('next-day','2027-10-10T16:00:00Z','liff');
  await evaluateBookingSyncNotices(env(),'a',now);
  const notices=await listBookingSyncNotices(db.db,'a');expect(notices).toHaveLength(1);
  expect(notices[0]).toMatchObject({date:'2027-10-10',kind:'daily_limit',bookingCount:2,dailyLimit:3});
  db.raw.exec("UPDATE bookings SET status='cancelled' WHERE id='b2'");await evaluateBookingSyncNotices(env(),'a',now);
  expect((await listBookingSyncNotices(db.db,'a'))[0].status).toBe('resolved');
 });
 it('済みは同じ条件で再開せず、一度解消してから再接近すると新しい案内にする',async()=>{
  await saveBookingSyncRules(db.db,'a',input);reserve('b1');reserve('b2','2027-10-10T12:00:00Z');
  await evaluateBookingSyncNotices(env(),'a',now);
  db.raw.exec("UPDATE booking_sync_notices SET status='done'");await evaluateBookingSyncNotices(env(),'a',now);
  expect((await listBookingSyncNotices(db.db,'a')).every(n=>n.status==='done')).toBe(true);
  db.raw.exec("UPDATE bookings SET status='cancelled' WHERE id='b2'");await evaluateBookingSyncNotices(env(),'a',now);
  db.raw.exec("UPDATE bookings SET status='confirmed' WHERE id='b2'");await evaluateBookingSyncNotices(env(),'a',now);
  expect((await listBookingSyncNotices(db.db,'a')).find(n=>n.kind==='daily_limit')?.status).toBe('open');
 });
 it('ルールOFFで新しい2つの知らせと既存の重複LINE通知を止める',async()=>{
  await saveBookingSyncRules(db.db,'a',{...input,notifyConflicts:false,notifyDailyLimit:false,notifyCalendarDisconnected:false});reserve('b1');reserve('b2');
  await evaluateBookingSyncNotices(env(),'a',now);await notifyBookingConflicts(db.db,'a');
  expect(await listBookingSyncNotices(db.db,'a')).toHaveLength(0);expect(send).not.toHaveBeenCalled();
 });
 it('LINE連携の担当へ一度だけ案内し、LINE未接続の担当分は画面に残す',async()=>{
  db.raw.exec(`INSERT INTO tenants(id,name,status) VALUES('test-tenant','試験統括','active');
   UPDATE line_accounts SET tenant_id='test-tenant' WHERE id='a';
   INSERT INTO staff_members(id,name,role,api_key,tenant_id,line_user_id) VALUES('member','担当','staff','試験用','test-tenant','試験LINE');
   UPDATE staff SET staff_member_id='member' WHERE id='s';`);
  send.mockResolvedValueOnce(true);reserve('external');
  await evaluateBookingSyncNotices(env(),'a',now);await evaluateBookingSyncNotices(env(),'a',now);
  expect(send).toHaveBeenCalledTimes(1);
  expect(send.mock.calls[0][1]).toMatchObject({accountId:'a',to:'試験LINE',featureId:'booking'});
  expect(db.raw.prepare('SELECT sent_at FROM booking_sync_notice_outbox').get()).toMatchObject({sent_at:expect.any(String)});
 });

});
