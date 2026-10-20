import type { Env } from '../../worker-env.js';
import type { Hono } from 'hono';
import { inputError } from '../../lib/input-errors.js';
import { openSeatTables } from '../../services/restaurant-closures.js';
import { restaurantTestEnabled } from '../../lib/environment-features.js';
import { resolveSelfBookingCaller } from './identity.js';

export function registerSeatAvailability(booking: Hono<Env>): void {
/** 本人確認済みのLINE/LIFFで使う席の空き。休業・貸切のメモは公開しない。 */
booking.get('/api/liff/booking/seat-availability',async c=>{
 const caller=await resolveSelfBookingCaller(c);if(!caller.ok)return inputError(c, {error:caller.error}, caller.status, []);
 if(!restaurantTestEnabled(c.env))return c.json({error:'not_found'},404);
 const storeId=c.req.query('store_id')||'',startsAt=c.req.query('starts_at')||'',endsAt=c.req.query('ends_at')||'',guestCount=Number(c.req.query('guest_count'));
 const store=await c.env.DB.prepare("SELECT id FROM rt_stores WHERE id=? AND line_account_id=? AND status='active'").bind(storeId,caller.accountId).first();
 if(!store)return c.json({error:'not_found'},404);
 if(!Number.isFinite(Date.parse(startsAt))||!Number.isFinite(Date.parse(endsAt))||Date.parse(endsAt)<=Date.parse(startsAt)||!Number.isSafeInteger(guestCount)||guestCount<1||guestCount>100)return c.json({error:'invalid_slot'},400);
 return c.json({success:true,data:{storeId,startsAt,endsAt,guestCount,tables:await openSeatTables(c.env.DB,storeId,startsAt,endsAt,guestCount)}});
});
}
