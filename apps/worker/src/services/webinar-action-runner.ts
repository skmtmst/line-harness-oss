import {
  finishWebinarActionExecution,
  getWebinarActions,
  getWebinarById,
  insertWebinarActionExecutionIgnore,
  type WebinarActionTrigger,
} from '@line-crm/db';
import { createAutomationActionExecutors, type AutomationActionExecutorDependencies } from './automation-action-executors.js';
import { executeConfiguredAction } from './action-execution-context.js';
import {
  attachTagAndFireSideEffects,
  detachTagAndFireSideEffects,
} from './friend-tag-attach.js';

/*
 * 視聴後アクションの実行口。視聴完了・CTAクリックの出来事から呼び出す。
 * 同じ設定・友だち・回・きっかけは冪等キーで1件にまとめ、二重実行しない。
 * 結果は webinar_action_executions へ残し、参加者・監視の面から読める。
 *
 * タグは既存の付随処理を保ち、そのほかは共通の実行一覧へ渡す。
 * 実行口のない種類は skipped として記録し、実行しない。
 * 未視聴のきっかけは呼ぶ側の定時処理が無いため、ここでは扱わない。
 */
const EXECUTABLE_ACTION_TYPES = new Set(Object.keys(createAutomationActionExecutors()));

export function webinarActionIdempotencyKey(
  webinarId: string,
  actionId: string,
  friendId: string,
  sessionStartAt: number | null,
  trigger: WebinarActionTrigger,
): string {
  return `${webinarId}:${actionId}:${friendId}:${sessionStartAt ?? 'na'}:${trigger}`;
}

function readTagId(configJson: string): string | null {
  let config: unknown = null;
  try { config = JSON.parse(configJson); } catch { return null; }
  if (!config || typeof config !== 'object') return null;
  const tagId = (config as Record<string, unknown>).tagId;
  return typeof tagId === 'string' && tagId.trim() ? tagId.trim() : null;
}

export async function runWebinarTriggerActions(
  db: D1Database,
  input: {
    webinarId: string;
    friendId: string;
    sessionStartAt: number | null;
    trigger: WebinarActionTrigger;
    executorDependencies?: AutomationActionExecutorDependencies;
  },
): Promise<void> {
  const actions = (await getWebinarActions(db, input.webinarId))
    .filter((action) => action.trigger === input.trigger);
  for (const action of actions) {
    const idempotencyKey = webinarActionIdempotencyKey(
      input.webinarId, action.id, input.friendId, input.sessionStartAt, input.trigger,
    );
    if (!EXECUTABLE_ACTION_TYPES.has(action.action_type)) {
      await insertWebinarActionExecutionIgnore(db, {
        webinarActionId: action.id,
        webinarId: input.webinarId,
        friendId: input.friendId,
        sessionStartAt: input.sessionStartAt,
        trigger: input.trigger,
        status: 'skipped',
        idempotencyKey,
        lastError: 'unsupported_action_type',
      });
      continue;
    }
    const tagId = readTagId(action.config_json);
    if (['add_tag', 'remove_tag'].includes(action.action_type) && !tagId) {
      await insertWebinarActionExecutionIgnore(db, {
        webinarActionId: action.id,
        webinarId: input.webinarId,
        friendId: input.friendId,
        sessionStartAt: input.sessionStartAt,
        trigger: input.trigger,
        status: 'skipped',
        idempotencyKey,
        lastError: 'missing_tag',
      });
      continue;
    }
    const claimed = await insertWebinarActionExecutionIgnore(db, {
      webinarActionId: action.id,
      webinarId: input.webinarId,
      friendId: input.friendId,
      sessionStartAt: input.sessionStartAt,
      trigger: input.trigger,
      status: 'queued',
      idempotencyKey,
    });
    // 既に記録がある（実行済み・実行中・見送り）ものは触らない。
    if (!claimed) continue;
    try {
      if (action.action_type === 'add_tag') {
        await attachTagAndFireSideEffects(db, input.friendId, tagId!);
      } else if (action.action_type === 'remove_tag') {
        await detachTagAndFireSideEffects(db, input.friendId, tagId!);
      } else {
        const webinar = await getWebinarById(db, input.webinarId);
        if (!webinar?.account_id) throw new Error('webinar_account_missing');
        await executeConfiguredAction(db, {friendId: input.friendId, accountId: webinar.account_id,
          source: 'webinar', sourceEventId: idempotencyKey, actionId: action.id, type: action.action_type,
          params: JSON.parse(action.config_json), dependencies: input.executorDependencies});
      }
      await finishWebinarActionExecution(db, idempotencyKey, 'succeeded', null);
    } catch (err) {
      await finishWebinarActionExecution(
        db, idempotencyKey, 'permanent_failed',
        err instanceof Error ? err.message : 'action_failed',
      );
    }
  }
}
