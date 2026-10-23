import type { GoogleServiceAccountCredentials } from '../../services/google-service-account.js';
import type { BusyInterval } from '../../services/google-calendar.js';
import { GoogleCalendarReadError } from '../../services/google-calendar.js';
import { calendarDirectionEnabled } from './calendar-switch-state.js';
import { getStaffCalendarConnection, clientForConnection } from './calendar-connection.js';
export async function readCalendarBusy(db:D1Database,credentials:GoogleServiceAccountCredentials,input:{lineAccountId:string;staffId:string;timeMin:string;timeMax:string;fresh?:boolean;signal?:AbortSignal}):Promise<BusyInterval[]|null> {
 input.signal?.throwIfAborted();
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
  input.signal?.throwIfAborted();
  const client=await clientForConnection(conn,credentials,{db,accountId:input.lineAccountId}),busy=await client.getTimedBusy(input.timeMin,input.timeMax,input.signal);
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
