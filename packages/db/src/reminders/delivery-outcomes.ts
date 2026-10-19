import { type ReminderDeliveryRunRow, type ReminderDeliveryRunStatus, type ReminderDeliveryRunSentPayload, type RetryReminderDeliveryRunResult } from './types.js';
import { ownerGateSql } from './delivery-gates.js';


/**
 * 成功記録を、配信済み印・messages_logと同じD1 batchへ入れる。
 *
 * 登録が active のままのときだけ成功にする (原子的)。push と確定の間に
 * 取消が確定すると 0 件になり、取消後の送信として検出できる。
 * 検出時は送り直さない (外部送信の有無が曖昧なため再送は二重送信になり得る)。
 */
export function completeReminderDeliveryRunStatement(
  db: D1Database,
  input: {
    id: string;
    friendReminderId: string;
    lineRequestId: string | null;
    messageLogId: string;
    now: string;
    /** R340: 自分が今の持ち主のときだけ成功にする。 */
    expectedLeaseExpiresAt: string | string[];
  },
): D1PreparedStatement {
  const owner = ownerGateSql(
    Array.isArray(input.expectedLeaseExpiresAt)
      ? input.expectedLeaseExpiresAt
      : [input.expectedLeaseExpiresAt],
  );
  return db.prepare(
    `UPDATE reminder_delivery_runs
        SET status = 'succeeded', line_request_id = ?, message_log_id = ?, completed_at = ?,
            lease_expires_at = NULL, next_retry_at = NULL,
            last_error_code = NULL, last_error_message = NULL, updated_at = ?
      WHERE id = ? AND status = 'claimed' AND ${owner.sql}
        AND EXISTS (SELECT 1 FROM friend_reminders WHERE id = ? AND status = 'active')`,
  ).bind(
    input.lineRequestId,
    input.messageLogId,
    input.now,
    input.now,
    input.id,
    ...owner.bindings,
    input.friendReminderId,
  );
}

export async function skipReminderDeliveryRun(
  db: D1Database,
  input: { id: string; code: string; message: string; now: string; expectedLeaseExpiresAt: string | string[] },
): Promise<void> {
  // R340: 自分が握った行だけ止める。
  const owner = ownerGateSql(
    Array.isArray(input.expectedLeaseExpiresAt)
      ? input.expectedLeaseExpiresAt
      : [input.expectedLeaseExpiresAt],
  );
  await db.prepare(
    `UPDATE reminder_delivery_runs
        SET status = 'skipped', last_error_code = ?, last_error_message = ?,
            completed_at = ?, lease_expires_at = NULL, next_retry_at = NULL,
            updated_at = ?
      WHERE id = ? AND status = 'claimed' AND ${owner.sql}`,
  ).bind(input.code, input.message, input.now, input.now, input.id, ...owner.bindings).run();
}

export async function failReminderDeliveryRun(
  db: D1Database,
  input: {
    id: string;
    code: string;
    message: string;
    lineRequestId?: string | null;
    notBeforeAt?: string | null;
    retryAt: string | null;
    now: string;
    /** R340: 自分が今の持ち主のときだけ失敗にする。書けたら true。 */
    expectedLeaseExpiresAt: string | string[];
  },
): Promise<boolean> {
  const owner = ownerGateSql(
    Array.isArray(input.expectedLeaseExpiresAt)
      ? input.expectedLeaseExpiresAt
      : [input.expectedLeaseExpiresAt],
  );
  const status: ReminderDeliveryRunStatus = input.retryAt ? 'retry_wait' : 'permanent_failed';
  const recorded = await db.prepare(
    `UPDATE reminder_delivery_runs
        SET status = ?, last_error_code = ?, last_error_message = ?,
            line_request_id=COALESCE(?,line_request_id),next_retry_at = ?, lease_expires_at = NULL,
            completed_at = CASE WHEN ? = 'permanent_failed' THEN ? ELSE NULL END,
            updated_at = ?
      WHERE id = ? AND status = 'claimed' AND ${owner.sql}`,
  ).bind(
    status,
    input.code,
    input.message,
    input.lineRequestId ?? null,
    input.retryAt ?? input.notBeforeAt ?? null,
    status,
    input.now,
    input.now,
    input.id,
    ...owner.bindings,
  ).run();
  return (recorded.meta?.changes ?? 0) === 1;
}

export async function getReminderDeliveryRunById(
  db: D1Database,
  id: string,
): Promise<ReminderDeliveryRunRow | null> {
  return db.prepare(`SELECT * FROM reminder_delivery_runs WHERE id = ?`)
    .bind(id)
    .first<ReminderDeliveryRunRow>();
}

/**
 * R345: 初回に送った本文（差し込み済み）を読む。
 * まだ送っていなければ null（呼び出し側は今までどおり最新の内容で作る）。
 */
export async function getReminderDeliveryRunSentPayload(
  db: D1Database,
  runId: string,
): Promise<ReminderDeliveryRunSentPayload | null> {
  const row = await db.prepare(
    `SELECT sent_message_type, sent_message_content, sent_template_id, sent_template_version
       FROM reminder_delivery_runs WHERE id = ?`,
  ).bind(runId).first<{
    sent_message_type: string | null;
    sent_message_content: string | null;
    sent_template_id: string | null;
    sent_template_version: number | null;
  }>();
  if (!row || row.sent_message_content == null || row.sent_message_type == null) return null;
  return {
    messageType: row.sent_message_type,
    messageContent: row.sent_message_content,
    templateId: row.sent_template_id,
    templateVersion: row.sent_template_version == null ? null : Number(row.sent_template_version),
  };
}

