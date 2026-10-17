import { jstNow } from './utils.js';
import { getPlatformSetting, setPlatformSetting } from './platform-announcements.js';
import { accountFeatureOffExclusionSql } from './account-settings.js';
import { type FriendReminderRow, type ReminderStepRow, type ReminderDeliveryRunRow, type ReminderDeliveryRunStatus, type ReminderDeliveryRunSentPayload, type RetryReminderDeliveryRunResult } from './reminders-types.js';


/** リマインダ配信処理用: 配信が必要な友だちリマインダを取得 */
/**
 * まだ配信していない通を、登録ごとに返す。
 *
 * **「配信時刻が来たか」はここでは見ない。** 時刻の決め方（153 の配信方式）は
 * 日本時間の暦の計算が要り、そのための部品は packages/shared にある。
 * db パッケージは shared に依存していないので、絞り込みは呼び出し側で行う。
 *
 * 以前はここで `target_date + offset_minutes` を計算していたが、方式が
 * 2つになった時点で、この場所では決められなくなった。
 */
export async function getPendingReminderDeliveries(
  db: D1Database,
): Promise<Array<FriendReminderRow & {
  delivery_mode: string;
  line_account_id: string | null;
  version_settings_snapshot: string | null;
  steps: ReminderStepRow[];
}>> {
  // 同じ公開版を人数分読み直さない。500人ずつIDで巡回し、失敗した読込は
  // カーソルを進めず再試行する。未来の通知も準備する契約は保つ。
  const cursorKey = 'reminder_delivery_scan_cursor';
  const cursor = await getPlatformSetting(db, cursorKey) ?? '';
  const pageSize = 500;
  const activeReminders = (await db.prepare(`SELECT fr.*,
    COALESCE(fr.reminder_version_id,r.current_published_version_id) AS effective_version_id,
    COALESCE(json_extract(rv.settings_snapshot,'$.deliveryMode'),r.delivery_mode) AS delivery_mode,
    COALESCE(json_extract(rv.settings_snapshot,'$.lineAccountId'),r.line_account_id) AS line_account_id,
    rv.settings_snapshot AS version_settings_snapshot
    FROM friend_reminders fr JOIN reminders r ON r.id=fr.reminder_id
    LEFT JOIN reminder_versions rv ON rv.id=COALESCE(fr.reminder_version_id,r.current_published_version_id)
    WHERE fr.status='active' AND r.is_active=1 AND r.deleted_at IS NULL AND fr.id>?
      AND NOT ${accountFeatureOffExclusionSql('r.line_account_id', 'reminders')}
    ORDER BY fr.id LIMIT ?`).bind(cursor,pageSize).all<FriendReminderRow & {
      effective_version_id: string | null; delivery_mode: string; line_account_id: string | null;
      version_settings_snapshot: string | null;
    }>()).results;
  const results: Array<FriendReminderRow & {
    delivery_mode: string; line_account_id: string | null; version_settings_snapshot: string | null;
    steps: ReminderStepRow[];
  }> = [];
  if (activeReminders.length) {
    const versionIds=[...new Set(activeReminders.flatMap(fr=>fr.effective_version_id?[fr.effective_version_id]:[]))];
    const legacyIds=[...new Set(activeReminders.filter(fr=>!fr.effective_version_id).map(fr=>fr.reminder_id))];
    const steps=(await db.prepare(`SELECT 'version:'||rvs.reminder_version_id AS scan_key,
      rvs.stable_step_id AS id,rv.reminder_id,rvs.offset_minutes,rvs.message_type,rvs.message_content,
      rvs.created_at,rvs.offset_days,rvs.send_at_time,rvs.template_id,rvs.position AS sort_order
      FROM reminder_version_steps rvs JOIN reminder_versions rv ON rv.id=rvs.reminder_version_id
      WHERE rvs.reminder_version_id IN (SELECT value FROM json_each(?))
      UNION ALL SELECT 'legacy:'||reminder_id,id,reminder_id,offset_minutes,message_type,message_content,
      created_at,offset_days,send_at_time,template_id,offset_minutes AS sort_order
      FROM reminder_steps WHERE reminder_id IN (SELECT value FROM json_each(?))
      ORDER BY scan_key,sort_order,id`).bind(JSON.stringify(versionIds),JSON.stringify(legacyIds))
      .all<ReminderStepRow & {scan_key:string;sort_order:number}>()).results;
    const delivered=(await db.prepare(`SELECT friend_reminder_id,reminder_step_id FROM friend_reminder_deliveries
      WHERE friend_reminder_id IN (SELECT value FROM json_each(?))`).bind(JSON.stringify(activeReminders.map(fr=>fr.id)))
      .all<{friend_reminder_id:string;reminder_step_id:string}>()).results;
    const byVersion=new Map<string,ReminderStepRow[]>();
    for(const {scan_key,sort_order,...step} of steps) {
      const group=byVersion.get(scan_key)??[];group.push(step);byVersion.set(scan_key,group);
    }
    const deliveredByEnrollment=new Map<string,Set<string>>();
    for(const row of delivered) {
      const group=deliveredByEnrollment.get(row.friend_reminder_id)??new Set<string>();
      group.add(row.reminder_step_id);deliveredByEnrollment.set(row.friend_reminder_id,group);
    }
    for(const {effective_version_id,...fr} of activeReminders) {
      const key=effective_version_id?'version:'+effective_version_id:'legacy:'+fr.reminder_id;
      const pending=(byVersion.get(key)??[]).filter(step=>!deliveredByEnrollment.get(fr.id)?.has(step.id));
      if(pending.length)results.push({...fr,steps:pending});
    }
  }
  await setPlatformSetting(db,cursorKey,activeReminders.length===pageSize?activeReminders.at(-1)!.id:null,'reminder-delivery');
  return results;
}

