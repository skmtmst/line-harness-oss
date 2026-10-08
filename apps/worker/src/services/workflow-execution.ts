import {
  claimWorkflowStep, ensureWorkflowStep, failWorkflowStep, finishWorkflowStep,
  getWorkflowStep, releaseWorkflowStep, renewWorkflowStep, workflowJson,
  type WorkflowStepRef, type WorkflowStepRow,
} from '@line-crm/db';
import { workflowFencedDb } from './workflow-fenced-db.js';
import { workflowMutationDb, normalizeWorkflowResult } from './workflow-db.js';
import type { IncomingWebhookExecution } from './incoming-webhook-receipts.js';

export class WorkflowDeferred extends Error {
  constructor(public readonly state: string) { super(`workflow_${state}`); }
}
export interface WorkflowExecution extends IncomingWebhookExecution {
  ref: WorkflowStepRef;
  owner: string;
  activeStep?:string;
  step<T>(key: string, work: () => Promise<T>, options?: { input?: unknown; maxAttempts?: number; leaseMs?: number }): Promise<T>;
  mutationDb(key: string): D1Database;
  release(): Promise<void>;
  complete(result?:unknown):Promise<void>;
}
export async function runWorkflowStep<T>(db: D1Database,ref: WorkflowStepRef,
  work: (row: WorkflowStepRow) => Promise<T>,
  options: { input?: unknown; maxAttempts?: number; leaseMs?: number; retryKey?: string; now?: number; delayMs?: number } = {},
): Promise<T> {
  const previous=await ensureWorkflowStep(db,ref,options);
  if(previous.status==='succeeded') return JSON.parse(previous.result_json ?? 'null') as T;
  const row=await claimWorkflowStep(db,ref,options);
  if(!row) throw new WorkflowDeferred((await getWorkflowStep(db,ref))?.status ?? 'busy');
  try {
    const result=await work(row);
    await finishWorkflowStep(db,ref,row.lease_owner!,{result,now: options.now});
    return result;
  } catch(error) {
    await failWorkflowStep(db,ref,row.lease_owner!,{now: options.now,delayMs: options.delayMs ?? 0});
    throw error;
  }
}
export async function acquireWorkflow(db: D1Database,
  ref: Omit<WorkflowStepRef,'stepKey'>,
  options: { input?: unknown; maxAttempts?: number; leaseMs?: number; now?: number; resume?: { expectedUpdatedAt:number } } = {},
): Promise<WorkflowExecution | null> {
  const root={...ref,stepKey:'__run'};
  await ensureWorkflowStep(db,root,options);
  let row:WorkflowStepRow|null;
  if(options.resume){
    const now=options.now ?? Date.now(),owner=crypto.randomUUID();
    const changed=await db.prepare(`UPDATE workflow_steps SET status='running',lease_owner=?,lease_expires_at=?,
      attempt_count=1,next_attempt_at=NULL,error_code=NULL,input_json=?,updated_at=?
      WHERE scope_id=? AND process_kind=? AND subject_id=? AND step_key='__run' AND updated_at=?
        AND (status IN ('failed','exhausted','unknown') OR (status='running' AND lease_expires_at<=?))`)
      .bind(owner,now+(options.leaseMs ?? 300_000),workflowJson(options.input),now,root.scopeId,root.processKind,root.subjectId,
        options.resume.expectedUpdatedAt,now).run();
    row=changed.meta.changes===1?await getWorkflowStep(db,root):null;
  }else row=await claimWorkflowStep(db,root,options);
  if(!row) return null;
  const owner=row.lease_owner!;
  const domainDbs=new Map<string,D1Database>();
  const execution: WorkflowExecution={
    db:workflowFencedDb(db,{...root,owner}),ref: root,owner,sourceEventId:ref.subjectId,occurredAt:new Date(row.created_at).toISOString(),
    async step<T>(key: string,work:()=>Promise<T>,stepOptions={}) {
      await renewWorkflowStep(db,root,owner,options.leaseMs);
      return runWorkflowStep(db,{...root,stepKey:key},async()=>{
        const outer=execution.activeStep;execution.activeStep=key;
        let result:T;
        try{result=await work()}finally{execution.activeStep=outer}
        const domain=domainDbs.get(key);
        if(domain)result=normalizeWorkflowResult(domain,result);
        await renewWorkflowStep(db,root,owner,options.leaseMs);
        return result;
      },stepOptions);
    },
    mutationDb:(key)=>{const owned=workflowMutationDb(db,root,owner,key);domainDbs.set(key,owned);return owned;},
    async complete(result?:unknown){
      const unfinished=await db.prepare(`SELECT 1 FROM workflow_steps WHERE scope_id=? AND process_kind=? AND subject_id=?
        AND step_key!='__run' AND status NOT IN ('succeeded','canceled') LIMIT 1`)
        .bind(root.scopeId,root.processKind,root.subjectId).first();
      if(unfinished) throw new WorkflowDeferred('unfinished');
      await finishWorkflowStep(db,root,owner,{result});
    },
    fail:()=>failWorkflowStep(db,root,owner,{delayMs:0}),
    release:()=>releaseWorkflowStep(db,root,owner),
  };
  return execution;
}
