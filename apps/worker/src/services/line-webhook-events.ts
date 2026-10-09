import { acquireWorkflow, type WorkflowExecution } from './workflow-execution.js';
import type { WebhookEvent } from '@line-crm/line-sdk';
import {
  markLineWebhookEventFailed,
  markLineWebhookEventSucceeded,
  reserveLineWebhookEvent, getLineWebhookEvent, getWorkflowStep, ensureWorkflowStep,
} from '@line-crm/db';
import type { LineWebhookErrorClassification } from '@line-crm/db';

type SafeWebhookLog = {
  event: string;
  webhook_event_id: string;
  line_account_id: string | null;
  event_type: string;
  reason?: LineWebhookErrorClassification;
};

export type WebhookEventHandler = (event: WebhookEvent, execution: WorkflowExecution) => Promise<void>;

/**
 * 例外の本文は保存もログ出力もせず、運用に必要な短い分類だけへ変換する。
 */
export function classifyLineWebhookError(error: unknown): LineWebhookErrorClassification {
  const candidate = error as {
    name?: unknown;
    message?: unknown;
    status?: unknown;
    statusCode?: unknown;
  } | null;
  const name = typeof candidate?.name === 'string' ? candidate.name.toLowerCase() : '';
  const message = typeof candidate?.message === 'string' ? candidate.message.toLowerCase() : '';
  const status = candidate?.status ?? candidate?.statusCode;

  if (
    name.includes('d1') ||
    name.includes('sqlite') ||
    message.includes('d1_error') ||
    message.includes('sqlite')
  ) {
    return 'db_error';
  }
  if (
    name.includes('line') ||
    message.includes('line api error') ||
    (typeof status === 'number' && status >= 400 && status <= 599)
  ) {
    return 'line_api_error';
  }
  return 'unknown';
}

function safeLog(
  level: 'log' | 'warn' | 'error',
  value: SafeWebhookLog,
): void {
  console[level](value);
}

/**
 * 1リクエスト内のイベントを、それぞれ独立して処理する。
 * 1件の失敗をここで吸収するため、後続イベントとLINEへの200応答を止めない。
 */
export async function processLineWebhookEvents(input: {
  db: D1Database;
  events: WebhookEvent[];
  lineAccountId: string | null;
  handle: WebhookEventHandler;
}): Promise<void> {
  for (const webhookEvent of input.events) {
    const logBase: SafeWebhookLog = {
      event: 'line_webhook_event',
      webhook_event_id: webhookEvent.webhookEventId,
      line_account_id: input.lineAccountId,
      event_type: webhookEvent.type,
    };

    const reservation = {
      webhookEventId: webhookEvent.webhookEventId,
      lineAccountId: input.lineAccountId,
      eventType: webhookEvent.type,
    };
    const ref={scopeId:`line:${input.lineAccountId ?? 'default'}`,processKind:'line_event',subjectId:webhookEvent.webhookEventId};
    try {
      const prior=await getLineWebhookEvent(input.db,webhookEvent.webhookEventId);
      const checkpoint=await getWorkflowStep(input.db,{...ref,stepKey:'__run'});
      if(prior && !checkpoint) {
        if(prior.status!=='succeeded') await ensureWorkflowStep(input.db,{...ref,stepKey:'__run'},
          {status:'unknown',input:{eventType:webhookEvent.type}});
        safeLog('log',{...logBase,event:'line_webhook_duplicate_skipped'});
        continue;
      }
      const execution=await acquireWorkflow(input.db,ref,{input:{eventType:webhookEvent.type}});
      if(!execution) {safeLog('log',{...logBase,event:'line_webhook_duplicate_skipped'});continue;}
      try {
        let reserved=false;
        for(let attempt=0;attempt<2;attempt++){
          try{await reserveLineWebhookEvent(execution.db,reservation);reserved=true;break}
          catch(error){if(attempt===1)throw error}
        }
        if(!reserved)throw new Error('line_event_reservation_failed');
        await input.handle(webhookEvent,execution);
        await markLineWebhookEventSucceeded(execution.db,webhookEvent.webhookEventId);
        await execution.complete();
      }catch(error){
        const reason=classifyLineWebhookError(error);
        await markLineWebhookEventFailed(execution.db,webhookEvent.webhookEventId,reason).catch(()=>undefined);
        await execution.fail();
        safeLog('error',{...logBase,event:'line_webhook_event_failed',reason});
      }
    }catch {
      // A missing checkpoint store must never enable duplicate external sends.
      safeLog('error',{...logBase,event:'line_webhook_ledger_reserve_failed',reason:'db_error'});
    }
  }
}
