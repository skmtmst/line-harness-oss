// Cron handler: send due booking reminders.
// Joined with bookings/menus/staff/line_accounts/friends for everything
// the notification text renderer needs in one query.

import type { BookingNotificationSender, NotificationKind } from './booking-notifier.js';
import { formatStartsAtForStore, notificationTiming } from './booking-notifier.js';
import { REMINDER_MAX_RETRY } from './booking-types.js';
import {
  activeTenantLineAccountSql,
  isOperationCapabilityStopped,
  resolveLineCredential,
} from '@line-crm/db';
import { stoppedTenantLineAccountSql } from './tenant-runtime-status.js';
import { featureJobCanRun } from './feature-enforcement.js';

interface DueRow {
  id: string;
  booking_id: string;
  line_account_id: string;
  kind: 'day_before' | 'hours_before';
  retry_count: number;
  starts_at: string;
  menu_name: string;
  staff_name: string;
  channel_access_token: string;
  channel_access_token_encrypted: string | null;
  line_user_id: string;
  /** 店舗のタイムゾーン。文面の日時と「本日/明日」の判定に使う。 */
  timezone: string | null;
}

export interface ProcessRemindersParams {
  now: Date;
  sender: BookingNotificationSender;
}

/**
 * R330: 送信権の貸出期限（分）。claim 時に sent_at を刻み、期限内の行は
 * 別 cron が拾わない。処理中に止まった worker の行は期限切れで回収する。
 * 期限の起点は「貸出開始」のため、成功時は送信完了時刻で上書きし、
 * 失敗時は NULL に戻して次回すぐに拾えるようにする。
 */
const REMINDER_CLAIM_LEASE_MINUTES = 10;

function claimCutoffIso(now: Date): string {
  return new Date(now.getTime() - REMINDER_CLAIM_LEASE_MINUTES * 60_000).toISOString();
}

