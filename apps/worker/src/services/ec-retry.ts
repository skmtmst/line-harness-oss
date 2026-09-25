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



export async function processDueEcRetries(
  db: D1Database,
  input: { now: string; limit?: number },
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
         OR (a.status = 'retryable_failed' AND a.next_retry_at IS NOT NULL AND a.next_retry_at <= ?)
         OR (a.status = 'processing' AND a.updated_at < ?))
        AND a.attempt_count < a.max_attempts
      ORDER BY a.updated_at
      LIMIT ?`,
  ).bind(input.now, staleBefore, limit).all<{
    event_row_id: string; payload: string; line_account_id: string;
    execution_id: string; execution_status: string; version: number;
  }>();

  for (const row of due.results ?? []) {
    //  lease：他の回収と二重に回さない。
    const leased = await db.prepare(
      `UPDATE ec_action_executions
          SET status = 'processing', version = version + 1, updated_at = ?
        WHERE id = ? AND version = ? AND status IN ('pending', 'retryable_failed', 'processing')`,
    ).bind(input.now, row.execution_id, row.version).run();
    if (Number(leased.meta.changes ?? 0) !== 1) {
      result.skipped += 1;
      continue;
    }
    // 停止中は回さず、再開時の戻しに任せる（試行回数を消費しない）。
    const connector = await db.prepare(
      `SELECT status FROM ec_connectors WHERE line_account_id = ?`,
    ).bind(row.line_account_id).first<{ status: string }>();
    if (connector?.status === 'paused') {
      await db.prepare(
        `UPDATE ec_action_executions SET status = ?, updated_at = ? WHERE id = ?`,
      ).bind(row.execution_status, input.now, row.execution_id).run();
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
      });
      if (outcome === 'duplicate') {
        // 誰かが処理中。待ちに戻す。
        await db.prepare(
          `UPDATE ec_action_executions SET status = 'pending', updated_at = ? WHERE id = ?`,
        ).bind(input.now, row.execution_id).run();
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