/** 配信済みを記録 */
export async function markReminderStepDelivered(db: D1Database, friendReminderId: string, reminderStepId: string): Promise<void> {
  const id = crypto.randomUUID();
  await db.prepare(`INSERT OR IGNORE INTO friend_reminder_deliveries (id, friend_reminder_id, reminder_step_id) VALUES (?, ?, ?)`)
    .bind(id, friendReminderId, reminderStepId).run();
}

/**
 * 全ステップ配信済みならcompletedにする。
 *
 * R337: 完了の判定は「今の通知予定が全部済んだ時だけ」。日時変更で古い
 * 実行行が cancelled になり新しい queued 行が積まれた状態では、旧行を
 * 完了数に含めない。未送信の将来予定 (queued/retry_wait/claimed) が
 * 1通でもあれば active を保持する。
 */
export async function completeReminderIfDone(db: D1Database, friendReminderId: string, reminderId: string): Promise<void> {
  const enrollment = await db.prepare(
    `SELECT reminder_version_id FROM friend_reminders WHERE id = ? AND reminder_id = ?`,
  ).bind(friendReminderId, reminderId).first<{ reminder_version_id: string | null }>();
  const totalSteps = enrollment?.reminder_version_id
    ? await db.prepare(`SELECT COUNT(*) as count FROM reminder_version_steps WHERE reminder_version_id = ?`)
        .bind(enrollment.reminder_version_id).first<{ count: number }>()
    : await db.prepare(`SELECT COUNT(*) as count FROM reminder_steps WHERE reminder_id = ?`)
        .bind(reminderId).first<{ count: number }>();
  const deliveredSteps = await db.prepare(
    `SELECT COUNT(DISTINCT reminder_step_id) AS count
       FROM (
         SELECT reminder_step_id
           FROM friend_reminder_deliveries
          WHERE friend_reminder_id = ?
         UNION
         SELECT reminder_step_id
           FROM reminder_delivery_runs
          WHERE friend_reminder_id = ?
            AND status IN ('succeeded', 'skipped', 'permanent_failed', 'cancelled')
       )`,
  ).bind(friendReminderId, friendReminderId).first<{ count: number }>();
  const pendingSteps = await db.prepare(
    `SELECT COUNT(DISTINCT reminder_step_id) AS count
       FROM reminder_delivery_runs
      WHERE friend_reminder_id = ?
        AND status IN ('queued', 'retry_wait', 'claimed')`,
  ).bind(friendReminderId).first<{ count: number }>();

  if (totalSteps && deliveredSteps
    && deliveredSteps.count >= totalSteps.count
    && Number(pendingSteps?.count ?? 0) === 0) {
    const now = jstNow();
    // 取消ずみの登録を完了で上書きしない (取消と cron の競合対策)。
    await db.prepare(
      `UPDATE friend_reminders
          SET status = 'completed', completed_at = ?, updated_at = ?
        WHERE id = ? AND status = 'active'`,
    ).bind(now, now, friendReminderId).run();
  }
}

// =============================================================================
// V6 リマインダ実行記録（269）
// =============================================================================

/**
 * R344: LINE 再試行キーの有効期限 (24時間。公式仕様による)。
 * 最初の外部要求からこの時間を過ぎた結果不明の通知は、自動で再送しない。
 */
export const LINE_RETRY_KEY_VALIDITY_MS = 24 * 60 * 60 * 1000;

/**
 * R344: 有効期限を過ぎた結果不明の通知を自動送信から外す。
 *
 * 受理ずみか未送信か分からないまま 24 時間を超えた retry_wait 行は、
 * 再試行予定を止めて要確認として残す (last_error に理由を残し、一覧に
 * 出る)。人が確かめた手動再試行は別操作として送れる。
 * 戻り値は止めた件数。
 */