/**
 * R345: 初回に送る本文を残し、残っている本文を返す。
 * 先に残した処理があるときはそちらを返し、上書きしない
 * （同じ実行の二重保存・別処理の上書きをしない）。
 * 貸出を失っているときは残せず null を返す（呼び出し側は作りたてを使うが、
 * 直後の検証で止まるため送らない）。
 */
export async function saveReminderDeliveryRunSentPayload(
  db: D1Database,
  input: {
    id: string;
    messageType: string;
    messageContent: string;
    templateId: string | null;
    templateVersion: number | null;
    now: string;
    /** R340: 自分が今の持ち主のときだけ残す。 */
    expectedLeaseExpiresAt: string | string[];
  },
): Promise<ReminderDeliveryRunSentPayload | null> {
  const owner = ownerGateSql(
    Array.isArray(input.expectedLeaseExpiresAt)
      ? input.expectedLeaseExpiresAt
      : [input.expectedLeaseExpiresAt],
  );
  await db.prepare(
    `UPDATE reminder_delivery_runs
        SET sent_message_type = ?, sent_message_content = ?,
            sent_template_id = ?, sent_template_version = ?, updated_at = ?
      WHERE id = ? AND sent_message_content IS NULL AND ${owner.sql}`,
  ).bind(
    input.messageType,
    input.messageContent,
    input.templateId,
    input.templateVersion,
    input.now,
    input.id,
    ...owner.bindings,
  ).run();
  return getReminderDeliveryRunSentPayload(db, input.id);
}

/** 失敗した1通を、同じ操作の二重受付を避けながら再試行待ちへ戻す。 */
export async function retryReminderDeliveryRun(
  db: D1Database,
  input: { id: string; requestKey: string; now: string },
): Promise<RetryReminderDeliveryRunResult | null> {
  let row = await getReminderDeliveryRunById(db, input.id);
  if (!row) return null;
  if ((['line_temporary_failure','delivery_failed','retry_key_expired','retry_exhausted'].includes(row.last_error_code ?? '')
    || row.last_error_code===null && (['retry_wait','permanent_failed'].includes(row.status)||row.status==='queued'&&row.attempt_count>0)) && row.sent_message_content!==null) {
    await db.prepare(`UPDATE reminder_delivery_runs SET status='permanent_failed',last_error_code='delivery_unknown',
      last_error_message='以前の送信結果を照合するまで再送しません。',next_retry_at=NULL,lease_expires_at=NULL,completed_at=?,updated_at=?
      WHERE id=? AND status IN ('queued','retry_wait','permanent_failed') AND (last_error_code IN ('line_temporary_failure','delivery_failed','retry_key_expired','retry_exhausted')
        OR (last_error_code IS NULL AND (status IN ('retry_wait','permanent_failed') OR (status='queued' AND attempt_count>0))))`)
      .bind(input.now,input.now,row.id).run();
    row=(await getReminderDeliveryRunById(db,input.id))!;
  }
  if (['delivery_started','delivery_unknown','retry_after_exceeds_budget'].includes(row.last_error_code ?? '')) return {kind:'conflict',run:row};
  if (row.next_retry_at && Date.parse(row.next_retry_at)>Date.parse(input.now))return {kind:'conflict',run:row};
  if (row.manual_retry_key === input.requestKey) return { kind: 'replay', run: row };

  const enrollment = await db.prepare(
    `SELECT status FROM friend_reminders WHERE id = ?`,
  ).bind(row.friend_reminder_id).first<{ status: string }>();
  // 利用者が取り消した登録は、失敗履歴から再開させない。
  if (!enrollment || enrollment.status === 'cancelled') return { kind: 'conflict', run: row };

  const sameKey = await db.prepare(
    `SELECT id FROM reminder_delivery_runs WHERE manual_retry_key = ?`,
  ).bind(input.requestKey).first<{ id: string }>();
  if (sameKey && sameKey.id !== row.id) return { kind: 'conflict', run: row };
  if (!['retry_wait', 'permanent_failed'].includes(row.status)) {
    return { kind: 'conflict', run: row };
  }

  // R342: 手動再試行でも同じ通知には同じ X-Line-Retry-Key を使う。
  // 受理ずみの通知を別キーで送り直すと重複する。同じキーなら LINE 側が
  // 受理ずみを 409 で返し、元の受理IDで履歴を回復できる (R343)。
  const [changed] = await db.batch([
    db.prepare(
      `UPDATE reminder_delivery_runs
          SET status = 'queued', retry_cycle_attempt_count = 0,
              next_retry_at = NULL, lease_expires_at = NULL,
              completed_at = NULL, manual_retry_key = ?,
              updated_at = ?
        WHERE id = ? AND status IN ('retry_wait', 'permanent_failed')
          AND COALESCE(last_error_code,'') NOT IN ('delivery_started','delivery_unknown','retry_after_exceeds_budget')
          AND (next_retry_at IS NULL OR julianday(next_retry_at)<=julianday(?))`,
    ).bind(input.requestKey, input.now, row.id, input.now),
    // permanent_failed で全通が終端になった登録は completed になる。
    // 手動再試行をcronが拾えるよう、この1件だけ同じbatchでactiveへ戻す。
    db.prepare(
      `UPDATE friend_reminders
          SET status = 'active', updated_at = ?
        WHERE id = ? AND status = 'completed' AND changes()=1`,
    ).bind(input.now, row.friend_reminder_id),
  ]);
  if ((changed.meta?.changes ?? 0) !== 1) {
    return { kind: 'conflict', run: (await getReminderDeliveryRunById(db, row.id)) ?? row };
  }
  const updated = await getReminderDeliveryRunById(db, row.id);
  return updated ? { kind: 'scheduled', run: updated } : null;
}
