import { DEFAULT_TENANT_ID } from '@line-crm/shared';
import { GapError } from './gap-common.js';

/** Reuse the existing durable bulk-run ledger without changing its public operation API. */
export async function createInboxAssignmentRun(db:D1Database, account:string, actor:string, tenant:string|null|undefined, key:string) {
 const tenantId=tenant??DEFAULT_TENANT_ID, id=crypto.randomUUID(), now=new Date().toISOString();
 const selection=JSON.stringify({kind:'inbox_unassigned',accountId:account});
 const operation=JSON.stringify({kind:'inbox_auto_assign',accountId:account});
 await db.batch([
  db.prepare(`INSERT OR IGNORE INTO friend_bulk_runs(id,tenant_id,created_by,selection_json,operation_json,status,idempotency_key,created_at,updated_at)
    VALUES(?,?,?,?,?,'preparing',?,?,?)`).bind(id,tenantId,actor,selection,operation,key,now,now),
  db.prepare(`INSERT INTO friend_bulk_run_items(id,run_id,friend_id,line_account_id,ordinal,status,idempotency_key,updated_at)
    SELECT lower(hex(randomblob(16))),?,f.id,?,ROW_NUMBER() OVER (ORDER BY c.last_customer_message_at,c.id),'queued',? || ':' || f.id,?
    FROM chats c JOIN friends f ON f.id=c.friend_id
    WHERE f.line_account_id=? AND c.operator_id IS NULL AND c.assignee_staff_id IS NULL AND c.status!='resolved'
      AND EXISTS(SELECT 1 FROM friend_bulk_runs WHERE id=? AND status='preparing')`).bind(id,account,id,now,account,id),
  db.prepare(`UPDATE friend_bulk_runs SET target_count=(SELECT count(*) FROM friend_bulk_run_items WHERE run_id=?),
    status=CASE WHEN EXISTS(SELECT 1 FROM friend_bulk_run_items WHERE run_id=?) THEN 'queued' ELSE 'success' END,
    completed_at=CASE WHEN EXISTS(SELECT 1 FROM friend_bulk_run_items WHERE run_id=?) THEN NULL ELSE ? END,updated_at=?
    WHERE id=? AND status='preparing'`).bind(id,id,id,now,now,id),
 ]);
 const run=await db.prepare(`SELECT id,selection_json,operation_json,status,target_count,success_count,skipped_count,temporary_failure_count,permanent_failure_count
   FROM friend_bulk_runs WHERE tenant_id=? AND created_by=? AND idempotency_key=?`).bind(tenantId,actor,key).first<Run>();
 if(!run || run.operation_json!==operation || run.selection_json!==selection) throw new GapError('idempotency_conflict',409);
 return result(run);
}
type Run={id:string;selection_json:string;operation_json:string;status:string;target_count:number;success_count:number;skipped_count:number;temporary_failure_count:number;permanent_failure_count:number};
function result(run:Run){return {id:run.id,status:run.status,total:run.target_count,assigned:run.success_count,skipped:run.skipped_count,failed:run.temporary_failure_count+run.permanent_failure_count};}
export async function getInboxAssignmentRun(db:D1Database,account:string,tenant:string|null|undefined,id:string){
 const row=await db.prepare(`SELECT id,selection_json,operation_json,status,target_count,success_count,skipped_count,temporary_failure_count,permanent_failure_count
 FROM friend_bulk_runs WHERE id=? AND tenant_id=? AND operation_json=?`).bind(id,tenant??DEFAULT_TENANT_ID,JSON.stringify({kind:'inbox_auto_assign',accountId:account})).first<Run>();
 if(!row)throw new GapError('not_found',404);
 return result(row);
}
