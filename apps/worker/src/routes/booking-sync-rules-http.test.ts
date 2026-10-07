import { Hono } from 'hono';
import { beforeEach, afterEach, describe, it, expect, vi } from 'vitest';
import { createTestD1, type SqliteD1 } from '../test-utils/d1-sqlite.js';
import type { Env } from '../index.js';
const access=vi.hoisted(()=>({allow:true}));
vi.mock('../services/account-access.js',()=>({canAccessAllLineAccounts:vi.fn(async()=>access.allow)}));
vi.mock('../services/booking-automatic-line.js',()=>({sendAutomaticBookingLine:vi.fn(async()=>false)}));
import booking from './booking.js';
let db:SqliteD1;
let role:'owner'|'staff'='owner';
const input={autoAssign:true,notifyConflicts:false,notifyCalendarDisconnected:true,notifyDailyLimit:true,dailyLimit:10,nearLimitRemaining:2,expectedVersion:0};
function request(path:string,body?:unknown,method=body?'PUT':'GET') {
 const app=new Hono<Env>();app.use('*',async(c,next)=>{c.set('staff',{id:'login',name:'試験',role,readOnly:false,permissionKeys:[]});await next();});app.route('/',booking);
 return app.request(path,{method,...(body?{headers:{'Content-Type':'application/json'},body:JSON.stringify(body)}:{})},{DB:db.db});
}
beforeEach(()=>{db=createTestD1();role='owner';access.allow=true;db.raw.exec("INSERT INTO line_accounts(id,name,channel_id,channel_secret,channel_access_token) VALUES('a','試験店','test','test','test'),('b','別店','other','other','other')");});
afterEach(()=>db.raw.close());
describe('予約同期ルールと知らせのHTTP API',()=>{
 const path='/api/booking/admin/sync-rules?account_id=a';
 it('固定項目・初期版を返し、保存と競合409を返す',async()=>{
  expect(await (await request(path)).json()).toMatchObject({success:true,data:{excludeCalendarBusy:true,writeLineBookingsToCalendar:true,version:0}});
  expect((await request(path,input)).status).toBe(200);
  expect((await request(path,input)).status).toBe(409);
  expect(await (await request(path)).json()).toMatchObject({success:true,data:{autoAssign:true,notifyConflicts:false,version:1}});
 });
 it('担当外のアカウントと予約設定権限のないスタッフの保存を拒否する',async()=>{
  access.allow=false;expect((await request(path)).status).toBe(403);
  access.allow=true;role='staff';expect((await request(path,input)).status).toBe(403);
 });
 it('一覧と済みはアカウントで限定し、別店の通知は操作できない',async()=>{
  db.raw.exec(`INSERT INTO staff(id,line_account_id,name,display_name) VALUES('s','a','担当','担当');
   INSERT INTO booking_sync_notices(id,line_account_id,notice_key,staff_id,target_date,kind,status,message) VALUES('notice','a','test','s','2027-10-10','daily_limit','open','閉じてください');`);
  expect(await (await request('/api/booking/admin/sync-notices?account_id=a')).json()).toMatchObject({data:[{id:'notice',kind:'daily_limit',status:'open'}]});
  expect((await request('/api/booking/admin/sync-notices/notice/done?account_id=b',{},'POST')).status).toBe(404);
  expect((await request('/api/booking/admin/sync-notices/notice/done?account_id=a',{},'POST')).status).toBe(200);
 });
 it('上限と近い件数が不正なら保存しない',async()=>{
  expect((await request(path,{...input,nearLimitRemaining:10})).status).toBe(400);
 });
});
