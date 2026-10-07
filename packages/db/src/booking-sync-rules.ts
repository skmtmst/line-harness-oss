import type { BookingSyncRules, BookingSyncRulesInput, BookingSyncNotice } from '@line-crm/shared';
export async function getBookingSyncRules(db: D1Database, accountId: string): Promise<BookingSyncRules> {
  const r = await db.prepare('SELECT * FROM booking_sync_rules WHERE line_account_id=?').bind(accountId)
    .first<{auto_assign:number;notify_conflicts:number;notify_calendar_disconnected:number;notify_daily_limit:number;daily_limit:number;near_limit_remaining:number;version:number}>();
  const legacy = r ? null : await db.prepare("SELECT value FROM account_settings WHERE line_account_id=? AND key='booking_auto_assign'").bind(accountId).first<{value:string}>();
  return {lineAccountId:accountId,excludeCalendarBusy:true,writeLineBookingsToCalendar:true,autoAssign:r?!!r.auto_assign:legacy?.value==='true',
    notifyConflicts:r?!!r.notify_conflicts:true,notifyCalendarDisconnected:r?!!r.notify_calendar_disconnected:true,
    notifyDailyLimit:r?!!r.notify_daily_limit:true,dailyLimit:r?.daily_limit??10,nearLimitRemaining:r?.near_limit_remaining??2,version:r?.version??0};
}
export function validateBookingSyncRules(body: unknown): body is BookingSyncRulesInput {
  if(!body||typeof body!=='object')return false;
  const b=body as BookingSyncRulesInput;
  return [b.autoAssign,b.notifyConflicts,b.notifyCalendarDisconnected,b.notifyDailyLimit].every(v=>typeof v==='boolean')
    && (b.excludeCalendarBusy===undefined||b.excludeCalendarBusy===true) && (b.writeLineBookingsToCalendar===undefined||b.writeLineBookingsToCalendar===true)
    && Number.isSafeInteger(b.dailyLimit)&&b.dailyLimit>=1&&b.dailyLimit<=1000
    && Number.isSafeInteger(b.nearLimitRemaining)&&b.nearLimitRemaining>=0&&b.nearLimitRemaining<b.dailyLimit
    && Number.isSafeInteger(b.expectedVersion)&&b.expectedVersion>=0;
}
export async function saveBookingSyncRules(db: D1Database,accountId:string,b:BookingSyncRulesInput): Promise<boolean> {
  const result=await db.prepare(`INSERT INTO booking_sync_rules(line_account_id,auto_assign,notify_conflicts,notify_calendar_disconnected,notify_daily_limit,daily_limit,near_limit_remaining)
    SELECT ?,?,?,?,?,?,? WHERE ?=0 OR EXISTS(SELECT 1 FROM booking_sync_rules WHERE line_account_id=?)
    ON CONFLICT(line_account_id) DO UPDATE SET auto_assign=excluded.auto_assign,notify_conflicts=excluded.notify_conflicts,
    notify_calendar_disconnected=excluded.notify_calendar_disconnected,notify_daily_limit=excluded.notify_daily_limit,
    daily_limit=excluded.daily_limit,near_limit_remaining=excluded.near_limit_remaining,version=version+1,updated_at=datetime('now') WHERE version=?`)
    .bind(accountId,Number(b.autoAssign),Number(b.notifyConflicts),Number(b.notifyCalendarDisconnected),Number(b.notifyDailyLimit),b.dailyLimit,b.nearLimitRemaining,b.expectedVersion,accountId,b.expectedVersion).run();
  return result.meta.changes>0;
}
export async function listBookingSyncNotices(db:D1Database,accountId:string):Promise<BookingSyncNotice[]> {
  const rows=await db.prepare(`SELECT * FROM booking_sync_notices WHERE line_account_id=? ORDER BY target_date DESC,created_at DESC LIMIT 500`).bind(accountId)
    .all<{id:string;line_account_id:string;staff_id:string;target_date:string;kind:BookingSyncNotice['kind'];status:BookingSyncNotice['status'];booking_id:string|null;booking_count:number;daily_limit:number|null;message:string;created_at:string;updated_at:string}>();
  return rows.results.map(r=>({id:r.id,lineAccountId:r.line_account_id,staffId:r.staff_id,date:r.target_date,kind:r.kind,status:r.status,
    bookingId:r.booking_id,bookingCount:r.booking_count,dailyLimit:r.daily_limit,message:r.message,createdAt:r.created_at,updatedAt:r.updated_at}));
}
