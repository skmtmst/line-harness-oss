import { jstNow } from '@line-crm/db';
import {
  createAutomationActionExecutors,
  type AutomationActionExecutorDependencies,
} from './automation-action-executors.js';
import {
  type ActionDefinition,
  type AutomationActionContext,
  type AutomationActionExecutor,
} from './automation-engine.js';
import { validateActionShape } from './common-actions.js';

/*
 * 一斉配信の送信後動作（タグ付け等）。
 *
 * 動かすのは LINE が受け付けた宛先（send_claims = 'sent'）だけ。失敗・
 * 送達不明の宛先には触れない。固定した公開版の action_config を実行し、
 * (broadcast_id, friend_id, action_id) の一意制約で二重実行を防ぐ。
 * 送信の成否は変えない（送ったあとの処理が落ちても送達は送達）。
 */

const MAX_EXPAND_DEPTH = 5;
const MAX_EXPANDED_ACTIONS = 100;
const DEFAULT_MAX_ATTEMPTS = 5;

export interface BroadcastAfterActionResult {
  /** 台帳に残った実行のうち、今回 done になった数。 */
  done: number;
  /** 今回 failed になった数（上限到達を含む）。 */
  failed: number;
  /** すでに done で触らなかった宛先の数。 */
  skipped: number;
}

/**
 * 取り残しの回収。送信 tick とクラッシュのあいだに落ちた分（受理済みだが
 * 実行が終わっていない宛先・失敗して上限に届いていない行）を拾う。
 * 失敗・送達不明の宛先はここでも対象外。
 */
export async function sweepBroadcastAfterActions(
  db: D1Database,
  input: {
    limit?: number;
    executors?: Record<string, AutomationActionExecutor>;
    executorDependencies?: AutomationActionExecutorDependencies;
  } = {},
): Promise<{ broadcasts: number; done: number; failed: number }> {
  const total = { broadcasts: 0, done: 0, failed: 0 };
  const rows = await db.prepare(
    `SELECT DISTINCT c.broadcast_id AS broadcast_id
       FROM broadcast_send_claims c
       JOIN broadcasts b ON b.id = c.broadcast_id
      WHERE b.after_action_version_id IS NOT NULL AND c.state = 'sent'
        AND NOT EXISTS (
          SELECT 1 FROM broadcast_after_action_runs r
           WHERE r.broadcast_id = c.broadcast_id AND r.friend_id = c.friend_id
             AND r.status = 'done'
        )
      UNION
     SELECT DISTINCT broadcast_id FROM broadcast_after_action_runs
      WHERE status IN ('pending', 'failed') AND attempt_count < max_attempts
      LIMIT ?`,
  ).bind(input.limit ?? 50).all<{ broadcast_id: string }>();
  for (const row of rows.results ?? []) {
    total.broadcasts += 1;
    try {
      const result = await processBroadcastAfterActions(db, {
        broadcastId: row.broadcast_id,
        limit: 200,
        executors: input.executors,
        executorDependencies: input.executorDependencies,
      });
      total.done += result.done;
      total.failed += result.failed;
    } catch (error) {
      console.error(`[broadcast-after-actions] sweep failed broadcast=${row.broadcast_id}`, error);
    }
  }
  return total;
}

type PinnedVersion = {
  id: string;
  ownerAccountId: string | null;
  actionConfig: string;
};

async function loadPinnedVersion(
  db: D1Database,
  versionId: string,
): Promise<PinnedVersion | null> {
  const row = await db.prepare(
    `SELECT cav.id, cav.action_config, ca.line_account_id AS owner_account
       FROM common_action_versions cav
       JOIN common_actions ca ON ca.id = cav.common_action_id
      WHERE cav.id = ?`,
  ).bind(versionId).first<{ id: string; action_config: string; owner_account: string | null }>();
  if (!row) return null;
  return { id: row.id, ownerAccountId: row.owner_account, actionConfig: row.action_config };
}

