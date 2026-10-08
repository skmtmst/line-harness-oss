import { getLineAccountById } from '@line-crm/db';
import { markEcEventFailed, processEcEvent } from './ec-event-processing.js';
import { validateEvent, type EcEvent } from '../routes/ec-integrations.js';

/*
 * EC の再試行（上限つき）と dead letter。
 *
 * 受付口で落ちたイベントは待ち行列（retryable_failed + next_retry_at）に
 * 残る。手動の「もう一度」 (pending) も同じ列に並ぶ。この回収器が期限の
 * 来た行を取り、保存済み payload を同じ処理入口から回す。
 * 試行回数が上限に達したら dead letter（permanent_failed）へ倒し、
 * それ以上は触らない。取り込み停止中は回さない（再開時に戻す）。
 */

const STALE_PROCESSING_MINUTES = 30;

export interface EcRetrySweepResult {
  processed: number;
  failed: number;
  dead: number;
  skipped: number;
}



/**
 * W11 A: 実行の版番号で回収権を取り、中断した processing だけを入口へ戻す。
 * event が processed / identity_pending / skipped なら触らない。
 * 工程台帳による未完工程の再開（W11 B）は、この回収関数の後ろへ足せる。
 */
export async function claimEcRetryExecution(
  db: D1Database,
  input: { executionId: string; eventRowId: string; lineAccountId: string; expectedVersion: number; now: string; staleBefore: string },
): Promise<number | null> {
  const results = await db.batch([
    db.prepare(`UPDATE ec_action_executions
      SET status = 'processing', version = version + 1, updated_at = ?
      WHERE id = ? AND event_id = ? AND line_account_id = ? AND version = ?
        AND attempt_count < max_attempts
        AND NOT EXISTS (SELECT 1 FROM ec_connectors c WHERE c.line_account_id = ec_action_executions.line_account_id AND c.status = 'paused')
        AND (status = 'pending'
          OR (status = 'retryable_failed' AND next_retry_at IS NOT NULL AND julianday(next_retry_at) <= julianday(?))
          OR (status = 'processing' AND julianday(updated_at) < julianday(?)))
        AND EXISTS (SELECT 1 FROM ec_events e WHERE e.id = ec_action_executions.event_id
          AND e.line_account_id = ec_action_executions.line_account_id
          AND (e.status IN ('received','failed') OR (e.status = 'processing' AND julianday(e.updated_at) < julianday(?))))`)
      .bind(input.now, input.executionId, input.eventRowId, input.lineAccountId, input.expectedVersion, input.now, input.staleBefore, input.staleBefore),
    db.prepare(`UPDATE ec_events SET status = 'failed', updated_at = ?
      WHERE id = ? AND line_account_id = ? AND status = 'processing'
        AND julianday(updated_at) < julianday(?)
        AND changes() = 1
        AND EXISTS (SELECT 1 FROM ec_action_executions a
          WHERE a.id = ? AND a.event_id = ec_events.id AND a.line_account_id = ec_events.line_account_id
            AND a.status = 'processing' AND a.version = ? AND a.updated_at = ?)`)
      .bind(input.now, input.eventRowId, input.lineAccountId, input.staleBefore, input.executionId, input.expectedVersion + 1, input.now),
  ]);
  return Number(results[0].meta?.changes ?? 0) === 1 ? input.expectedVersion + 1 : null;
}

/** 自分が持つ回収権だけを解放する。後続の成功・他者の新版を戻さない。 */
async function releaseEcRetryExecution(db: D1Database, input: { executionId: string; version: number; now: string }) {
  await db.prepare(`UPDATE ec_action_executions SET status = 'pending', version = version + 1, updated_at = ?
    WHERE id = ? AND version = ? AND status = 'processing'`)
    .bind(input.now, input.executionId, input.version).run();
}

export async function processDueEcRetries(
  db: D1Database,
  input: { now: string; limit?: number; credentialKey?: string },
): Promise<EcRetrySweepResult> {
  const result: EcRetrySweepResult = { processed: 0, failed: 0, dead: 0, skipped: 0 };
  const limit = input.limit ?? 50;
  const staleBefore = new Date(new Date(input.now).getTime() - STALE_PROCESSING_MINUTES * 60 * 1000).toISOString();
  const due = await db.prepare(
    `SELECT e.id AS event_row_id, e.payload AS payload, e.line_account_id AS line_account_id,
            a.id AS execution_id, a.status AS execution_status, a.version AS version
       FROM ec_action_executions a
       JOIN ec_events e ON e.id = a.event_id AND e.line_account_id = a.line_account_id
      WHERE (a.status = 'pending'
         OR (a.status = 'retryable_failed' AND a.next_retry_at IS NOT NULL AND julianday(a.next_retry_at) <= julianday(?))
         OR (a.status = 'processing' AND julianday(a.updated_at) < julianday(?)))
        AND a.attempt_count < a.max_attempts
      ORDER BY a.updated_at
      LIMIT ?`,
  ).bind(input.now, staleBefore, limit).all<{
    event_row_id: string; payload: string; line_account_id: string;
    execution_id: string; execution_status: string; version: number;
  }>();

  for (const row of due.results ?? []) {
    const connector = await db.prepare(
      `SELECT status FROM ec_connectors WHERE line_account_id = ?`,
    ).bind(row.line_account_id).first<{ status: string }>();
    if (connector?.status === 'paused') {
      result.skipped += 1;
      continue;
    }
    const leaseVersion = await claimEcRetryExecution(db, {
      executionId: row.execution_id, eventRowId: row.event_row_id, lineAccountId: row.line_account_id,
      expectedVersion: row.version, now: input.now, staleBefore,
    });
    if (leaseVersion === null) {
      result.skipped += 1;
      continue;
    }
    let event: EcEvent;
    try {
      const parsed: unknown = JSON.parse(row.payload);
      if (!validateEvent(parsed)) throw new Error('stored_event_invalid');
      event = parsed;
    } catch {
      await markEcEventFailed(db, {
        eventRowId: row.event_row_id,
        externalEventId: row.event_row_id,
        lineAccountId: row.line_account_id,
        message: 'stored_event_invalid',
        now: input.now,
      });
      result.failed += 1;
      continue;
    }
    const account = await getLineAccountById(db, row.line_account_id);
    if (!account) {
      await markEcEventFailed(db, {
        eventRowId: row.event_row_id,
        externalEventId: event.event_id,
        lineAccountId: row.line_account_id,
        message: 'line_account_missing',
        now: input.now,
      });
      result.failed += 1;
      continue;
    }
    try {
      const outcome = await processEcEvent(db, {
        account,
        lineAccountId: row.line_account_id,
        event,
        eventRowId: row.event_row_id,
        now: input.now,
        credentialKey: input.credentialKey,
      });
      if (outcome === 'duplicate') {
        // 誰かが処理中。待ちに戻す。
        await releaseEcRetryExecution(db, { executionId: row.execution_id, version: leaseVersion, now: input.now });
        result.skipped += 1;
        continue;
      }
      result.processed += 1;
    } catch (error) {
      const message = error instanceof Error ? error.message.slice(0, 500) : 'Unknown error';
      await markEcEventFailed(db, {
        eventRowId: row.event_row_id,
        externalEventId: event.event_id,
        lineAccountId: row.line_account_id,
        message,
        now: input.now,
      });
      const check = await db.prepare(
        `SELECT status FROM ec_action_executions WHERE id = ?`,
      ).bind(row.execution_id).first<{ status: string }>();
      if (check?.status === 'permanent_failed') result.dead += 1;
      else result.failed += 1;
    }
  }
  return result;
}
