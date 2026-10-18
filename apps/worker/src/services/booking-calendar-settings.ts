import type {GoogleServiceAccountCredentials} from './google-service-account.js';
import {clientForConnection,getStaffCalendarConnection,runBookingGoogleSync} from './booking-calendar-sync.js';
import {GoogleCalendarReadError,type BusyInterval} from './google-calendar.js';
import {createFeatureJobGate} from './feature-enforcement.js';
export interface CalendarSwitch {readEnabled:boolean;writeEnabled:boolean;version:number}
export async function calendarSwitch(db:D1Database,account:string,staff=''):Promise<CalendarSwitch> {
 const r=await db.prepare('SELECT read_enabled,write_enabled,version FROM booking_calendar_switches WHERE line_account_id=? AND scope_id=?').bind(account,staff).first<{read_enabled:number;write_enabled:number;version:number}>();
 return {readEnabled:!!r?.read_enabled,writeEnabled:!!r?.write_enabled,version:r?.version??0};
}
export async function calendarDirectionEnabled(db:D1Database,account:string,staff:string,direction:'read'|'write') {
 const [a,s]=await Promise.all([calendarSwitch(db,account),calendarSwitch(db,account,staff)]);return direction==='read'?a.readEnabled&&s.readEnabled:a.writeEnabled&&s.writeEnabled;
}
export async function readCalendarBusy(db:D1Database,credentials:GoogleServiceAccountCredentials,input:{lineAccountId:string;staffId:string;timeMin:string;timeMax:string;fresh?:boolean}):Promise<BusyInterval[]|null> {
 if(!await calendarDirectionEnabled(db,input.lineAccountId,input.staffId,'read'))return null;
 const conn=await getStaffCalendarConnection(db,input.lineAccountId,input.staffId);
 if(!conn)return null; // 明示的な接続解除後は勤務の枠へ戻る。
 const health=await db.prepare('SELECT error_code FROM booking_calendar_read_health WHERE line_account_id=? AND staff_id=?').bind(input.lineAccountId,input.staffId).first<{error_code:string|null}>();
 if(!input.fresh&&health?.error_code==='calendar_disconnected')throw new GoogleCalendarReadError(403);
 const cache=await db.prepare('SELECT * FROM booking_calendar_busy_cache WHERE line_account_id=? AND staff_id=? AND connection_id=? AND calendar_id=?').bind(input.lineAccountId,input.staffId,conn.id,conn.calendar_id)
  .first<{busy_json:string;time_min:string;time_max:string;last_read_at:string}>();
 const usable=cache&&Date.parse(cache.last_read_at)>Date.now()-15*60000&&Date.parse(cache.time_min)<=Date.parse(input.timeMin)&&Date.parse(cache.time_max)>=Date.parse(input.timeMax);
 if(!input.fresh&&usable)return JSON.parse(cache.busy_json);
 try {
  const client=await clientForConnection(conn,credentials),busy=await client.getTimedBusy(input.timeMin,input.timeMax);
  const own=new Set((await db.prepare('SELECT external_event_id FROM bookings WHERE line_account_id=? AND external_calendar_id=? AND external_event_id IS NOT NULL').bind(input.lineAccountId,conn.calendar_id).all<{external_event_id:string}>()).results.map(r=>r.external_event_id));
  const intervals=busy.filter(r=>!own.has(r.id)).map(({start,end})=>({start,end}));
  await db.prepare(`INSERT INTO booking_calendar_busy_cache(line_account_id,staff_id,connection_id,calendar_id,time_min,time_max,busy_json,last_read_at)
   VALUES(?,?,?,?,?,?,?,?) ON CONFLICT(line_account_id,staff_id) DO UPDATE SET connection_id=excluded.connection_id,calendar_id=excluded.calendar_id,
   time_min=excluded.time_min,time_max=excluded.time_max,busy_json=excluded.busy_json,last_read_at=excluded.last_read_at`)
   .bind(input.lineAccountId,input.staffId,conn.id,conn.calendar_id,input.timeMin,input.timeMax,JSON.stringify(intervals),new Date().toISOString()).run();
  await db.prepare(`INSERT INTO booking_calendar_read_health(line_account_id,staff_id,last_success_at) VALUES(?,?,?) ON CONFLICT(line_account_id,staff_id) DO UPDATE SET last_success_at=excluded.last_success_at,failed_since=NULL,error_code=NULL`).bind(input.lineAccountId,input.staffId,new Date().toISOString()).run();
  return intervals;
 } catch(e) {
  await db.prepare(`INSERT INTO booking_calendar_read_health(line_account_id,staff_id,failed_since,error_code) VALUES(?,?,?,?) ON CONFLICT(line_account_id,staff_id) DO UPDATE SET failed_since=COALESCE(failed_since,excluded.failed_since),error_code=excluded.error_code`)
   .bind(input.lineAccountId,input.staffId,new Date().toISOString(),e instanceof GoogleCalendarReadError&&[401,403].includes(e.status)?'calendar_disconnected':'calendar_unavailable').run();
  if(!input.fresh&&usable&&!(e instanceof GoogleCalendarReadError&&[401,403].includes(e.status)))return JSON.parse(cache.busy_json);
  throw e;
 }
}
export async function processCalendarSwitchJobs(db:D1Database,credentials:GoogleServiceAccountCredentials,now=new Date()) {
 const gate=createFeatureJobGate();
 const jobs=(await db.prepare(`SELECT * FROM booking_calendar_switch_jobs WHERE status IN('pending','failed') AND attempts<3 ORDER BY created_at,id LIMIT 50`).all<{
  id:string;line_account_id:string;staff_id:string;booking_id:string;action:'write'|'delete';external_event_id:string|null;calendar_id:string|null;switch_scope:string;switch_version:number;
 }>()).results;
 for(const j of jobs){
  if(!await gate.canRun(db,j.line_account_id,'booking','calendar busy cache and switch jobs'))continue;
  const s=await calendarSwitch(db,j.line_account_id,j.switch_scope);
  if(s.version!==j.switch_version||(j.action==='delete'?s.writeEnabled:!s.writeEnabled)) {await db.prepare("UPDATE booking_calendar_switch_jobs SET status='cancelled' WHERE id=?").bind(j.id).run();continue;}
  try{
   if(j.action==='delete'){
    const b=await db.prepare('SELECT starts_at FROM bookings WHERE id=?').bind(j.booking_id).first<{starts_at:string}>();
    if(b&&Date.parse(b.starts_at)>now.getTime()&&j.external_event_id&&j.calendar_id){
     const conn=await db.prepare('SELECT id,calendar_id,auth_type,access_token FROM google_calendar_connections WHERE line_account_id=? AND staff_id=? AND calendar_id=? AND is_active=1').bind(j.line_account_id,j.staff_id,j.calendar_id).first<import('./booking-calendar-sync.js').StaffCalendarConnection>();
     if(!conn)throw new Error('calendar_disconnected');
     await (await clientForConnection(conn,credentials)).deleteEvent(j.external_event_id);
     await db.prepare('UPDATE bookings SET external_event_id=NULL,external_calendar_id=NULL WHERE id=? AND external_event_id=?').bind(j.booking_id,j.external_event_id).run();
    }
   } else {const result=await runBookingGoogleSync(db,{bookingId:j.booking_id,lineAccountId:j.line_account_id,credentials,now});if(result==='retry_wait')throw new Error('calendar_write_failed');}
   await db.prepare("UPDATE booking_calendar_switch_jobs SET status='done',attempts=attempts+1,error_code=NULL WHERE id=?").bind(j.id).run();
  }catch{await db.prepare("UPDATE booking_calendar_switch_jobs SET status='failed',attempts=attempts+1,error_code='calendar_sync_failed' WHERE id=?").bind(j.id).run();}
 }
}
export async function refreshCalendarBusyCaches(db:D1Database,credentials:GoogleServiceAccountCredentials,now=new Date()) {
 const gate=createFeatureJobGate();
 const rows=(await db.prepare(`SELECT g.line_account_id,g.staff_id,COALESCE(bs.booking_window_days,60) window_days FROM google_calendar_connections g LEFT JOIN booking_settings bs ON bs.line_account_id=g.line_account_id JOIN line_accounts a ON a.id=g.line_account_id AND a.is_active=1
  JOIN booking_calendar_switches s ON s.line_account_id=g.line_account_id AND s.scope_id=g.staff_id AND s.read_enabled=1
  JOIN booking_calendar_switches a_s ON a_s.line_account_id=g.line_account_id AND a_s.scope_id='' AND a_s.read_enabled=1 WHERE g.is_active=1 LIMIT 100`).all<{line_account_id:string;staff_id:string;window_days:number}>()).results;
 for(let i=0;i<rows.length;i+=5) await Promise.all(rows.slice(i,i+5).map(async r=>{if(!await gate.canRun(db,r.line_account_id,'booking','calendar busy cache and switch jobs'))return;try{await readCalendarBusy(db,credentials,{lineAccountId:r.line_account_id,staffId:r.staff_id,timeMin:new Date(now.getTime()-86400000).toISOString(),timeMax:new Date(now.getTime()+(Math.min(365,Math.max(1,r.window_days))+1)*86400000).toISOString(),fresh:true});}catch{/* 期限切れの控えは空きの入口で閉じる。既存の同期通知が運用者に知らせる。 */}}));
}
export function validMeetingUrl(value:unknown):value is string|null {
 if(value===null)return true;if(typeof value!=='string'||value.length>2048)return false;
 try{const u=new URL(value);return u.protocol==='https:'&&!!u.hostname&&!u.username&&!u.password;}catch{return false;}
}
