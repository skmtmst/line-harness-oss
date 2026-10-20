import { type ReminderDeliveryRunRow } from './types.js';
import { activeRuleGateSql, bookingPolicyGateSql, ownerGateSql } from './delivery-gates.js';


/**
 * 1通ぶんの実行行を作り、同時実行のうち1つだけが送信を担当する。
 *
 * LINEへ送る前に行と再送キーを固定する。通信後にWorkerが落ちても、次のcronは
 * 送信開始済みなら結果照合まで止め、未実行と確認できた失敗だけ再試行する。
 */
export async function claimReminderDeliveryRun(
  db: D1Database,
  input: {
    lineAccountId: string | null;
    reminderId: string;
    friendReminderId: string;
    friendId: string;
    reminderStepId: string;
    scheduledAt: string;
    now: string;
    leaseExpiresAt: string;
    /**
     * R339: 候補読込後に日時変更が入っても古い基準日で実行行を作らない。
     * 呼び出し側が直前に読み直した target_date を渡し、一致するときだけ
     * 握る。未指定なら従来どおり起点を問わない。
     */
    expectedTargetDate?: string | null;
  },
): Promise<ReminderDeliveryRunRow | null> {
  const id = crypto.randomUUID();
  const idempotencyKey = crypto.randomUUID();
  const lineRetryKey = crypto.randomUUID();
  await db.prepare(
    `INSERT OR IGNORE INTO reminder_delivery_runs
       (id, line_account_id, reminder_id, friend_reminder_id, friend_id,
        reminder_step_id, scheduled_at, idempotency_key, line_retry_key,
        status, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'queued', ?, ?)`,
  ).bind(
    id,
    input.lineAccountId,
    input.reminderId,
    input.friendReminderId,
    input.friendId,
    input.reminderStepId,
    input.scheduledAt,
    idempotencyKey,
    lineRetryKey,
    input.now,
    input.now,
  ).run();

  const row = await db.prepare(
    `SELECT * FROM reminder_delivery_runs
      WHERE friend_reminder_id = ? AND reminder_step_id = ? AND scheduled_at = ?`,
  ).bind(input.friendReminderId, input.reminderStepId, input.scheduledAt)
    .first<ReminderDeliveryRunRow>();
  if (!row) return null;

  // Reclaiming a lease cannot establish that a physical send never happened.
  // Keep the original run/key and hold it for reconciliation instead of sending.
  await db.prepare(`UPDATE reminder_delivery_runs SET status='permanent_failed',
    last_error_code='delivery_unknown',last_error_message='送信結果の照合が必要です。自動では再送しません。',
    lease_expires_at=NULL,next_retry_at=NULL,completed_at=?,updated_at=?
    WHERE id=? AND status='claimed' AND lease_expires_at<=? AND (last_error_code='delivery_started' OR sent_message_content IS NOT NULL)`)
    .bind(input.now,input.now,row.id,input.now).run();

  // 登録・基準日変更・再開より前に過ぎた通は、遡って送らず記録を残す。
  // cron の遅れや、すでに送信を試みた通の再試行とは区別する。
  await db.prepare(
    `UPDATE reminder_delivery_runs
        SET status = 'skipped', last_error_code = 'scheduled_before_enrollment',
            last_error_message = '登録・変更時点で予定の時刻を過ぎていたため送信しませんでした',
            completed_at = ?, updated_at = ?
      WHERE id = ? AND status = 'queued' AND attempt_count = 0
        AND EXISTS (SELECT 1 FROM friend_reminders fr
          WHERE fr.id = friend_reminder_id
            AND julianday(reminder_delivery_runs.scheduled_at) < julianday(CASE
              WHEN fr.updated_at GLOB '*Z' OR fr.updated_at GLOB '*[+-]??:??' THEN fr.updated_at
              ELSE fr.updated_at || '+09:00' END))`,
  ).bind(input.now, input.now, row.id).run();

  // 取消と取得の競合対策: 登録が active のままのときだけ握る (原子的)。
  // getPending (active 読み) から claim の間に取消が入っても、ここで弾く。
  // R338/R339: 予約の通知方針 OFF とルール停止もここで読み直す。
  // 日時変更で起点がずれた登録は、読み直した起点と合うときだけ握る。
  const targetBindings: unknown[] = [];
  const targetGate = input.expectedTargetDate != null
    ? `AND fr.target_date = ?`
    : '';
  if (input.expectedTargetDate != null) targetBindings.push(input.expectedTargetDate);
  const claimed = await db.prepare(
    `UPDATE reminder_delivery_runs
        SET status = 'claimed',
            attempt_count = attempt_count + 1,
            retry_cycle_attempt_count = retry_cycle_attempt_count + 1,
            started_at = COALESCE(started_at, ?),
            lease_expires_at = ?,
            next_retry_at = NULL,
            updated_at = ?
      WHERE id = ?
        AND scheduled_at <= ?
        AND EXISTS (
          SELECT 1 FROM friend_reminders fr
           WHERE fr.id = ? AND fr.status = 'active'
             ${targetGate}
             AND ${activeRuleGateSql()}
             AND ${bookingPolicyGateSql()}
        )
        AND (
          status = 'queued'
          OR (status = 'retry_wait' AND next_retry_at IS NOT NULL AND next_retry_at <= ?)
          OR (status = 'claimed' AND lease_expires_at IS NOT NULL AND lease_expires_at <= ?)
        )`,
  ).bind(
    input.now,
    input.leaseExpiresAt,
    input.now,
    row.id,
    input.now,
    input.friendReminderId,
    ...targetBindings,
    input.now,
    input.now,
  ).run();
  if ((claimed.meta?.changes ?? 0) !== 1) {
    // 握れなかった行のうち、登録がもう active でないものは二度と送れない。
    // ここで止めておく (集計の「予定」に残さない)。時刻前・貸出中の行は触らない。
    await db.prepare(
      `UPDATE reminder_delivery_runs
          SET status = 'cancelled', completed_at = ?,
              lease_expires_at = NULL, next_retry_at = NULL, updated_at = ?
        WHERE id = ?
          AND status IN ('queued', 'retry_wait', 'claimed')
          AND NOT EXISTS (SELECT 1 FROM friend_reminders WHERE id = ? AND status = 'active')`,
    ).bind(input.now, input.now, row.id, input.friendReminderId).run();
    return null;
  }

  return db.prepare(`SELECT * FROM reminder_delivery_runs WHERE id = ?`)
    .bind(row.id)
    .first<ReminderDeliveryRunRow>();
}

