import { ensureWorkflowStep, getWorkflowStep, type WorkflowStepRef } from '@line-crm/db';
import { bindingScope } from './bindings.js';
import { stripeReceiptDigest } from './normalize.js';
import { BINDING_PROCESS, BookingStripeError, RECEIPT_PROCESS, STRIPE_BOOKING_API_VERSION, type BookingStripeEvent, type StripeReceiptInput } from './types.js';
export function receiptRef(account: string, eventId: string): WorkflowStepRef {
  return {scopeId: bindingScope(account), processKind: RECEIPT_PROCESS, subjectId: eventId, stepKey: 'apply'};
}
export async function bookingStripeReceiptId(account: string, eventId: string): Promise<string> {
  return `stripe_${await stripeReceiptDigest(JSON.stringify([account,eventId]))}`;
}
export async function storeBookingStripeReceipt(db: D1Database, event: BookingStripeEvent, digest: string) {
  const owners = (await db.prepare(`SELECT a.id,a.tenant_id FROM booking_payment_connections c JOIN line_accounts a ON a.id=c.line_account_id
    WHERE c.provider_account_id=? AND c.test_mode=1 LIMIT 2`).bind(event.account).all<{id: string; tenant_id: string | null}>()).results;
  const bound = await getWorkflowStep(db,{scopeId:bindingScope(event.account),processKind:BINDING_PROCESS,subjectId:event.object.id,stepKey:'binding'});
  const saved = bound ? JSON.parse(bound.input_json!) as {accountId:string;tenantId:string} : null;
  const owner = saved ? {id:saved.accountId,tenant_id:saved.tenantId} : owners.length === 1 ? owners[0] : null;
  const ref = receiptRef(event.account,event.id);
  const row = await ensureWorkflowStep(db,ref,{input: {digest,event,retentionAccountId: owner?.id ?? null,retentionTenantId: owner?.tenant_id ?? null} satisfies StripeReceiptInput});
  const input = JSON.parse(row.input_json!) as StripeReceiptInput;
  if (input.digest !== digest) throw new BookingStripeError('stripe_event_conflict');
  if (event.apiVersion !== STRIPE_BOOKING_API_VERSION) {
    await db.prepare(`UPDATE workflow_steps SET error_code='stripe_api_version_unsupported' WHERE scope_id=? AND process_kind=? AND subject_id=? AND step_key='apply' AND status='pending'`)
      .bind(ref.scopeId,ref.processKind,ref.subjectId).run();
  }
  return {receiptId: await bookingStripeReceiptId(event.account,event.id),status: row.status === 'succeeded' ? 'applied' : event.apiVersion !== STRIPE_BOOKING_API_VERSION || row.error_code ? 'review_required' : 'pending'};
}
/** 外部IDの保存後に呼ぶ。対応先未確定ではclaimしないので、再送で回数を使い切らない。 */
export async function listPendingBookingStripeReceipts(db: D1Database, account: string, objectId: string, limit = 50): Promise<string[]> {
  const rows = await db.prepare(`SELECT subject_id FROM workflow_steps WHERE scope_id=? AND process_kind=? AND step_key='apply'
    AND status IN ('pending','running') AND (error_code IS NULL OR error_code='stripe_binding_overdue') AND json_extract(input_json,'$.event.object.id')=? ORDER BY created_at,subject_id LIMIT ?`)
    .bind(bindingScope(account),RECEIPT_PROCESS,objectId,Math.min(50,Math.max(1,limit))).all<{subject_id: string}>();
  return rows.results.map(row => row.subject_id);
}
export async function getBookingStripeReceipt(db: D1Database, account: string, eventId: string) {
  const row = await getWorkflowStep(db,receiptRef(account,eventId));
  return row ? {row, input: JSON.parse(row.input_json!) as StripeReceiptInput} : null;
}
