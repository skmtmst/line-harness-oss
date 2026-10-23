import { buildOffsetListResponse, listQueryNumber } from '../../lib/list-paging.js';
import type { Env } from '../../worker-env.js';
import type { Hono } from 'hono';
import { peopleBoardEntry } from '@line-crm/shared';
import { inputError, inputJsonBoundary } from '../../lib/input-errors.js';
import { requireRole } from '../../middleware/role-guard.js';
import { resolveAccountIdAdmin } from './identity.js';
import { updateAdminBooking } from './update.js';

export function registerBoard(booking: Hono<Env>): void {
booking.get('/api/booking/admin/board',async c=>{
 const accountId=await resolveAccountIdAdmin(c);if(!accountId)return inputError(c,{error:'missing_account_id'},400,['account_id']);
 const from=c.req.query('from'),to=c.req.query('to'),offset=listQueryNumber(c.req.query('offset'), 0),limit=listQueryNumber(c.req.query('limit'), 100);
 if(!from||!to||!Number.isFinite(Date.parse(from))||!Number.isFinite(Date.parse(to))||Date.parse(to)<=Date.parse(from)||!Number.isInteger(offset)||offset<0||!Number.isInteger(limit)||limit<1||limit>500)return inputError(c,{error:'invalid_range'},400,['from','to','limit','offset']);
 const rows=await c.env.DB.prepare(`SELECT b.*,COALESCE(f.real_name,f.display_name,bc.display_name,'—') customer_name,s.display_name staff_name,m.name menu_name
 FROM bookings b LEFT JOIN friends f ON f.id=b.friend_id LEFT JOIN booking_customers bc ON bc.id=b.booking_customer_id LEFT JOIN staff s ON s.id=b.staff_id LEFT JOIN menus m ON m.id=b.menu_id
 WHERE b.line_account_id=? AND julianday(b.starts_at)<julianday(?) AND julianday(b.ends_at)>julianday(?) ORDER BY b.starts_at,b.id LIMIT ? OFFSET ?`).bind(accountId,to,from,limit,offset).all<Record<string,unknown>>();
 const total=await c.env.DB.prepare('SELECT COUNT(*) total FROM bookings WHERE line_account_id=? AND julianday(starts_at)<julianday(?) AND julianday(ends_at)>julianday(?)').bind(accountId,to,from).first<{total:number}>();
 const responseItems = rows.results.map(peopleBoardEntry);
 return c.json({success:true,data:buildOffsetListResponse({ entries:responseItems,total:total!.total,limit,offset, items: responseItems, paging: { limit }, sort: [{ field: 'starts_at', direction: 'asc' }, { field: 'id', direction: 'asc' }] })});
});

booking.patch('/api/booking/admin/board/:id',requireRole('owner','admin','staff'),inputJsonBoundary(),async c=>{
 const b=await c.req.json();
 if(b.kind!=='people'||!Number.isInteger(b.expectedVersion)||b.expectedVersion<0||typeof b.startsAt!=='string')return inputError(c,{error:'invalid_move'},400,['expectedVersion','startsAt']);
 return updateAdminBooking(c,{lock_version:b.expectedVersion,starts_at:b.startsAt,staff_id:b.staffId});
});
}
