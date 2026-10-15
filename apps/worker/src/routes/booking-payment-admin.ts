import { Hono, type MiddlewareHandler } from 'hono';
import type { Env } from '../index.js';
import { canAccessAllLineAccounts } from '../services/account-access.js';
import { inputError, inputJsonBoundary } from '../lib/input-errors.js';
import { paymentCsv, paymentRecordFilter, paymentRecords, paymentSummary, staffTodayCounts } from '../services/booking-payment-admin.js';
import { startBookingPayment } from './booking-payments.js';

export const bookingPaymentAdmin = new Hono<Env>();
bookingPaymentAdmin.onError((error,c)=>{
  const notReady=/no such table: (?:booking_payment_choices|booking_payments|booking_payment_configs|booking_payment_menu_settings)\b/.test(String(error));
  const code=notReady?'payment_storage_not_ready':'payment_admin_unavailable';
  console.error(JSON.stringify({code}));
  return c.json({success:false,error:code,code},503);
});

/** 既存の予約支払いと同じ所属・役割。直結した試験でも閲覧のみの変更を拒否する。 */
const guard = (write = false): MiddlewareHandler<Env> => async (c, next) => {
  c.header('Cache-Control','no-store');
  const staff=c.get('staff');
  if (!staff || !['owner','admin','staff'].includes(staff.role) || (write && (staff.readOnly || staff.role==='staff'))) {
    return c.json({success:false,error:'forbidden'},403);
  }
  const account=c.req.query('account_id')?.trim();
  if (!account) return inputError(c,{success:false,error:'missing_account_id'},400,['account_id']);
  if (!await canAccessAllLineAccounts(c.env.DB,staff,[account])) return c.json({success:false,error:'not_found'},404);
  // 所属判定に加え、未作成のアカウントも実在するものとして扱わない。
  if (!await c.env.DB.prepare('SELECT id FROM line_accounts WHERE id=?').bind(account).first()) return c.json({success:false,error:'not_found'},404);
  await next();
};

bookingPaymentAdmin.get('/api/booking/admin/payment-connection',guard(),async c => {
  // この予約決済は外へ通信しない模擬プロバイダ。Webhook鍵だけで「接続済み」と表示しない。
  return c.json({success:true,data:{connected:false,testMode:true,accountIdTail:null,connectedAt:null,dashboardUrl:null}});
});
bookingPaymentAdmin.get('/api/booking/admin/menu-payments',guard(),async c => {
  const rows=await c.env.DB.prepare(`SELECT s.menu_id AS menuId,s.mode FROM booking_payment_menu_settings s
    JOIN menus m ON m.id=s.menu_id AND m.line_account_id=s.line_account_id
    WHERE s.line_account_id=? AND m.deleted_at IS NULL ORDER BY m.sort_order,m.id`)
    .bind(c.req.query('account_id')!.trim()).all<{menuId:string;mode:string}>();
  return c.json({success:true,data:{menus:rows.results}});
});
bookingPaymentAdmin.get('/api/booking/admin/payments',guard(),async c => {
  const filter=paymentRecordFilter(c.req.query());
  if (!filter) return inputError(c,{success:false,error:'invalid_payment_filter'},400,['q','status','method','period','limit','offset']);
  const account=c.req.query('account_id')!.trim();
  const page=await paymentRecords(c.env.DB,account,filter);
  const summary=await paymentSummary(c.env.DB,account);
  return c.json({success:true,data:{...page,summary}});
});
bookingPaymentAdmin.get('/api/booking/admin/payments/export',guard(),async c => {
  const filter=paymentRecordFilter(c.req.query());
  if (!filter) return inputError(c,{success:false,error:'invalid_payment_filter'},400,['q','status','method','period','limit','offset']);
  const page=await paymentRecords(c.env.DB,c.req.query('account_id')!.trim(),{...filter,limit:10000,offset:0});
  // 黙って切り詰めたCSVを渡さない。大量書出しのジョブは別の保存先の承認後に追加する。
  if (page.total>10000) return c.json({success:false,error:'export_too_large',code:'export_too_large',maxRows:10000},413);
  c.header('Content-Type','text/csv; charset=utf-8');
  c.header('Content-Disposition','attachment; filename="booking-payments.csv"');
  return c.body(paymentCsv(page.items));
});
bookingPaymentAdmin.get('/api/booking/admin/staff/today-counts',guard(),async c =>
  c.json({success:true,data:await staffTodayCounts(c.env.DB,c.req.query('account_id')!.trim())}));

bookingPaymentAdmin.post('/api/booking/admin/payments/:id/send-link',guard(true),inputJsonBoundary(),async c => {
  const body=await c.req.json<{dryRun?:unknown}>().catch(()=>null);
  if (body?.dryRun!==true) return inputError(c,{success:false,error:'simulation_only',code:'simulation_only'},400,['dryRun']);
  const account=c.req.query('account_id')!.trim();
  const row=await c.env.DB.prepare(`SELECT b.id,b.line_account_id,b.price_at_booking,b.status,p.provider,p.idempotency_key
    FROM booking_payments p JOIN bookings b ON b.id=p.booking_id AND b.line_account_id=p.line_account_id
    WHERE p.id=? AND p.line_account_id=? AND p.status IN ('unpaid','pending')
      AND (p.hold_until IS NULL OR julianday(p.hold_until)>julianday('now'))`)
    .bind(c.req.param('id'),account).first<{id:string;line_account_id:string;price_at_booking:number;status:string;provider:string;idempotency_key:string}>();
  if (!row) return c.json({success:false,error:'payment_not_available'},404);
  if (row.provider!=='stripe') return c.json({success:false,error:'simulation_only',code:'simulation_only'},409);
  // 既存の開始処理を使い、リンクを重複作成しない。LINEや外部Stripeへ通信しない。
  const result=await startBookingPayment(c.env.DB,c.env,row,row.idempotency_key);
  if (!result.ok) return c.json({success:false,error:result.error},result.status);
  return c.json({success:true,data:{paymentId:result.paymentId,checkoutUrl:result.checkoutUrl,sent:false,simulation:true}});
});

// 通知原本・再試行の履歴を保存する表がまだない。空の一覧や架空の成功を返さない。
const eventsNotReady: MiddlewareHandler<Env> = async c => c.json({success:false,error:'payment_events_storage_not_ready',code:'payment_events_storage_not_ready'},503);
bookingPaymentAdmin.get('/api/booking/admin/payment-events',guard(),eventsNotReady);
bookingPaymentAdmin.post('/api/booking/admin/payment-events/:id/replay',guard(true),eventsNotReady);

for (const suffix of ['payment','price'] as const) {
  const path=`/api/events/admin/events/:id/${suffix}`;
  const eventGuard: MiddlewareHandler<Env> = async (c,next) => {
    const event=await c.env.DB.prepare('SELECT id FROM events WHERE id=? AND line_account_id=? AND deleted_at IS NULL')
      .bind(c.req.param('id'),c.req.query('account_id')!.trim()).first();
    if (!event) return c.json({success:false,error:'not_found'},404);
    return next();
  };
  const notReady: MiddlewareHandler<Env> = async c => c.json({success:false,error:'event_payment_storage_not_ready',code:'event_payment_storage_not_ready'},503);
  bookingPaymentAdmin.get(path,guard(),eventGuard,notReady);
  bookingPaymentAdmin.put(path,guard(true),eventGuard,notReady);
}
