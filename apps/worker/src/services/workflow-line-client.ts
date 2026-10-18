import type { LineClient, Message } from '@line-crm/line-sdk';
import { claimWorkflowStep, ensureWorkflowStep, failWorkflowStep, finishWorkflowStep, getWorkflowStep, workflowBindings, WORKFLOW_WHERE } from '@line-crm/db';
import type { WorkflowExecution } from './workflow-execution.js';
import { WorkflowDeferred } from './workflow-execution.js';
import { EXTERNAL_DELIVERY_MAX_ATTEMPTS, externalDeliveryRetryAt } from './external-delivery-retry.js';

/** Automatic sends retain their original wire inputs; reply tokens never enter the ledger. */
export function workflowLineClient(client: LineClient, execution: WorkflowExecution): LineClient {
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
      const ref = { ...execution.ref, stepKey: `line:${namespace}:${index}` };
      const previous = await ensureWorkflowStep(execution.db, ref, {
        input: reply ? { messages } : { to: toOrToken, messages },
        maxAttempts: EXTERNAL_DELIVERY_MAX_ATTEMPTS, retryKey: reply ? undefined : retryKey,
      });
      if (previous.status === 'succeeded') return JSON.parse(previous.result_json ?? 'null');
      // A lease expiration is not proof that a provider did not accept a send.
      // Include old running rows which predate the explicit started marker.
      if (previous.status === 'running') {
        const now=Date.now();
        if((previous.lease_expires_at ?? 0)>now)throw new WorkflowDeferred('busy');
        await execution.db.prepare(`UPDATE workflow_steps SET status='unknown',error_code=?,
          lease_owner=NULL,lease_expires_at=NULL,next_attempt_at=NULL,updated_at=?
          WHERE ${WORKFLOW_WHERE} AND status='running' AND lease_expires_at<=?`)
          .bind(reply?'reply_unknown':'delivery_unknown',now,...workflowBindings(ref),now).run();
        throw new WorkflowDeferred(reply?'reply_unknown':'delivery_unknown');
      }
      if (previous.status === 'unknown' || reply && previous.first_attempt_at !== null) {
        throw new WorkflowDeferred(reply ? 'reply_unknown' : 'delivery_unknown');
      }
      // Existing rows may carry the former five-attempt budget. Never raise a stricter one.
      await execution.db.prepare(`UPDATE workflow_steps SET max_attempts=MIN(max_attempts,?) WHERE ${WORKFLOW_WHERE}`)
        .bind(EXTERNAL_DELIVERY_MAX_ATTEMPTS, ...workflowBindings(ref)).run();
      const row = await claimWorkflowStep(execution.db, ref);
      if (!row) throw new WorkflowDeferred((await getWorkflowStep(execution.db, ref))?.status ?? 'busy');
      const original = JSON.parse(row.input_json!);
      let started = false, accepted = false;
      try {
        const marked = await execution.db.prepare(`UPDATE workflow_steps SET error_code='delivery_started'
          WHERE ${WORKFLOW_WHERE} AND status='running' AND lease_owner=? AND lease_expires_at>?`)
          .bind(...workflowBindings(ref), row.lease_owner, Date.now()).run();
        if (marked.meta.changes !== 1) throw new WorkflowDeferred('busy');
        started = true;
        const result = reply
          ? await target[method as 'replyMessage'](toOrToken, original.messages)
          : await target[method as 'pushMessage'](original.to, original.messages, row.retry_key);
        accepted = true;
        await finishWorkflowStep(execution.db, ref, row.lease_owner!, { result });
        return result;
      } catch (error) {
        const status = Number((error as { status?: unknown } | null)?.status ?? 0);
        const rejected = !accepted && status >= 400 && status < 500 && status !== 408;
        const unknown = started && !rejected;
        const now = new Date();
        const next = rejected && status === 429 ? externalDeliveryRetryAt(error, row.attempt_count, now, true) : null;
        await failWorkflowStep(execution.db, ref, row.lease_owner!, {
          unknown, permanent: rejected && !next,
          code: unknown ? reply ? 'reply_unknown' : 'delivery_unknown' : 'delivery_failed',
          delayMs: next ? next.getTime() - now.getTime() : 0,
        });
        throw error;
      }
    };
  } });
}
