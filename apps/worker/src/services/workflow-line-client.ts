import type { LineClient, Message } from '@line-crm/line-sdk';

import { claimWorkflowStep, ensureWorkflowStep, failWorkflowStep, finishWorkflowStep, getWorkflowStep, workflowBindings, WORKFLOW_WHERE, type WorkflowStepRef, type WorkflowStepRow } from '@line-crm/db';

import type { WorkflowExecution } from './workflow-execution.js';
import { WorkflowDeferred } from './workflow-execution.js';
import { EXTERNAL_DELIVERY_MAX_ATTEMPTS, externalDeliveryRetryAt, externalDeliveryNotBefore, EXTERNAL_DELIVERY_RETRY_AFTER_MAX_MINUTES } from './external-delivery-retry.js';

/** Older failures did not record whether the wire request had started. Never
 * reinterpret those rows as proof of rejection or allocate a fresh operation.
 */
export async function holdUncertainLineStep(db:D1Database,ref:WorkflowStepRef,previous:WorkflowStepRow,code:'delivery_unknown'|'reply_unknown'='delivery_unknown'):Promise<boolean>{
  if(previous.status==='unknown')return true;
  const now=Date.now();
  const legacy=previous.status==='failed'&&['delivery_failed','processing_failed'].includes(previous.error_code ?? '');
  const expired=previous.status==='running'&&(previous.lease_expires_at ?? 0)<=now;
  if(!legacy&&!expired)return false;
  await db.prepare(`UPDATE workflow_steps SET status='unknown',error_code=?,lease_owner=NULL,lease_expires_at=NULL,next_attempt_at=NULL,updated_at=?
    WHERE ${WORKFLOW_WHERE} AND ((status='failed' AND error_code IN ('delivery_failed','processing_failed')) OR (status='running' AND lease_expires_at<=?))`)
    .bind(code,now,...workflowBindings(ref),now).run();
  return true;
}

/** Automatic sends retain their original wire inputs; reply tokens never enter the ledger. */
export function workflowLineClient(client: LineClient, execution: WorkflowExecution, options: {
  stepKey?: string;
  onAttempt?: () => void;
  retryKeyValidityMs?: number;
} = {}): LineClient {
  const ordinals = new Map<string, number>();
  return new Proxy(client, { get(target, key) {
    if (!['pushMessage', 'pushMessageWithRequestId', 'replyMessage', 'replyMessageWithRequestId'].includes(String(key))) {
      const value = Reflect.get(target, key);
      return typeof value === 'function' ? value.bind(target) : value;
    }
    return async (toOrToken: string, messages: Message[], retryKey?: string) => {
      const method = String(key), namespace = `${execution.activeStep ?? 'direct'}:${method}`;
      const index = ordinals.get(namespace) ?? 0;
      ordinals.set(namespace, index + 1);
      const reply = method.startsWith('reply');
      const ref = { ...execution.ref, stepKey: options.stepKey ?? `line:${namespace}:${index}` };
      const previous = await ensureWorkflowStep(execution.db, ref, {
        input: reply ? { messages } : { to: toOrToken, messages },
        maxAttempts: EXTERNAL_DELIVERY_MAX_ATTEMPTS, retryKey: reply ? undefined : retryKey,
      });
      if (previous.status === 'succeeded') return JSON.parse(previous.result_json ?? 'null');
      // A lease expiration is not proof that a provider did not accept a send.
      // Include old running rows which predate the explicit started marker.
      if(await holdUncertainLineStep(execution.db,ref,previous,reply?'reply_unknown':'delivery_unknown')
        || reply && previous.first_attempt_at!==null)throw new WorkflowDeferred(reply?'reply_unknown':'delivery_unknown');
      if(previous.status==='running')throw new WorkflowDeferred('busy');
      // Existing rows may carry the former five-attempt budget. Never raise a stricter one.
      await execution.db.prepare(`UPDATE workflow_steps SET max_attempts=MIN(max_attempts,?) WHERE ${WORKFLOW_WHERE}`)
        .bind(EXTERNAL_DELIVERY_MAX_ATTEMPTS, ...workflowBindings(ref)).run();
      const row = await claimWorkflowStep(execution.db, ref);
      if (!row) throw new WorkflowDeferred((await getWorkflowStep(execution.db, ref))?.status ?? 'busy');
      const original = JSON.parse(row.input_json!);
      let started = false, accepted = false;
      let providerRequestId: string | null = null;
      try {
        if (!reply && options.retryKeyValidityMs !== undefined && row.attempt_count > 1
          && row.first_attempt_at !== null && Date.now() - row.first_attempt_at >= options.retryKeyValidityMs) {
          await failWorkflowStep(execution.db, ref, row.lease_owner!, { unknown: true, code: 'delivery_unknown' });
          throw new WorkflowDeferred('delivery_unknown');
        }
        const marked = await execution.db.prepare(`UPDATE workflow_steps SET error_code='delivery_started'
          WHERE ${WORKFLOW_WHERE} AND status='running' AND lease_owner=? AND lease_expires_at>?`)
          .bind(...workflowBindings(ref), row.lease_owner, Date.now()).run();
        if (marked.meta.changes !== 1) throw new WorkflowDeferred('busy');
        started = true;
        options.onAttempt?.();
        const result = reply
          ? await target[method as 'replyMessage'](toOrToken, original.messages)
          : await target[method as 'pushMessage'](original.to, original.messages, row.retry_key);
        accepted = true;
        const receipt = result as unknown as { requestId?: unknown } | null;
        if (typeof receipt?.requestId === 'string') providerRequestId = receipt.requestId;
        await finishWorkflowStep(execution.db, ref, row.lease_owner!, { result });
        return result;
      } catch (error) {
        const status = Number((error as { status?: unknown } | null)?.status ?? 0);
        const rejected = !accepted && status >= 400 && status < 500 && status !== 408;
        const unknown = started && !rejected;
        const now = new Date();
        const next = rejected && status === 429 ? externalDeliveryRetryAt(error, row.attempt_count, now, true) : null;
        const notBefore = rejected ? externalDeliveryNotBefore(error, now) : undefined;
        const overWait = notBefore !== undefined && notBefore - now.getTime() > EXTERNAL_DELIVERY_RETRY_AFTER_MAX_MINUTES * 60_000;
        await failWorkflowStep(execution.db, ref, row.lease_owner!, {
          now: now.getTime(),
          providerRequestId,
          unknown, permanent: rejected && !next,
          code: unknown ? reply ? 'reply_unknown' : 'delivery_unknown' : !started ? 'delivery_not_started' : overWait ? 'retry_after_exceeds_budget' : next ? 'line_rate_limited' : 'line_rejected',
          delayMs: Math.max(0, (next?.getTime() ?? notBefore ?? now.getTime()) - now.getTime()),
        });
        throw error;
      }
    };
  } });
}