/**
 * 緊急停止のために握ったまま送らなかった claim をキューへ戻す (#1050)。
 *
 * claim で進めた attempt 系のカウンタを差し戻し、status を queued へ戻す。
 * 自分が握った claimed 行だけが対象で、取消や別実行の確定は上書きしない。
 * 停止中に送られなかった分は「失敗」ではないため、再試行回数を消費させない。
 */
export async function releaseClaimedReminderRun(
  db: D1Database,
  input: { id: string; now: string; expectedLeaseExpiresAt: string | string[] },
): Promise<void> {
  // R340: 自分が握った claimed 行だけキューへ戻す。
  const owner = ownerGateSql(
    Array.isArray(input.expectedLeaseExpiresAt)
      ? input.expectedLeaseExpiresAt
      : [input.expectedLeaseExpiresAt],
  );
  await db
    .prepare(
      `UPDATE reminder_delivery_runs
          SET status = 'queued',
              attempt_count = MAX(0, attempt_count - 1),
              retry_cycle_attempt_count = MAX(0, retry_cycle_attempt_count - 1),
              lease_expires_at = NULL,
              next_retry_at = NULL,
              updated_at = ?
        WHERE id = ? AND status = 'claimed' AND ${owner.sql}`,
    )
    .bind(input.now, input.id, ...owner.bindings)
    .run();
}

/**
 * 外部送信の直前に送る権利を確かめる (原子的)。
 *
 * claim 後・push 前のわずかな間に取消が入る競合がある。送る直前に1文で
 * 「まだ claimed かつ登録が active」を確かめ、貸出期限を延ばす。
 * だめなら実行行を止めて false を返す (送らない)。
 * 取消側が先に実行行を止めていた場合も false になる (二重に送らない)。
 *
 * R338/R339: 予約の通知方針 OFF・ルール停止・起点ずれもここで読み直す。
 * R340: 自分が今の持ち主のときだけ通す。期限切れの古い処理の検証は
 * 0 件になり、新しい処理の期限を縮めない。持ち主でないときは行に
 * 触らず false を返す (別処理の claim を殺さない)。
 */
export async function verifyClaimedRunBeforeSend(
  db: D1Database,
  input: {
    id: string;
    friendReminderId: string;
    now: string;
    leaseExpiresAt: string;
    expectedLeaseExpiresAt: string | string[];
    expectedTargetDate?: string | null;
  },
): Promise<boolean> {
  const owner = ownerGateSql(
    Array.isArray(input.expectedLeaseExpiresAt)
      ? input.expectedLeaseExpiresAt
      : [input.expectedLeaseExpiresAt],
  );
  const targetGate = input.expectedTargetDate != null ? `AND fr.target_date = ?` : '';
  const targetBindings = input.expectedTargetDate != null ? [input.expectedTargetDate] : [];
  const verified = await db.prepare(
    `UPDATE reminder_delivery_runs
        SET lease_expires_at = ?, updated_at = ?
      WHERE id = ?
        AND status = 'claimed'
        AND ${owner.sql}
        AND EXISTS (
          SELECT 1 FROM friend_reminders fr
           WHERE fr.id = ? AND fr.status = 'active'
             ${targetGate}
             AND ${activeRuleGateSql()}
             AND ${bookingPolicyGateSql()}
        )`,
  ).bind(
    input.leaseExpiresAt, input.now, input.id, ...owner.bindings,
    input.friendReminderId, ...targetBindings,
  ).run();
  if ((verified.meta?.changes ?? 0) === 1) return true;
  // 持ち主が別処理へ移っているときは行に触らない。
  // 自分の貸出のまま通らなかったときだけ止める (従来の取消回収)。
  const mine = await db.prepare(
    `SELECT 1 AS ok FROM reminder_delivery_runs WHERE id = ? AND ${owner.sql}`,
  ).bind(input.id, ...owner.bindings).first<{ ok: number }>();
  if (!mine) return false;
  await db.prepare(
    `UPDATE reminder_delivery_runs
        SET status = 'cancelled', completed_at = ?,
            lease_expires_at = NULL, next_retry_at = NULL, updated_at = ?
      WHERE id = ?
        AND status IN ('queued', 'retry_wait', 'claimed') AND ${owner.sql}`,
  ).bind(input.now, input.now, input.id, ...owner.bindings).run();
  return false;
}