/** 入れ子の共通アクション参照を、固定した公開版へ展開する（深さ・件数に上限）。 */
async function expandActions(
  db: D1Database,
  lineAccountId: string,
  actions: ActionDefinition[],
  depth: number,
  budget: { count: number },
  prefix: string,
): Promise<ActionDefinition[]> {
  if (depth > MAX_EXPAND_DEPTH) {
    throw new Error('common_action_too_deep');
  }
  const out: ActionDefinition[] = [];
  for (const action of actions) {
    budget.count += 1;
    if (budget.count > MAX_EXPANDED_ACTIONS) throw new Error('execution_plan_too_large');
    const stepKey = prefix ? `${prefix}/${action.id}` : action.id;
    if (action.type === 'common_action') {
      const refId = action.params.commonActionId;
      if (typeof refId !== 'string' || !refId.trim()) throw new Error('common_action_id_missing');
      const nested = await db.prepare(
        `SELECT cav.action_config
           FROM common_action_versions cav
           JOIN common_actions ca ON ca.id = cav.common_action_id
          WHERE cav.common_action_id = ? AND cav.status = 'published' AND ca.line_account_id = ?
          ORDER BY cav.version_number DESC LIMIT 1`,
      ).bind(refId, lineAccountId).first<{ action_config: string }>();
      if (!nested) throw new Error('common_action_version_not_found');
      out.push(...await expandActions(
        db, lineAccountId, validateActionShape(JSON.parse(nested.action_config)),
        depth + 1, budget, stepKey,
      ));
      continue;
    }
    out.push({ ...action, id: stepKey });
  }
  return out;
}

function errorCodeOf(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  if (message === 'common_action_too_deep' || message === 'execution_plan_too_large') return message;
  if (message === 'common_action_id_missing' || message === 'common_action_version_not_found') return message;
  if (message === 'stored_action_config_invalid') return message;
  if (/^[a-z0-9_]{1,64}$/.test(message)) return message;
  return 'after_action_failed';
}