export async function processDueReminders(
  db: D1Database,
  params: ProcessRemindersParams,
): Promise<{ sent: number; failed: number }> {
  // Stop due rows before selection. `cancelled` is terminal but is neither a
  // delivery success nor failure, so restoring a tenant never emits an
  // overdue reminder burst.
  await db.prepare(
    `UPDATE booking_reminders
        SET status = 'cancelled', last_error = 'tenant_suspended'
      WHERE status IN ('pending','failed')
        AND scheduled_at <= ?
        AND EXISTS (
          SELECT 1 FROM bookings stopped_booking
           WHERE stopped_booking.id = booking_reminders.booking_id
             AND ${stoppedTenantLineAccountSql('stopped_booking.line_account_id')}
        )`,
  ).bind(params.now.toISOString()).run();
  // status は 'pending' に加え 'failed'（一時エラーで失敗、retry 残あり）も拾う。
  // 'failed_permanent' / 'sent' / 'cancelled' は再送対象外。
  const due = await db
    .prepare(
      `SELECT r.id, r.booking_id, r.kind, r.retry_count,
              b.line_account_id, b.starts_at,
              m.name AS menu_name,
              s.display_name AS staff_name,
              la.channel_access_token,
              la.channel_access_token_encrypted,
              f.line_user_id,
              bs.timezone
         FROM booking_reminders r
         INNER JOIN bookings b ON b.id = r.booking_id
         INNER JOIN menus m ON m.id = b.menu_id
         INNER JOIN staff s ON s.id = b.staff_id
         INNER JOIN line_accounts la ON la.id = b.line_account_id
         INNER JOIN friends f ON f.id = b.friend_id
          LEFT JOIN booking_settings bs ON bs.line_account_id = b.line_account_id
        WHERE r.status IN ('pending','failed')
          AND r.scheduled_at <= ?
          AND b.status = 'confirmed'
          AND b.starts_at > ?       -- 開始時刻を過ぎた予約のリマインダは送らない
          AND (r.sent_at IS NULL OR r.sent_at < ?)  -- R330: 貸出中の行は拾わない
          AND ${activeTenantLineAccountSql('b.line_account_id')}
        LIMIT 100`,
    )
    .bind(params.now.toISOString(), params.now.toISOString(), claimCutoffIso(params.now))
    .all<DueRow>();

  let sent = 0;
  let failed = 0;
  for (const row of due.results) {
    const kind: NotificationKind = row.kind;
    // 機能オフ中は送らずpendingのまま残す。再オンで再開する。
    if (row.line_account_id && !await featureJobCanRun(db, { accountId: row.line_account_id, featureId: 'booking', job: 'booking reminders' })) {
      continue;
    }
    // 緊急停止 (#1050): reminder_dispatch が止まっている統括は claim せず
    // pending のまま残す。復旧すれば次の cron が拾う。
    if (await isOperationCapabilityStopped(db, row.line_account_id, 'reminder_dispatch')) {
      continue;
    }
    // 読み出し時点の試行回数。fence の CAS はこの値を epoch に使い、失敗記録も
    // これを基準にする (claim 後に row を読み直さない)。
    // catch へ来るのは自分が失敗したときだけ。握れなかった行は continue で
    // 抜けるので catch を通らない。よって fence の前で投げた場合 (資格情報が
    // 復号できない等) も1回ぶん数える: 数えないと retry_count が伸びず、上限で
    // failed_permanent へ打ち切れないまま failed で滞留する (due の SELECT は
    // LIMIT 100 で ORDER BY が無く、滞留行が正常なリマインダを押し出す)。
    const priorRetry = row.retry_count;
    const attemptedRetry = priorRetry + 1;
    try {
      // 送信の準備 (資格情報の復号) は fence の前に済ませる。fence と外部
      // 送信の間に待つ処理を挟まない (V6 の verifyClaimedRunBeforeSend と
      // 同じ形。窓を SQL 1文ぶんに詰める)。
      const accessToken = await resolveLineCredential(
        row.channel_access_token_encrypted,
        row.channel_access_token,
        { lineAccountId: row.line_account_id, field: 'channel_access_token' },
      );
      // 取消と送信の直列化 (原子的)。上の SELECT の b.status='confirmed' は
      // 読み出し時にしか効かず、100件ループの全区間で取消を素通りさせる。
      // 送る直前に1文で「まだ未送信」と「予約がまだ confirmed」と
      // 「今の種別が通知方針で有効」を確かめ、同時に送信権を握る
      // (retry_count を claim epoch に、sent_at を貸出印に使う)。
      // 取消・方針OFFが先なら 0 件になり送らない。0 件は別 cron が担当
      // した場合も同じなので、どちらでもこの実行は手を引く。
      // R331: 方針の判定は保存ずみの snapshot を読む。未保存の旧予約
      // (NULL/'{}') は従来どおり送る側に倒す (route 側の既定値と同じ)。
      const claim = await db
        .prepare(
          `UPDATE booking_reminders
              SET retry_count = retry_count + 1, sent_at = ?
            WHERE id = ? AND retry_count = ? AND status IN ('pending','failed')
              AND (sent_at IS NULL OR sent_at < ?)
              AND EXISTS (
                SELECT 1 FROM bookings b
                 WHERE b.id = booking_reminders.booking_id AND b.status = 'confirmed'
                   AND ${activeTenantLineAccountSql('b.line_account_id')}
                   AND CASE booking_reminders.kind
                         WHEN 'day_before'
                         THEN json_extract(b.notification_policy_snapshot, '$.day_before')
                         ELSE json_extract(b.notification_policy_snapshot, '$.hours_before')
                       END IS NOT 0)`,
        )
        .bind(params.now.toISOString(), row.id, priorRetry, claimCutoffIso(params.now))
        .run();
      if ((claim.meta?.changes ?? 0) === 0) continue;

      // claim と送信の間に緊急停止へ切り替わった分は、握った retry_count を
      // 差し戻して pending のまま残す (#1050)。停止を失敗として数えない。
      // 貸出印も消し、次回すぐに拾えるようにする。
      if (await isOperationCapabilityStopped(db, row.line_account_id, 'reminder_dispatch')) {
        await db
          .prepare(
            `UPDATE booking_reminders SET retry_count = retry_count - 1, sent_at = NULL
              WHERE id = ? AND retry_count = ? AND status IN ('pending','failed')`,
          )
          .bind(row.id, attemptedRetry)
          .run();
        continue;
      }

      // 文面の日時は店舗の時間帯で書き (R332)、「本日/明日」と残り時間は
      // 送信時点の実測から組み立てる (R333)。予約の瞬間 (starts_at) や
      // 通知予定自体は変えない。
      const timeZone = row.timezone ?? 'Asia/Tokyo';
      const timing = notificationTiming(row.starts_at, timeZone, params.now);
      await params.sender({
        channelAccessToken: accessToken,
        toLineUserId: row.line_user_id,
        kind,
        ctx: {
          menuName: row.menu_name,
          staffName: row.staff_name,
          startsAt: formatStartsAtForStore(row.starts_at, timeZone),
          ...timing,
        },
        // R323 と同じ考え方: 同じ貸出の再送は安定キーで行い、
        // LINE 側の到達ずみ再送は冪等に吸収する。
        retryKey: `booking-reminder:${row.id}:${attemptedRetry}`,
      });
      // R331: 書込時も「まだ未送信」を確かめる。貸出中に取消・方針OFFで
      // 行が止まっていたら 0 件になり、取消ずみを復活させない。
      const completed = await db
        .prepare(
          `UPDATE booking_reminders SET status='sent', sent_at = ?
            WHERE id = ? AND status IN ('pending','failed')`,
        )
        .bind(params.now.toISOString(), row.id)
        .run();
      if ((completed.meta?.changes ?? 0) > 0) sent++;
    } catch (e) {
      // fence で握れていれば DB 上も同じ値まで進んでいる (二重に数えない)。
      // R331: ここでも取消ずみの行は触らない。貸出印は消して次回に備える。
      const newStatus = attemptedRetry >= REMINDER_MAX_RETRY ? 'failed_permanent' : 'failed';
      const recorded = await db
        .prepare(
          `UPDATE booking_reminders
              SET status = ?, retry_count = ?, last_error = ?, sent_at = NULL
            WHERE id = ? AND status IN ('pending','failed')`,
        )
        .bind(newStatus, attemptedRetry, e instanceof Error ? e.message : String(e), row.id)
        .run();
      if ((recorded.meta?.changes ?? 0) > 0) failed++;
    }
  }
  return { sent, failed };
}
