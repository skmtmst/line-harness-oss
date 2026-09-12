import type {
  IncomingWebhookActionRef,
  IncomingWebhookIdentityMatch,
} from '@line-crm/db';
import type { ActionDefinition, AutomationActionContext } from './automation-engine.js';
import { stableWebhookStepId, type IncomingWebhookExecution } from './incoming-webhook-receipts.js';
import {
  createAutomationActionExecutors,
  type AutomationActionExecutorDependencies,
} from './automation-action-executors.js';

type ActionRunResult = {
  matchedFriendId: string | null;
  executed: number;
  failed: number;
};

function valueAtPath(payload: unknown, path: string): unknown {
  if (path === '$') return payload;
  const segments = path.slice(1).match(/\.[A-Za-z_][A-Za-z0-9_-]*|\[\d+\]/g) ?? [];
  let value = payload;
  for (const segment of segments) {
    if (value === null || typeof value !== 'object') return undefined;
    const key = segment.startsWith('.') ? segment.slice(1) : Number(segment.slice(1, -1));
    value = (value as Record<string | number, unknown>)[key];
  }
  return value;
}

async function resolveFriendId(
  db: D1Database,
  lineAccountId: string,
  payload: unknown,
  config: IncomingWebhookIdentityMatch,
): Promise<string | null> {
  for (const method of config.methods) {
    const raw = valueAtPath(payload, method.path);
    const value = typeof raw === 'string' ? raw.trim() : typeof raw === 'number' ? String(raw) : '';
    if (!value) continue;
    if (method.kind === 'harness_friend_id') {
      const row = await db.prepare(
        `SELECT id FROM friends WHERE id = ? AND line_account_id = ?`,
      ).bind(value, lineAccountId).first<{ id: string }>();
      if (row) return row.id;
      continue;
    }
    const column = method.kind === 'external_customer_id'
      ? 'external_id'
      : method.kind === 'verified_email' ? 'email' : 'phone';
    const row = await db.prepare(
      `SELECT f.id
         FROM friends f
         JOIN users u ON u.id = f.user_id
        WHERE f.line_account_id = ? AND u.${column} = ?
        ORDER BY f.created_at ASC LIMIT 1`,
    ).bind(lineAccountId, value).first<{ id: string }>();
    if (row) return row.id;
  }
  return null;
}

function directAction(ref: IncomingWebhookActionRef, index: number): ActionDefinition | null {
  const base = { id: `incoming-${index + 1}`, onFailure: 'continue' as const };
  switch (ref.refKind) {
    case 'tag':
      return { ...base, type: 'add_tag', params: { tagId: ref.refId } };
    case 'support_mark':
      return { ...base, type: 'set_support_mark', params: { markId: ref.refId } };
    case 'template':
      return { ...base, type: 'send_message', params: { templateId: ref.refId } };
    case 'scenario':
      return { ...base, type: 'start_scenario', params: { scenarioId: ref.refId } };
    case 'outgoing_webhook':
      return { ...base, type: 'send_webhook', params: { webhookId: ref.refId } };
    default:
      return null;
  }
}

async function commonActionPlan(
  db: D1Database,
  lineAccountId: string,
  ref: IncomingWebhookActionRef,
): Promise<ActionDefinition[]> {
  const version = await db.prepare(
    `SELECT v.action_config
       FROM common_actions a
       JOIN common_action_versions v
         ON v.id = COALESCE(?, a.current_published_version_id)
        AND v.common_action_id = a.id AND v.status = 'published'
      WHERE a.id = ? AND a.line_account_id = ? AND a.status = 'published'`,
  ).bind(ref.refVersionId, ref.refId, lineAccountId).first<{ action_config: string }>();
  if (!version) throw new Error('公開済みの共通アクションが見つかりません');
  const parsed: unknown = JSON.parse(version.action_config);
  if (!Array.isArray(parsed)) throw new Error('共通アクションの内容が壊れています');
  return parsed as ActionDefinition[];
}

export async function executeIncomingWebhookActions(
  db: D1Database,
  input: {
    lineAccountId: string;
    webhookId: string;
    sourceEventId: string;
    payload: unknown;
    identityMatching: IncomingWebhookIdentityMatch;
    actions: IncomingWebhookActionRef[];
    dependencies?: AutomationActionExecutorDependencies;
    execution?: IncomingWebhookExecution;
  },
): Promise<ActionRunResult> {
  if (input.actions.length === 0) return { matchedFriendId: null, executed: 0, failed: 0 };
  const resolve = () => resolveFriendId(db, input.lineAccountId, input.payload, input.identityMatching);
  const friendId = input.execution ? await input.execution.step('matched-friend', resolve) : await resolve();
  if (!friendId) return { matchedFriendId: null, executed: 0, failed: 0 };

  const executors = createAutomationActionExecutors(input.dependencies);
  let executed = 0;
  let failed = 0;
  let sequence = 0;
  for (const [refIndex, ref] of input.actions.entries()) {
    let plan: ActionDefinition[];
    try {
      const makePlan = async () => ref.refKind === 'common_action'
        ? await commonActionPlan(db, input.lineAccountId, ref)
        : [directAction(ref, sequence)].filter((item): item is ActionDefinition => item !== null);
      plan = input.execution ? await input.execution.step(`plan:${refIndex}`, makePlan) : await makePlan();
      if (plan.length === 0) throw new Error(`未対応の受信Webhook処理です: ${ref.refKind}`);
    } catch (error) {
      console.error('[incoming-webhook-actions] plan failed', error);
      failed++;
      continue;
    }
    for (const [actionIndex, action] of plan.entries()) {
      sequence++;
      const executor = executors[action.type];
      if (!executor) {
        failed++;
        continue;
      }
      const stepKey = `action:${refIndex}:${actionIndex}`;
      const stepExecutionId = await stableWebhookStepId(input.sourceEventId, stepKey);
      const context: AutomationActionContext = {
        db,
        runId: input.sourceEventId,
        lineAccountId: input.lineAccountId,
        automationId: `incoming-webhook:${input.webhookId}`,
        automationVersionId: input.webhookId,
        friendId,
        sourceEventId: input.sourceEventId,
        inputEvent: { type: 'incoming_webhook', payload: input.payload },
        action,
        stepExecutionId,
        idempotencyKey: stepExecutionId,
        attemptNumber: 1,
        commonActionVersionId: ref.refVersionId,
        isTest: false,
      };
      try {
        if (input.execution) {
          await input.execution.step(stepKey, () => executor(context));
        } else {
          await executor(context);
        }
        executed++;
      } catch (error) {
        console.error(`[incoming-webhook-actions] action=${action.id} failed`, error);
        failed++;
      }
    }
  }
  return { matchedFriendId: friendId, executed, failed };
}
