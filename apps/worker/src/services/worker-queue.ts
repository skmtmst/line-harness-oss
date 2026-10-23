import { logger, resumeInvocation, withInvocation } from '@line-crm/shared/server';
import type { WorkerBindings } from '../worker-bindings.js';
import { qaOutboundStopped } from './staging-qa-safety.js';
import { markCodexMentionFailed, processCodexMentionMessage, shouldStopCodexQueueRetry } from './codex-cloud-monitor.js';
import type { CodexMentionQueueMessage } from './codex-cloud-types.js';
import type { AccountWorkMessage } from './account-work-types.js';
import { AccountWorkBusyError, consumeAccountWork } from './account-work-consumer.js';

export async function consumeWorkerQueue(
  batch: MessageBatch<CodexMentionQueueMessage | AccountWorkMessage>,
  env: WorkerBindings,
): Promise<void> {
  if (qaOutboundStopped(env)) {
    for (const message of batch.messages) message.retry({ delaySeconds: 60 });
    return;
  }
  let accountProcessed = false;
  for (const message of batch.messages) {
    const body = message.body;
    if (body?.kind === 'account_work') {
      // The dedicated queue is configured with max_batch_size=1. Defend against
      // configuration drift as the D1 query budget belongs to the whole invocation.
      if (accountProcessed) { message.retry({ delaySeconds: 1 }); continue; }
      accountProcessed = true;
      await withInvocation('queue', async () => {
        try { await consumeAccountWork(env, body); message.ack(); }
        catch (error) {
          logger.error('account_work_failed');
          // Exhausted jobs go to the queue's DLQ; never acknowledge lost work.
          message.retry({ delaySeconds: error instanceof AccountWorkBusyError ? error.retryDelaySeconds : 60 });
        }
      });
      continue;
    }
    await withInvocation('queue', () => resumeInvocation(body?.requestId, async () => {
      try { await processCodexMentionMessage(env, body); message.ack(); }
      catch {
        logger.error('src_index_failed');
        if (shouldStopCodexQueueRetry(message.attempts, env.CODEX_QUEUE_MAX_ATTEMPTS)) {
          try {
            if (body.kind !== 'auto_merge') await markCodexMentionFailed(env.DB, body.slackEventId);
          } catch { logger.error('codex_cloud_monitor_queue_ledger_failed'); }
          message.ack();
        } else message.retry({ delaySeconds: 60 });
      }
    }));
  }
}
