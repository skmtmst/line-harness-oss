import { jstNow } from '../utils.js';
import { getPlatformSetting, setPlatformSetting } from '../platform-announcements.js';
import { accountFeatureOffExclusionSql } from '../account-settings.js';
import { type FriendReminderRow, type ReminderStepRow } from './types.js';



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
// リマインダ実行記録（269）
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
  await db.prepare(`UPDATE reminder_delivery_runs SET status='permanent_failed',last_error_code='delivery_unknown',
    last_error_message='以前の送信結果を照合するまで再送しません。',next_retry_at=NULL,lease_expires_at=NULL,completed_at=?,updated_at=?
    WHERE status IN ('queued','retry_wait','permanent_failed')
      AND (last_error_code IN ('line_temporary_failure','delivery_failed','retry_key_expired','retry_exhausted')
        OR (last_error_code IS NULL AND (status IN ('retry_wait','permanent_failed') OR (status='queued' AND attempt_count>0))))
      AND sent_message_content IS NOT NULL`).bind(input.now,input.now).run();
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
