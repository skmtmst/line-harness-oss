import type { FormSubmitClaim } from '../form-submit-claim-types.js';
import type { FormSubmission } from '../form-submission-types.js';
import { jstNow } from '../utils.js';
import { type FormSubmitClaimScope, type FormSubmitOutboxEvent } from './types.js';
import { claimBindings } from './claims.js';


/** 配達の意図行を読む。なければ NULL。 */
export async function getFormSubmitOutbox(
  db: D1Database,
  scope: FormSubmitClaimScope,
  kind: string,
): Promise<FormSubmitOutboxEvent | null> {
  return db
    .prepare(
      `SELECT * FROM form_submit_outbox
       WHERE tenant_id = ? AND line_account_id = ? AND form_id = ?
         AND friend_id = ? AND idempotency_key = ? AND kind = ?`,
    )
    .bind(...claimBindings(scope), kind)
    .first<FormSubmitOutboxEvent>();
}

/**
 * 配達の意図行を確保する。安定した event_id で呼ぶ前に作り、すでにあれば
 * 作り直さない(呼び直しも同じ event_id を使う)。
 */
export async function ensureFormSubmitOutboxEvent(
  db: D1Database,
  scope: FormSubmitClaimScope,
  kind: string,
  eventId: string,
): Promise<FormSubmitOutboxEvent> {
  const now = jstNow();
  await db
    .prepare(
      `INSERT OR IGNORE INTO form_submit_outbox
         (tenant_id, line_account_id, form_id, friend_id, idempotency_key,
          kind, event_id, status, payload, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, 'pending', NULL, ?, ?)`,
    )
    .bind(...claimBindings(scope), kind, eventId, now, now)
    .run();
  const row = await getFormSubmitOutbox(db, scope, kind);
  if (!row) throw new Error('form_submit_outbox_missing_row');
  return row;
}

/**
 * 配達の結果を残す。pending のときだけ delivered にし、最初の結果を保つ。
 * (呼び直しの重ね書きをしない)
 */
export async function markFormSubmitOutboxDelivered(
  db: D1Database,
  scope: FormSubmitClaimScope,
  kind: string,
  eventId: string,
  payload: unknown,
): Promise<boolean> {
  const result = await db
    .prepare(
      `UPDATE form_submit_outbox
          SET status = 'delivered', payload = ?, updated_at = ?
        WHERE tenant_id = ? AND line_account_id = ? AND form_id = ?
          AND friend_id = ? AND idempotency_key = ? AND kind = ?
          AND event_id = ? AND status = 'pending'`,
    )
    .bind(JSON.stringify(payload), jstNow(), ...claimBindings(scope), kind, eventId)
    .run();
  return (result.meta.changes ?? 0) > 0;
}

/** 配達の結果を読む。壊れていれば NULL。 */
export function readFormSubmitOutboxPayload(payload: string | null): { passed: boolean; data: unknown } | null {
  if (!payload) return null;
  try {
    const parsed = JSON.parse(payload) as { passed?: unknown; data?: unknown };
    if (!parsed || typeof parsed.passed !== 'boolean') return null;
    return { passed: parsed.passed, data: parsed.data };
  } catch {
    return null;
  }
}

/**
 * 同じ内容の未完の予約を探す。画面を開き直してキーが変わった再送でも、
 * 未完の予約があれば新しい回答を作らず、元のキーでの再開へ誘導する
 * (二重回答にしない)。期限切れ・完了済みは対象外。
 */
export async function findUnfinishedFormSubmitClaimByHash(
  db: D1Database,
  scope: Omit<FormSubmitClaimScope, 'key'>,
  requestHash: string,
): Promise<FormSubmitClaim | null> {
  return db
    .prepare(
      `SELECT * FROM form_submit_claims
       WHERE tenant_id = ? AND line_account_id = ? AND form_id = ?
         AND friend_id = ? AND request_hash = ? AND status != 'completed'
       ORDER BY updated_at DESC LIMIT 1`,
    )
    .bind(scope.tenantId, scope.lineAccountId, scope.formId, scope.friendId, requestHash)
    .first<FormSubmitClaim>();
}

/** 前回の回答。オプションの「前回の回答を復元する」で使う。 */
export async function getLatestFormSubmission(
  db: D1Database,
  formId: string,
  friendId: string,
): Promise<FormSubmission | null> {
  return db
    .prepare(
      `SELECT * FROM form_submissions
       WHERE form_id = ? AND friend_id = ? AND is_test = 0
       ORDER BY created_at DESC LIMIT 1`,
    )
    .bind(formId, friendId)
    .first<FormSubmission>();
}
