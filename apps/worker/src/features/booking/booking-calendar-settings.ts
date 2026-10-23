export { readCalendarBusy } from './calendar-busy-read.js';
import { readCalendarBusy } from './calendar-busy-read.js';
export { calendarSwitch, calendarDirectionEnabled } from './calendar-switch-state.js';
import { calendarSwitch, calendarDirectionEnabled } from './calendar-switch-state.js';
export type { CalendarSwitch } from './calendar-switch-state.js';
import type { CalendarSwitch } from './calendar-switch-state.js';
import { deleteBookingCalendarEvent } from './booking-calendar-sync.js';
import type {GoogleServiceAccountCredentials} from '../../services/google-service-account.js';
import {clientForConnection,getStaffCalendarConnection,runBookingGoogleSync} from './booking-calendar-sync.js';
import {GoogleCalendarReadError,type BusyInterval} from '../../services/google-calendar.js';
import {createFeatureJobGate} from '../../services/feature-enforcement.js';
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
    const b=await db.prepare('SELECT starts_at,external_event_id,external_calendar_id,lock_version FROM bookings WHERE id=?').bind(j.booking_id).first<{starts_at:string;external_event_id:string|null;external_calendar_id:string|null;lock_version:number}>();
    if(b&&Date.parse(b.starts_at)>now.getTime()&&j.external_event_id&&j.calendar_id){
     const conn=await db.prepare('SELECT id,calendar_id,auth_type,access_token FROM google_calendar_connections WHERE line_account_id=? AND staff_id=? AND calendar_id=? AND is_active=1').bind(j.line_account_id,j.staff_id,j.calendar_id).first<import('./booking-calendar-sync.js').StaffCalendarConnection>();
     if(!conn)throw new Error('calendar_disconnected');
     if(b.external_event_id!==j.external_event_id||b.external_calendar_id!==j.calendar_id){await db.prepare("UPDATE booking_calendar_switch_jobs SET status='cancelled' WHERE id=?").bind(j.id).run();continue;}
     const client=await clientForConnection(conn,credentials,{db,accountId:j.line_account_id});
     await deleteBookingCalendarEvent(db,{bookingId:j.booking_id,lineAccountId:j.line_account_id,calendarId:j.calendar_id,eventId:j.external_event_id,connectionId:conn.id,client});
     await db.prepare('UPDATE bookings SET external_event_id=NULL,external_calendar_id=NULL WHERE id=? AND external_event_id=? AND lock_version=?').bind(j.booking_id,j.external_event_id,b.lock_version).run();
    }
   } else {const result=await runBookingGoogleSync(db,{bookingId:j.booking_id,lineAccountId:j.line_account_id,credentials,now});if(result==='retry_wait')throw new Error('calendar_write_failed');}
   await db.prepare("UPDATE booking_calendar_switch_jobs SET status='done',attempts=attempts+1,error_code=NULL WHERE id=?").bind(j.id).run();
  }catch{await db.prepare("UPDATE booking_calendar_switch_jobs SET status='failed',attempts=attempts+1,error_code='calendar_sync_failed' WHERE id=?").bind(j.id).run();}
 }
}
export async function refreshCalendarBusyCaches(db:D1Database,credentials:GoogleServiceAccountCredentials,now=new Date(),options:{accountId?:string;attemptedBefore?:string}={}):Promise<{processed:number;hasMore:boolean}> {
 const gate=createFeatureJobGate();
 const scoped=options.accountId!==undefined;
 const limit=scoped?1:100;
 const attemptedBefore=scoped?options.attemptedBefore:undefined;
 if(attemptedBefore!==undefined&&!Number.isFinite(Date.parse(attemptedBefore)))throw new Error('calendar_refresh_boundary_invalid');
 const age='MAX(COALESCE(julianday(attempt.value),0),COALESCE(julianday(cache.last_read_at),0))';
 let processed=0;
 const controller=new AbortController();
 const deadline=Date.now()+50_000;
 const timer=setTimeout(()=>controller.abort(),50_000);
 try {
  const rows=(await db.prepare(`SELECT g.id,g.line_account_id,g.staff_id,COALESCE(bs.booking_window_days,60) window_days
   FROM google_calendar_connections g
   LEFT JOIN booking_settings bs ON bs.line_account_id=g.line_account_id
   JOIN line_accounts a ON a.id=g.line_account_id AND a.is_active=1
   JOIN booking_calendar_switches s ON s.line_account_id=g.line_account_id AND s.scope_id=g.staff_id AND s.read_enabled=1
   JOIN booking_calendar_switches a_s ON a_s.line_account_id=g.line_account_id AND a_s.scope_id='' AND a_s.read_enabled=1
   LEFT JOIN platform_settings attempt ON attempt.key='calendar-busy-attempt:'||g.id
   LEFT JOIN booking_calendar_busy_cache cache ON cache.line_account_id=g.line_account_id AND cache.staff_id=g.staff_id
    AND cache.connection_id=g.id AND cache.calendar_id=g.calendar_id
   WHERE g.is_active=1 ${scoped?'AND g.line_account_id=?':''}
    ${attemptedBefore===undefined?'':`AND ${age}<julianday(?)`}
   ORDER BY ${age},g.id
   LIMIT ?`).bind(...(scoped?[options.accountId]:[]),...(attemptedBefore===undefined?[]:[attemptedBefore]),limit+1)
   .all<{id:string;line_account_id:string;staff_id:string;window_days:number}>()).results;
  const selected=rows.slice(0,limit);
  for(let i=0;i<selected.length;i+=5) {
   if(controller.signal.aborted||Date.now()>=deadline)break;
   await Promise.all(selected.slice(i,i+5).map(async r=>{
    try {
     if(controller.signal.aborted||Date.now()>=deadline)return;
     // 成功時刻は書き換えない。機能停止・接続障害も試行済みとして次の接続へ順番を回す。
     const attemptedAt=new Date().toISOString();
     await db.prepare(`INSERT INTO platform_settings(key,value,updated_by,updated_at) VALUES(?,?,'calendar-busy-refresh',?)
      ON CONFLICT(key) DO UPDATE SET value=excluded.value,updated_by=excluded.updated_by,updated_at=excluded.updated_at`)
      .bind(`calendar-busy-attempt:${r.id}`,attemptedAt,attemptedAt).run();
     processed++;
     if(!await gate.canRun(db,r.line_account_id,'booking','calendar busy cache and switch jobs'))return;
     if(controller.signal.aborted||Date.now()>=deadline)return;
     await readCalendarBusy(db,credentials,{lineAccountId:r.line_account_id,staffId:r.staff_id,
      timeMin:new Date(now.getTime()-86400000).toISOString(),timeMax:new Date(now.getTime()+(Math.min(365,Math.max(1,r.window_days))+1)*86400000).toISOString(),
      fresh:true,signal:controller.signal});
    }catch{/* 1接続の障害で後続を止めない。期限切れの控えは空きの入口で閉じる。 */}
   }));
  }
  return {processed,hasMore:rows.length>limit||processed<selected.length};
 } finally {clearTimeout(timer);}
}
export function validMeetingUrl(value:unknown):value is string|null {
 if(value===null)return true;if(typeof value!=='string'||value.length>2048)return false;
 try{const u=new URL(value);return u.protocol==='https:'&&!!u.hostname&&!u.username&&!u.password;}catch{return false;}
}
