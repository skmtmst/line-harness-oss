import type { RestaurantClosure, RestaurantClosureInput, RestaurantClosurePreview, RestaurantSeatAvailability } from '@line-crm/shared';
import { restaurantCivilTime, validRestaurantDate } from './restaurant-booking.js';
import { tzDateStr } from './availability.js';
export type ClosurePeriod = { startsAt: string; endsAt: string };
export type ClosureRow = {
 id: string; store_id: string; start_date: string; end_date: string; all_day: number; start_time: string | null; end_time: string | null;
 kind: RestaurantClosure['kind']; memo: string | null; table_ids_json: string; periods_json: string; created_by: string | null;
 created_by_name: string | null; created_at: string; updated_at: string; version: number; archived_at: string | null;
};
export function publicClosure(r: ClosureRow): RestaurantClosure {
 return {id:r.id,storeId:r.store_id,startDate:r.start_date,endDate:r.end_date,allDay:!!r.all_day,startTime:r.start_time,endTime:r.end_time,
 kind:r.kind,memo:r.memo,tableIds:JSON.parse(r.table_ids_json),createdBy:r.created_by,createdByName:r.created_by_name,createdAt:r.created_at,updatedAt:r.updated_at,version:r.version};
}
const minute = (t:string) => Number(t.slice(0,2))*60+Number(t.slice(3));
export function validateClosure(b:unknown,timezone:string,now=new Date()): {input:RestaurantClosureInput;periods:ClosurePeriod[]} | null {
 if(!b||typeof b!=='object')return null;
 const r=b as RestaurantClosureInput;
 if(typeof r.storeId!=='string'||!r.storeId||typeof r.startDate!=='string'||typeof r.endDate!=='string'
 ||!validRestaurantDate(r.startDate)||!validRestaurantDate(r.endDate)||r.startDate<tzDateStr(timezone,now)||r.endDate<r.startDate
 ||Date.parse(r.endDate)-Date.parse(r.startDate)>365*86400000||typeof r.allDay!=='boolean'
 ||!['temporary_closed','private_event','maintenance','other'].includes(r.kind)
 ||(r.memo!=null&&(typeof r.memo!=='string'||r.memo.length>1000))
 ||(r.tableIds!==undefined&&(!Array.isArray(r.tableIds)||r.tableIds.length>1000||r.tableIds.some(t=>typeof t!=='string'||!t)||new Set(r.tableIds).size!==r.tableIds.length)))return null;
 if(!r.allDay&&(typeof r.startTime!=='string'||typeof r.endTime!=='string'||!/^([01]\d|2[0-3]):[0-5]\d$/.test(r.startTime)
 ||!/^(([01]\d|2[0-3]):[0-5]\d|24:00)$/.test(r.endTime)||minute(r.startTime)>=minute(r.endTime)))return null;
 const input:RestaurantClosureInput={storeId:r.storeId,startDate:r.startDate,endDate:r.endDate,allDay:r.allDay,
 startTime:r.allDay?null:r.startTime,endTime:r.allDay?null:r.endTime,kind:r.kind,memo:r.memo?.trim()||null,tableIds:r.tableIds??[]};
 const periods:ClosurePeriod[]=[];
 for(let d=Date.parse(r.startDate);d<=Date.parse(r.endDate);d+=86400000){const date=new Date(d).toISOString().slice(0,10);
  periods.push({startsAt:restaurantCivilTime(date,r.allDay?0:minute(r.startTime!),timezone),endsAt:restaurantCivilTime(date,r.allDay?1440:minute(r.endTime!),timezone)});}
 return {input,periods};
}
export async function closuresForRange(db:D1Database,storeId:string,from:string,to:string):Promise<ClosureRow[]> {
 return (await db.prepare(`SELECT c.* FROM rt_closures c WHERE c.store_id=? AND c.archived_at IS NULL AND EXISTS(
 SELECT 1 FROM json_each(c.periods_json) p WHERE julianday(json_extract(p.value,'$.startsAt'))<julianday(?) AND julianday(json_extract(p.value,'$.endsAt'))>julianday(?)) ORDER BY c.start_date,c.start_time,c.id`)
 .bind(storeId,to,from).all<ClosureRow>()).results;
}
export function closureAffectsTable(r:ClosureRow,tableId:string|null):boolean {
 const ids=JSON.parse(r.table_ids_json) as string[];return !ids.length||tableId===null||ids.includes(tableId);
}
export async function closurePreview(db:D1Database,input:RestaurantClosureInput,periods:ClosurePeriod[],excludeId:string|null=null):Promise<RestaurantClosurePreview> {
 const args=[input.storeId,JSON.stringify(periods),JSON.stringify(input.tableIds??[])];
 const overlap=`EXISTS(SELECT 1 FROM json_each(?) p WHERE julianday(r.starts_at)<julianday(json_extract(p.value,'$.endsAt')) AND julianday(r.ends_at)>julianday(json_extract(p.value,'$.startsAt')))
 AND (json_array_length(?)=0 OR r.table_id IS NULL OR r.table_id IN (SELECT value FROM json_each(?)))`;
 const reservations=(await db.prepare(`SELECT r.id,r.starts_at AS startsAt,r.ends_at AS endsAt,r.guest_count AS guestCount,r.customer_name AS customerName,r.source,r.table_id AS tableId,
 (SELECT f.id FROM friends f JOIN rt_stores s ON s.line_account_id=f.line_account_id WHERE s.id=r.store_id AND f.line_user_id=r.line_uid AND f.is_following=1 LIMIT 1) AS friendId
 FROM rt_reservations r WHERE r.store_id=? AND r.status NOT IN ('cancelled','no_show') AND r.hold_expires_at IS NULL AND ${overlap} ORDER BY julianday(r.starts_at),r.id`)
 .bind(...args,args[2]).all<Omit<RestaurantClosurePreview['reservations'][number],'isLineFriend'>>()).results;
 const waiting=await db.prepare(`SELECT COUNT(*) AS count FROM (SELECT w.*,COALESCE(w.ends_at,datetime(w.starts_at,'+120 minutes')) AS end_time FROM rt_seat_waitlist w) r
 WHERE r.store_id=? AND r.status IN ('waiting','invited') AND EXISTS(SELECT 1 FROM json_each(?) p WHERE julianday(r.starts_at)<julianday(json_extract(p.value,'$.endsAt')) AND julianday(r.end_time)>julianday(json_extract(p.value,'$.startsAt')))
 AND (json_array_length(?)=0 OR r.table_id IS NULL OR r.table_id IN (SELECT value FROM json_each(?)))`).bind(...args,args[2]).first<{count:number}>();
 const candidates=await closuresForRange(db,input.storeId,periods[0].startsAt,periods.at(-1)!.endsAt);
 const conflicts=candidates.filter(r=>r.id!==excludeId&&(input.tableIds!.length===0||JSON.parse(r.table_ids_json).length===0||input.tableIds!.some(id=>closureAffectsTable(r,id)))
 &&(JSON.parse(r.periods_json) as ClosurePeriod[]).some(a=>periods.some(b=>Date.parse(a.startsAt)<Date.parse(b.endsAt)&&Date.parse(a.endsAt)>Date.parse(b.startsAt)))).map(publicClosure);
 return {reservations:reservations.map(r=>({...r,isLineFriend:r.friendId!==null})),waitlistCount:waiting?.count??0,conflicts};
}
/** 空き照会・手動の自動配席・待機登録で共通。予約で埋まっていても閉じていない卓は候補に残せる。 */
export async function openSeatTables(db:D1Database,storeId:string,startsAt:string,endsAt:string,guestCount:number,ignoreReservations=false):Promise<RestaurantSeatAvailability['tables']> {
 const closed=await closuresForRange(db,storeId,startsAt,endsAt);
 const tables=(await db.prepare(`SELECT t.id,t.label,t.min_capacity AS minCapacity,t.max_capacity AS maxCapacity FROM rt_tables t
 WHERE t.store_id=? AND t.is_active=1 AND t.min_capacity<=? AND t.max_capacity>=?
 AND (?=1 OR (NOT EXISTS(SELECT 1 FROM rt_reservations r WHERE r.store_id=t.store_id AND r.table_id=t.id AND r.status NOT IN ('cancelled','no_show')
 AND (r.hold_expires_at IS NULL OR julianday(r.hold_expires_at)>julianday('now')) AND julianday(r.starts_at)<julianday(?) AND julianday(r.ends_at)>julianday(?))
 AND NOT EXISTS(SELECT 1 FROM rt_seat_waitlist w WHERE w.store_id=t.store_id AND w.table_id=t.id AND w.status='invited' AND julianday(w.hold_expires_at)>julianday('now')
 AND julianday(w.starts_at)<julianday(?) AND julianday(COALESCE(w.ends_at,datetime(w.starts_at,'+120 minutes')))>julianday(?)))) ORDER BY t.max_capacity,t.id`)
 .bind(storeId,guestCount,guestCount,Number(ignoreReservations),endsAt,startsAt,endsAt,startsAt).all<RestaurantSeatAvailability['tables'][number]>()).results;
 return tables.filter(t=>!closed.some(r=>closureAffectsTable(r,t.id)));
}
