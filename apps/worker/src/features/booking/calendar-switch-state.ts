
export interface CalendarSwitch {readEnabled:boolean;writeEnabled:boolean;version:number}

export async function calendarSwitch(db:D1Database,account:string,staff=''):Promise<CalendarSwitch> {
 const r=await db.prepare('SELECT read_enabled,write_enabled,version FROM booking_calendar_switches WHERE line_account_id=? AND scope_id=?').bind(account,staff).first<{read_enabled:number;write_enabled:number;version:number}>();
 return {readEnabled:!!r?.read_enabled,writeEnabled:!!r?.write_enabled,version:r?.version??0};
}

export async function calendarDirectionEnabled(db:D1Database,account:string,staff:string,direction:'read'|'write') {
 const [a,s]=await Promise.all([calendarSwitch(db,account),calendarSwitch(db,account,staff)]);return direction==='read'?a.readEnabled&&s.readEnabled:a.writeEnabled&&s.writeEnabled;
}