export async function holdExpiredLineRetryRuns(
  db: D1Database,
  input: { now: string },
): Promise<number> {
  const cutoff = new Date(new Date(input.now).getTime() - LINE_RETRY_KEY_VALIDITY_MS).toISOString();
  const held = await db.prepare(
    `UPDATE reminder_delivery_runs
        SET next_retry_at = NULL,
            last_error_code = 'retry_key_expired',
            last_error_message = 'LINEの重複防止期限（24時間）を過ぎたため自動送信を止めました。内容を確かめて手動で再試行してください。',
            updated_at = ?
      WHERE status = 'retry_wait'
        AND next_retry_at IS NOT NULL
        AND started_at IS NOT NULL
        AND started_at <= ?`,
  ).bind(input.now, cutoff).run();
  return Number(held.meta?.changes ?? 0);
}

/**
 * 送信直前の照合で使う登録の現在値。候補読込後の日時変更・ルール停止を
 * 実行行作成・claim・送信の各境界で見直す (R339)。
 */
export async function getFriendReminderSendGate(
  db: D1Database,
  friendReminderId: string,
): Promise<{ status: string; targetDate: string } | null> {
  return db.prepare(
    `SELECT status, target_date AS targetDate FROM friend_reminders WHERE id = ?`,
  ).bind(friendReminderId).first<{ status: string; targetDate: string }>();
}

/**
 * R338: 予約に紐づく登録は、予約の通知方針が両方 OFF なら送らない。
 *
 * 予約変更 PATCH が方針を OFF にしても、送信権取得ずみの登録は active の
 * まま残る。最終送信の claim・検証で現在の方針を読み直し、止める。
 * 紐づく予約行が無い旧データは従来どおり送る側に倒す (route 側の既定値)。
 */
export function bookingPolicyGateSql(): string {
  return `(
    fr.source_kind IS NULL OR fr.source_kind != 'booking'
    OR NOT EXISTS (
      SELECT 1 FROM bookings b
       WHERE (b.id = fr.source_id OR b.id = fr.source_event_id)
         AND json_extract(b.notification_policy_snapshot, '$.day_before') IS 0
         AND json_extract(b.notification_policy_snapshot, '$.hours_before') IS 0
    )
  )`;
}

/**
 * R339: 候補読込後にルールが止まっても古い候補のまま送らない。
 * 一覧の読込条件 (getPendingReminderDeliveries) と同じ述語。
 */
export function activeRuleGateSql(): string {
  return `EXISTS (
    SELECT 1 FROM reminders r
     WHERE r.id = fr.reminder_id AND r.is_active = 1 AND r.deleted_at IS NULL
  )`;
}

/**
 * R340: 持ち主付きの貸出述語。lease_expires_at を貸出ごとの識別子として
 * 使い、検証・完了・失敗・解放は自分が今の持ち主のときだけ通す。
 * 期限切れの古い処理の書込は 0 件になり、新しい処理を上書きしない。
 */
export function ownerGateSql(leases: Array<string | null | undefined>): { sql: string; bindings: unknown[] } {
  const owned = leases.filter((lease): lease is string => lease != null);
  if (owned.length === 0) return { sql: '1 = 0', bindings: [] };
  return {
    sql: `lease_expires_at IN (${owned.map(() => '?').join(',')})`,
    bindings: owned,
  };
}

/**
 * 1通ぶんの実行行を作り、同時実行のうち1つだけが送信を担当する。
 *
 * LINEへ送る前に行と再送キーを固定する。通信後にWorkerが落ちても、次のcronは
 * 同じ X-Line-Retry-Key で再試行できるため、二重送信を避けられる。
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
            next_retry_at = ?, lease_expires_at = NULL,
            completed_at = CASE WHEN ? = 'permanent_failed' THEN ? ELSE NULL END,
            updated_at = ?
      WHERE id = ? AND status = 'claimed' AND ${owner.sql}`,
  ).bind(
    status,
    input.code,
    input.message,
    input.retryAt,
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
  const row = await getReminderDeliveryRunById(db, input.id);
  if (!row) return null;
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
        WHERE id = ? AND status IN ('retry_wait', 'permanent_failed')`,
    ).bind(input.requestKey, input.now, row.id),
    // permanent_failed で全通が終端になった登録は completed になる。
    // 手動再試行をcronが拾えるよう、この1件だけ同じbatchでactiveへ戻す。
    db.prepare(
      `UPDATE friend_reminders
          SET status = 'active', updated_at = ?
        WHERE id = ? AND status = 'completed'`,
    ).bind(input.now, row.friend_reminder_id),
  ]);
  if ((changed.meta?.changes ?? 0) !== 1) {
    return { kind: 'conflict', run: (await getReminderDeliveryRunById(db, row.id)) ?? row };
  }
  const updated = await getReminderDeliveryRunById(db, row.id);
  return updated ? { kind: 'scheduled', run: updated } : null;
}
