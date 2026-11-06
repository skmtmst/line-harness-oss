import { createBroadcastRetryKey } from '../broadcasts/broadcast-retry-key/index.js';
import { markAutoReplyEvaluationFinished } from '@line-crm/db';

const NOT_DISPATCHED = 'DELAYED_REPLY_NOT_DISPATCHED';
const resource = (id: string) => `auto-reply-delivery:${id}`;

/** 既存の共通送信台帳のleaseを使う。返信本文はdelivered行の固定した写し。 */
export async function claimDelayedReply(db: D1Database, id: string, now: Date): Promise<string | null> {
  const key = await createBroadcastRetryKey('auto-reply-delivery-lease',id);
  const token = crypto.randomUUID(), at = now.toISOString();
  const expires = new Date(now.getTime()+60_000).toISOString();
  const claimed = await db.batch([
    db.prepare(`INSERT OR IGNORE INTO outbound_send_requests
      (idempotency_key,channel,resource_id,payload_hash,status,failure_code,lease_token,lease_expires_at,created_at,updated_at)
      VALUES (?,'line',?,?,'in_progress',?,?,?,?,?)`)
      .bind(key,resource(id),id,NOT_DISPATCHED,token,expires,at,at),
    db.prepare(`UPDATE outbound_send_requests SET status='in_progress',lease_token=?,lease_expires_at=?,updated_at=?
      WHERE resource_id=? AND status='failed' AND failure_code=?`)
      .bind(token,expires,at,resource(id),NOT_DISPATCHED),
    db.prepare(`UPDATE auto_reply_deliveries SET status='claimed'
      WHERE id=? AND status='pending' AND EXISTS(SELECT 1 FROM outbound_send_requests
        WHERE resource_id=? AND status='in_progress' AND lease_token=?)`)
      .bind(id,resource(id),token),
  ]);
  return claimed[2].meta.changes === 1 ? token : null;
}

export async function beginDelayedReplyDispatch(db: D1Database,id: string,token:string,now:Date):Promise<boolean> {
  const result = await db.prepare(`UPDATE outbound_send_requests SET failure_code=NULL,updated_at=?
    WHERE resource_id=? AND status='in_progress' AND lease_token=? AND failure_code=? AND lease_expires_at>?`)
    .bind(now.toISOString(),resource(id),token,NOT_DISPATCHED,now.toISOString()).run();
  return result.meta.changes === 1;
}

/** lease保持者だけが決着を書ける。期限切れ回収と古い実行が競合しても戻さない。 */
export async function finishDelayedReply(db:D1Database,id:string,token:string,status:string,error:string|null,now:Date) {
  const at=now.toISOString();
  const result=await db.batch([
    db.prepare(`UPDATE auto_reply_deliveries SET status=?,error_code=?,completed_at=? WHERE id=? AND status='claimed'
      AND EXISTS(SELECT 1 FROM outbound_send_requests WHERE resource_id=? AND status='in_progress' AND lease_token=?)`)
      .bind(status,error,at,id,resource(id),token),
    db.prepare(`UPDATE outbound_send_requests SET status=?,response_id=?,completed_at=?,failure_code=?,
      last_failed_at=?,retryable=0,lease_token=NULL,lease_expires_at=NULL,updated_at=?
      WHERE resource_id=? AND status='in_progress' AND lease_token=?`)
      .bind(status==='accepted'?'succeeded':error==='delayed_delivery_unknown'?'unknown':'failed',
        status==='accepted'?`auto-reply:${id}`:null,at,error??'delivery_not_allowed',at,at,resource(id),token),
  ]);
  return result[0].meta.changes===1;
}

export async function recoverDelayedReplies(db:D1Database,now:Date):Promise<void> {
  const stale=await db.prepare(`SELECT d.id,d.evaluation_id,d.action_summary,o.failure_code,o.lease_expires_at
    FROM auto_reply_deliveries d LEFT JOIN outbound_send_requests o ON o.resource_id='auto-reply-delivery:'||d.id
    WHERE d.status='claimed' AND (o.lease_expires_at<=? OR (o.idempotency_key IS NULL AND d.due_at<=?))
    ORDER BY d.due_at,d.id LIMIT 50`).bind(now.toISOString(),new Date(now.getTime()-5*60_000).toISOString())
    .all<{id:string;evaluation_id:string;action_summary:string;failure_code:string|null;lease_expires_at:string|null}>();
  for(const row of stale.results){
    const unsent=row.failure_code===NOT_DISPATCHED;
    const at=now.toISOString();
    const results=await db.batch([
      db.prepare(`UPDATE auto_reply_deliveries SET status=?,error_code=?,completed_at=? WHERE id=? AND status='claimed'
        AND (NOT EXISTS(SELECT 1 FROM outbound_send_requests WHERE resource_id=?) OR EXISTS(
          SELECT 1 FROM outbound_send_requests WHERE resource_id=? AND status='in_progress' AND lease_expires_at<=?))`)
        .bind(unsent?'pending':'failed',unsent?null:'delayed_delivery_unknown',unsent?null:at,row.id,resource(row.id),resource(row.id),at),
      db.prepare(`UPDATE outbound_send_requests SET status=?,failure_code=?,last_failed_at=?,updated_at=?,
        retryable=0,lease_token=NULL,lease_expires_at=NULL
        WHERE resource_id=? AND status='in_progress' AND lease_expires_at<=?`)
        .bind(unsent?'failed':'unknown',unsent?NOT_DISPATCHED:'delayed_delivery_unknown',at,at,resource(row.id),at),
    ]);
    if(results[0].meta.changes===1&&!unsent){
      await markAutoReplyEvaluationFinished(db,{evaluationId:row.evaluation_id,actionSummary:JSON.parse(row.action_summary),
        status:'failed',replyStatus:'failed',errorCode:'delayed_delivery_unknown'});
    }
  }
}
