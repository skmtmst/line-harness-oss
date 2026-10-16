import {passUnusable} from '../services/booking-pass-plans.js';
import { Hono } from 'hono';
import type { Env } from '../index.js';
import { inputError, inputJsonBoundary } from '../lib/input-errors.js';
import { requirePermission, requireRole } from '../middleware/role-guard.js';
import { canAccessAllLineAccounts } from '../services/account-access.js';
import { EntitlementError, entitlementViews, grantEntitlement, operateEntitlement } from '../services/booking-entitlements.js';
import { resolveAccountIdFromLiff, resolveFriendId, verifyCallerLineUserId } from './booking.js';

export const bookingEntitlements=new Hono<Env>();
bookingEntitlements.onError((error,c)=>{
  if(error instanceof EntitlementError)return c.json({success:false,error:error.code},error.status);
  console.error(JSON.stringify({code:'booking_entitlements_unavailable'}));
  return c.json({success:false,error:'booking_entitlements_unavailable'},503);
});
bookingEntitlements.use('/api/booking/admin/entitlements/*', requireRole('owner','admin','staff'),requirePermission('/booking/bookings'),async(c,next)=>{
  c.header('Cache-Control','no-store');
  if(c.req.method!=='GET'&&(c.get('staff')?.readOnly||c.get('impersonation')))return c.json({error:'forbidden'},403);
  const account=c.req.query('account_id');
  if(!account)return inputError(c,{error:'missing_account_id'},400,['account_id']);
  if(!await canAccessAllLineAccounts(c.env.DB,c.get('staff'),[account]))return c.json({error:'not_found'},404);
  await next();
});
bookingEntitlements.get('/api/booking/admin/entitlements',requireRole('owner','admin','staff'),async c=>{
  const account=c.req.query('account_id')!,friend=c.req.query('friend_id');
  if(!friend)return inputError(c,{error:'missing_friend_id'},400,['friend_id']);
  if(!await c.env.DB.prepare('SELECT id FROM friends WHERE id=? AND line_account_id=?').bind(friend,account).first())return c.json({error:'not_found'},404);
  return c.json({success:true,data:await entitlementViews(c.env.DB,account,friend,new Date().toISOString())});
});
bookingEntitlements.post('/api/booking/admin/entitlements',requireRole('owner','admin','staff'),inputJsonBoundary(),async c=>{
  const key=c.req.header('Idempotency-Key');
  if(!key||key.length>128)return inputError(c,{error:'invalid_idempotency_key'},400,[]);
  const saved=await grantEntitlement(c.env.DB,c.req.query('account_id')!,c.get('staff')!.id,`manual:${key}`,await c.req.json());
  return c.json({success:true,...saved},saved.replayed?200:201);
});
bookingEntitlements.post('/api/booking/admin/entitlements/:id/operations',inputJsonBoundary(),async c=>{
  const key=c.req.header('Idempotency-Key');
  if(!key||key.length>128)return inputError(c,{error:'invalid_idempotency_key'},400,[]);
  return c.json({success:true,...await operateEntitlement(c.env.DB,c.req.query('account_id')!,c.req.param('id'),c.get('staff')!.id,`manual:${key}`,await c.req.json())});
});
bookingEntitlements.get('/api/booking/admin/entitlements/:id/history',async c=>{
  const account=c.req.query('account_id')!,id=c.req.param('id');
  if(!await c.env.DB.prepare('SELECT id FROM booking_entitlements WHERE id=? AND line_account_id=?').bind(id,account).first())return c.json({error:'not_found'},404);
  const limit=Math.min(100,Math.max(1,Number(c.req.query('limit'))||50));
  const offset=Math.max(0,Number(c.req.query('offset'))||0);
  if(!Number.isInteger(limit)||!Number.isInteger(offset))return inputError(c,{error:'invalid_pagination'},400,['limit','offset']);
  const result=await c.env.DB.prepare(`SELECT id,entitlement_id,action,reason,actor_type,actor_id,before_json,after_json,request_json,created_at FROM booking_entitlement_events WHERE line_account_id=? AND entitlement_id=? ORDER BY created_at DESC,id DESC LIMIT ? OFFSET ?`)
    .bind(account,id,limit,offset).all();
  return c.json({success:true,data:result.results,limit,offset});
});
bookingEntitlements.get('/api/liff/booking/entitlements',async c=>{
  c.header('Cache-Control','private, no-store');
  const account=await resolveAccountIdFromLiff(c);if(!account)return c.json({error:'unknown_liff'},404);
  const caller=await verifyCallerLineUserId(c);if(!caller)return c.json({error:'unauthorized'},401);
  const friend=await resolveFriendId(c,caller,account);if(!friend)return c.json({error:'friend_not_found'},404);
  const at=c.req.query('starts_at')??new Date().toISOString();
  if(!Number.isFinite(Date.parse(at)))return inputError(c,{error:'invalid_starts_at'},400,['starts_at']);
  const menu=c.req.query('menu_id');
  const rows=await entitlementViews(c.env.DB,account,friend,at);
  // 管理側の理由や操作担当者はお客さまへ出さない。
  const data=await Promise.all(rows.filter(e=>e.status==='active').map(async e=>{const unusableReason=await passUnusable(c.env.DB,e,account,menu,at);return ({
    id:e.id,name:e.name,kind:e.kind,menuId:e.menu_id,remaining:e.remaining,monthlyLimit:e.monthly_limit,
    monthAllowance:e.monthAllowance,monthUsed:e.monthUsed,monthRemaining:e.monthRemaining,validFrom:e.valid_from,expiresAt:e.expires_at,
    periodStart:e.periodStart,periodEnd:e.periodEnd,
    usable:!unusableReason,unusableReason,
  });}));return c.json({success:true,data});
});
