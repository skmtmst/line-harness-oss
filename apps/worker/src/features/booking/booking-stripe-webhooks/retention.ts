import { BINDING_PROCESS, RECEIPT_PROCESS } from './types.js';
/** 店が一度も分からなかった隔離受信だけを30日で捨てる。支払いや対応済みの記録を消さない。 */
export async function purgeUnboundBookingStripeReceipts(db: D1Database, now = Date.now()): Promise<number> {
  const result = await db.prepare(`DELETE FROM workflow_steps WHERE (scope_id,process_kind,subject_id,step_key) IN (
    SELECT w.scope_id,w.process_kind,w.subject_id,w.step_key FROM workflow_steps w
    WHERE w.scope_id>='stripe-test:' AND w.scope_id<'stripe-test;' AND w.process_kind=? AND w.step_key='apply' AND w.status='pending' AND w.created_at<?
    AND json_extract(w.input_json,'$.retentionAccountId') IS NULL
    AND NOT EXISTS(SELECT 1 FROM workflow_steps b WHERE b.scope_id=w.scope_id AND b.process_kind=? AND b.step_key='binding'
      AND b.subject_id=json_extract(w.input_json,'$.event.object.id')) LIMIT 100)`)
    .bind(RECEIPT_PROCESS,now-30*24*60*60*1000,BINDING_PROCESS).run();
  return result.meta.changes;
}

/** 店が分かる未対応受信は消さず、30日後に一度だけ要確認へ数える。 */
export async function markOverdueBookingStripeReceipts(db:D1Database,now=Date.now()):Promise<number> {
  const result=await db.prepare(`UPDATE workflow_steps SET error_code='stripe_binding_overdue',updated_at=?
    WHERE (scope_id,process_kind,subject_id,step_key) IN (SELECT w.scope_id,w.process_kind,w.subject_id,w.step_key FROM workflow_steps w
      WHERE w.scope_id>='stripe-test:' AND w.scope_id<'stripe-test;' AND w.process_kind=? AND w.step_key='apply'
      AND w.status='pending' AND w.created_at<? AND w.error_code IS NULL
      AND json_extract(w.input_json,'$.retentionAccountId') IS NOT NULL
      AND NOT EXISTS(SELECT 1 FROM workflow_steps b WHERE b.scope_id=w.scope_id AND b.process_kind=? AND b.step_key='binding'
        AND b.subject_id=json_extract(w.input_json,'$.event.object.id')) LIMIT 100)`)
    .bind(now,RECEIPT_PROCESS,now-30*24*60*60*1000,BINDING_PROCESS).run();
  return result.meta.changes;
}