export async function processBroadcastAfterActions(
  db: D1Database,
  input: {
    broadcastId: string;
    limit?: number;
    executors?: Record<string, AutomationActionExecutor>;
    executorDependencies?: AutomationActionExecutorDependencies;
  },
): Promise<BroadcastAfterActionResult> {
  const result: BroadcastAfterActionResult = { done: 0, failed: 0, skipped: 0 };
  const limit = input.limit ?? 200;
  const broadcast = await db.prepare(
    `SELECT id, line_account_id, after_action_version_id FROM broadcasts WHERE id = ?`,
  ).bind(input.broadcastId).first<{
    id: string; line_account_id: string | null; after_action_version_id: string | null;
  }>();
  // 送信後動作の指定が無い配信は対象外。壊れた指定は送達を壊さない。
  if (!broadcast?.after_action_version_id) return result;
  const version = await loadPinnedVersion(db, broadcast.after_action_version_id);
  if (!version) return result;
  if (!broadcast.line_account_id || version.ownerAccountId !== broadcast.line_account_id) return result;
  let plan: ActionDefinition[];
  try {
    plan = await expandActions(
      db, broadcast.line_account_id, validateActionShape(JSON.parse(version.actionConfig)),
      0, { count: 0 }, '',
    );
  } catch {
    return result;
  }
  if (plan.length === 0) return result;
  const lineAccountId = broadcast.line_account_id;

  // 受理済みで、まだ実行し終えていない宛先だけを拾う。失敗・送達不明は
  // 最初から対象外（送達台帳の state が 'sent' の行だけ見る）。
  const targets = await db.prepare(
    `SELECT c.friend_id AS friend_id
       FROM broadcast_send_claims c
      WHERE c.broadcast_id = ? AND c.state = 'sent'
        AND NOT EXISTS (
          SELECT 1 FROM broadcast_after_action_runs r
           WHERE r.broadcast_id = c.broadcast_id AND r.friend_id = c.friend_id
             AND r.status = 'done'
        )
      ORDER BY c.friend_id
      LIMIT ?`,
  ).bind(input.broadcastId, limit).all<{ friend_id: string }>();

  const executors = input.executors ?? createAutomationActionExecutors(input.executorDependencies);
  for (const target of targets.results ?? []) {
    const friendId = target.friend_id;
    const doneRow = await db.prepare(
      `SELECT 1 FROM broadcast_after_action_runs
        WHERE broadcast_id = ? AND friend_id = ? AND status = 'done' LIMIT 1`,
    ).bind(input.broadcastId, friendId).first();
    if (doneRow) {
      result.skipped += 1;
      continue;
    }
    let stopped = false;
    for (const action of plan) {
      if (stopped) break;
      const now = jstNow();
      await db.prepare(
        `INSERT OR IGNORE INTO broadcast_after_action_runs
           (id, broadcast_id, friend_id, common_action_version_id, action_id, status,
            attempt_count, max_attempts, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, 'pending', 0, ?, ?, ?)`,
      ).bind(
        crypto.randomUUID(), input.broadcastId, friendId, version.id, action.id,
        DEFAULT_MAX_ATTEMPTS, now, now,
      ).run();
      const claimed = await db.prepare(
        `UPDATE broadcast_after_action_runs
            SET status = 'running', attempt_count = attempt_count + 1, updated_at = ?
          WHERE broadcast_id = ? AND friend_id = ? AND action_id = ?
            AND status IN ('pending', 'failed') AND attempt_count < max_attempts`,
      ).bind(now, input.broadcastId, friendId, action.id).run();
      // done・実行中・上限到達は触らない（上限到達は人手の見直し対象として残す）。
      if (Number(claimed.meta.changes ?? 0) !== 1) {
        const row = await db.prepare(
          `SELECT status FROM broadcast_after_action_runs
            WHERE broadcast_id = ? AND friend_id = ? AND action_id = ?`,
        ).bind(input.broadcastId, friendId, action.id).first<{ status: string }>();
        if (row?.status === 'failed') {
          result.failed += 1;
          if (action.onFailure === 'stop') stopped = true;
        }
        continue;
      }
      const executor = executors[action.type];
      if (!executor) {
        await db.prepare(
          `UPDATE broadcast_after_action_runs
              SET status = 'failed', error_code = 'unsupported_action_type', updated_at = ?
            WHERE broadcast_id = ? AND friend_id = ? AND action_id = ?`,
        ).bind(jstNow(), input.broadcastId, friendId, action.id).run();
        result.failed += 1;
        if (action.onFailure === 'stop') stopped = true;
        continue;
      }
      try {
        const context: AutomationActionContext = {
          db,
          runId: `broadcast:${input.broadcastId}`,
          lineAccountId,
          automationId: `broadcast:${input.broadcastId}`,
          automationVersionId: version.id,
          friendId,
          sourceEventId: input.broadcastId,
          inputEvent: { broadcastId: input.broadcastId },
          action,
          stepExecutionId: `${input.broadcastId}:${friendId}:${action.id}`,
          idempotencyKey: `${input.broadcastId}:${friendId}:${action.id}`,
          attemptNumber: 1,
          commonActionVersionId: version.id,
          isTest: false,
        };
        await executor(context);
        await db.prepare(
          `UPDATE broadcast_after_action_runs
              SET status = 'done', error_code = NULL, updated_at = ?
            WHERE broadcast_id = ? AND friend_id = ? AND action_id = ?`,
        ).bind(jstNow(), input.broadcastId, friendId, action.id).run();
        result.done += 1;
      } catch (error) {
        await db.prepare(
          `UPDATE broadcast_after_action_runs
              SET status = 'failed', error_code = ?, updated_at = ?
            WHERE broadcast_id = ? AND friend_id = ? AND action_id = ?`,
        ).bind(errorCodeOf(error), jstNow(), input.broadcastId, friendId, action.id).run();
        result.failed += 1;
        if (action.onFailure === 'stop') stopped = true;
      }
    }
  }
  return result;
}
