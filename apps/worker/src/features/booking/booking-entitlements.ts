export { EntitlementError } from './entitlement-error.js';
import { EntitlementError } from './entitlement-error.js';
import {expandPlanGrant,passUnusable} from './booking-pass-plans.js';
import type { BookingEntitlement, BookingEntitlementGrant, BookingEntitlementOperation, BookingEntitlementView } from '@line-crm/shared';
import { getAccountTimeZone, tzDateStr } from '../../services/availability.js';
import { restaurantCivilTime } from '../../services/restaurant-booking.js';
const invalid = () => { throw new EntitlementError('invalid_entitlement_input',400); };
const text = (v: unknown, max: number): v is string => typeof v==='string' && !!v.trim() && v.length<=max;
const instant = (v: unknown): v is string => typeof v==='string' && /^\d{4}-\d\d-\d\dT.*(Z|[+-]\d\d:\d\d)$/.test(v) && Number.isFinite(Date.parse(v));
const integer = (v: unknown, min: number): v is number => Number.isSafeInteger(v) && Number(v)>=min && Number(v)<=1_000_000;
export function entitlementMonth(at: string, timezone: string) {
  const date = tzDateStr(timezone,new Date(at));
  const y=Number(date.slice(0,4)), m=Number(date.slice(5,7));
  const next=new Date(Date.UTC(y,m,1)).toISOString().slice(0,10);
  return {periodStart:restaurantCivilTime(`${date.slice(0,7)}-01`,0,timezone),periodEnd:restaurantCivilTime(next,0,timezone)};
}
export async function entitlementViews(db: D1Database, accountId: string, friendId: string, at: string): Promise<BookingEntitlementView[]> {
  const period=entitlementMonth(at,await getAccountTimeZone(db,accountId));
  const rows=await db.prepare(`SELECT e.*, COALESCE((SELECT allowance FROM booking_entitlement_month_limits ml WHERE ml.entitlement_id=e.id AND ml.period_start=?),e.monthly_limit) AS monthAllowance, ((SELECT COUNT(*) FROM booking_entitlement_uses u JOIN bookings b ON b.id=u.booking_id
    WHERE u.entitlement_id=e.id AND u.consumed_at IS NOT NULL AND u.returned_at IS NULL AND julianday(b.starts_at)>=julianday(?) AND julianday(b.starts_at)<julianday(?)) + (SELECT COUNT(*) FROM event_booking_entitlement_uses u WHERE u.entitlement_id=e.id AND u.consumed_at IS NOT NULL AND u.returned_at IS NULL AND julianday(u.starts_at)>=julianday(?) AND julianday(u.starts_at)<julianday(?))) AS monthUsed
    FROM booking_entitlements e WHERE e.line_account_id=? AND e.friend_id=? ORDER BY e.expires_at,e.id`)
    .bind(period.periodStart,period.periodStart,period.periodEnd,period.periodStart,period.periodEnd,accountId,friendId).all<BookingEntitlement & {monthUsed:number;monthAllowance:number|null}>();
  return rows.results.map(e=>({...e,...period,monthRemaining:e.kind==='monthly'&&e.monthAllowance!==null?Math.max(0,e.monthAllowance-e.monthUsed):null}));
}
async function replay(db: D1Database, account: string, key: string, request: string) {
  const row=await db.prepare('SELECT entitlement_id,request_json,after_json FROM booking_entitlement_events WHERE line_account_id=? AND request_key=?')
    .bind(account,key).first<{entitlement_id:string;request_json:string;after_json:string}>();
  if (!row) return null;
  if(row.request_json!==request) throw new EntitlementError('idempotency_key_conflict',409);
  return JSON.parse(row.after_json) as BookingEntitlement;
}
function event(db: D1Database, id: string, account: string, action: string, reason: string, actorId: string, key: string, request: string, version: number, before: string|null) {
  return db.prepare(`INSERT INTO booking_entitlement_events(id,entitlement_id,line_account_id,action,reason,actor_type,actor_id,request_key,request_json,before_json,after_json,created_at)
    SELECT ?,id,line_account_id,?,?,'staff',?,?,?,?,json_object('id',id,'line_account_id',line_account_id,'friend_id',friend_id,'menu_id',menu_id,'kind',kind,'name',name,'remaining',remaining,'monthly_limit',monthly_limit,'valid_from',valid_from,'expires_at',expires_at,'status',status,'version',version,'created_at',created_at,'updated_at',updated_at),updated_at
    FROM booking_entitlements WHERE id=? AND line_account_id=? AND version=?`)
    .bind(crypto.randomUUID(),action,reason.trim(),actorId,key,request,before,id,account,version);
}
export async function grantEntitlement(db:D1Database, account:string, actor:string, key:string, value:unknown) {
  let b=value as BookingEntitlementGrant;
  const planRequest=b?.planId?JSON.stringify({action:'grant',planId:b.planId,friendId:b.friendId,reason:b.reason,validFrom:b.validFrom??null}):null;
  if(planRequest){const existing=await replay(db,account,key,planRequest);if(existing)return {data:existing,replayed:true};b=await expandPlanGrant(db,account,b as unknown as Record<string,unknown>) as unknown as BookingEntitlementGrant;}

  if(!b || !text(b.friendId,128)||!text(b.name,100)||!text(b.reason,1000)||!instant(b.validFrom)||!instant(b.expiresAt)||Date.parse(b.expiresAt)<=Date.parse(b.validFrom)
    ||!['ticket','monthly'].includes(b.kind)|| (b.kind==='ticket'? !integer(b.remaining,0)||b.monthlyLimit!==undefined : b.monthlyLimit!==null&&!integer(b.monthlyLimit,1)||b.remaining!==undefined)
    ||!(b.menuId==null||text(b.menuId,128))) invalid();
  const request=planRequest??JSON.stringify({action:'grant',friendId:b.friendId,menuId:b.menuId??null,kind:b.kind,name:b.name.trim(),remaining:b.remaining??null,monthlyLimit:b.monthlyLimit??null,validFrom:new Date(b.validFrom).toISOString(),expiresAt:new Date(b.expiresAt).toISOString(),reason:b.reason.trim()});
  const existing=await replay(db,account,key,request); if(existing) return {data:existing,replayed:true};
  if(!await db.prepare('SELECT id FROM friends WHERE id=? AND line_account_id=?').bind(b.friendId,account).first()) throw new EntitlementError('friend_not_found',404);
  if(b.menuId && !await db.prepare('SELECT id FROM menus WHERE id=? AND line_account_id=? AND deleted_at IS NULL').bind(b.menuId,account).first()) throw new EntitlementError('menu_not_found',404);
  const id=crypto.randomUUID(),now=new Date().toISOString();
  await db.batch([
    db.prepare(`INSERT INTO booking_entitlements(id,line_account_id,friend_id,menu_id,kind,name,remaining,monthly_limit,valid_from,expires_at,created_at,updated_at,plan_id)
      SELECT ?,?,?,?,?,?,?,?,?,?,?,?,? WHERE NOT EXISTS(SELECT 1 FROM booking_entitlement_events WHERE line_account_id=? AND request_key=?)`)
      .bind(id,account,b.friendId,b.menuId??null,b.kind,b.name.trim(),b.remaining??null,b.monthlyLimit??null,new Date(b.validFrom).toISOString(),new Date(b.expiresAt).toISOString(),now,now,b.planId??null,account,key),
    event(db,id,account,'grant',b.reason,actor,key,request,1,null),
  ]);
  return {data:(await replay(db,account,key,request))!,replayed:false};
}
export async function operateEntitlement(db:D1Database,account:string,id:string,actor:string,key:string,value:unknown) {
  const b=value as BookingEntitlementOperation;
  if(!b||!text(b.reason,1000)||!integer(b.expectedVersion,1)||!['adjust','extend','revoke'].includes(b.action)
    || b.action==='adjust'&&(!integer(b.remaining,0)||b.periodAt!==undefined&&!instant(b.periodAt)) || b.action==='extend'&&!instant(b.expiresAt)) invalid();
  const request=JSON.stringify({id,action:b.action,expectedVersion:b.expectedVersion,reason:b.reason.trim(),...(b.action==='adjust'?{remaining:b.remaining,periodAt:b.periodAt??null}:b.action==='extend'?{expiresAt:new Date(b.expiresAt).toISOString()}:{})});
  const existing=await replay(db,account,key,request);if(existing)return {data:existing,replayed:true};
  const row=await db.prepare('SELECT * FROM booking_entitlements WHERE id=? AND line_account_id=?').bind(id,account).first<BookingEntitlement>();
  if(!row)throw new EntitlementError('entitlement_not_found',404);
  if(row.status!=='active'||row.version!==b.expectedVersion)throw new EntitlementError('version_conflict',409);
  if(b.action==='extend'&&Date.parse(b.expiresAt)<=Date.parse(row.expires_at))invalid();
  const monthly=b.action==='adjust'&&row.kind==='monthly' ? (await entitlementViews(db,account,row.friend_id!,b.periodAt??new Date().toISOString())).find(e=>e.id===id)! : null;
  const field=b.action==='adjust'?(monthly?'monthly_limit':'remaining'):b.action==='extend'?'expires_at':'status';
  const valueToSave=b.action==='adjust'?(monthly?row.monthly_limit:b.remaining):b.action==='extend'?new Date(b.expiresAt).toISOString():'revoked';
  await db.batch([
    db.prepare(`UPDATE booking_entitlements SET ${field}=?,version=version+1,updated_at=? WHERE id=? AND line_account_id=? AND status='active' AND version=? AND NOT EXISTS(SELECT 1 FROM booking_entitlement_events WHERE line_account_id=? AND request_key=?)`)
      .bind(valueToSave,new Date().toISOString(),id,account,b.expectedVersion,account,key),
    ...(monthly && b.action==='adjust' ? [db.prepare(`INSERT INTO booking_entitlement_month_limits(entitlement_id,period_start,period_end,allowance)
      SELECT ?,?,?,? WHERE changes()=1 ON CONFLICT(entitlement_id,period_start) DO UPDATE SET allowance=excluded.allowance`)
      .bind(id,monthly.periodStart,monthly.periodEnd,b.remaining+monthly.monthUsed)] : []),
    // changes prevents a losing version update from writing an audit event.
    db.prepare(`INSERT INTO booking_entitlement_events SELECT ?,?,? ,?,?,'staff',?,?,?,?,json_object('id',id,'line_account_id',line_account_id,'friend_id',friend_id,'menu_id',menu_id,'kind',kind,'name',name,'remaining',remaining,'monthly_limit',monthly_limit,'valid_from',valid_from,'expires_at',expires_at,'status',status,'version',version,'created_at',created_at,'updated_at',updated_at),updated_at FROM booking_entitlements WHERE id=? AND line_account_id=? AND changes()=1`)
      .bind(crypto.randomUUID(),id,account,b.action,b.reason.trim(),actor,key,request,JSON.stringify(row),id,account),
  ]);
  const saved=await replay(db,account,key,request);
  if(!saved)throw new EntitlementError('version_conflict',409);
  return {data:saved,replayed:false};
}
export function entitlementUseStatement(db:D1Database,bookingId:string,entitlementId:string,at:string,timezone:string) {
  const p=entitlementMonth(at,timezone);
  return db.prepare(`INSERT INTO booking_entitlement_uses(booking_id,booking_id_history,entitlement_id,period_start,period_end)
    SELECT ?,?,?,?,? WHERE EXISTS(SELECT 1 FROM bookings WHERE id=?)`).bind(bookingId,bookingId,entitlementId,p.periodStart,p.periodEnd,bookingId);
}
export async function validateEntitlementSelection(db:D1Database,accountId:string,friendId:string,menuId:string,id:string,at:string) {
  const rows=await entitlementViews(db,accountId,friendId,at);
  const e=rows.find(r=>r.id===id);
  if(!e||e.status!=='active'||e.menu_id&&e.menu_id!==menuId||Date.parse(at)<Date.parse(e.valid_from)||Date.parse(at)>=Date.parse(e.expires_at)
    ||(e.kind==='ticket'?e.remaining!<=0:e.monthRemaining!==null&&e.monthRemaining<=0))throw new EntitlementError('entitlement_unavailable',409);
  if(await passUnusable(db,e,accountId,menuId,at))throw new EntitlementError('entitlement_unavailable',409);
  return e;
}
