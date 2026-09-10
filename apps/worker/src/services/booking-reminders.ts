// Cron handler: send due booking reminders.
// Joined with bookings/menus/staff/line_accounts/friends for everything
// the notification text renderer needs in one query.

import type { BookingNotificationSender, NotificationKind } from './booking-notifier.js';
import { REMINDER_MAX_RETRY } from './booking-types.js';
import { resolveLineCredential } from '@line-crm/db';
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
}

export interface ProcessRemindersParams {
  now: Date;
  sender: BookingNotificationSender;
  reminderHoursBefore: number;
}

const JST_OFFSET_MS = 9 * 3600_000;

function startsAtJst(utcIso: string): string {
  const jst = new Date(new Date(utcIso).getTime() + JST_OFFSET_MS).toISOString();
  return `${jst.slice(0, 10)} ${jst.slice(11, 16)}`;
}

export async function processDueReminders(
  db: D1Database,
  params: ProcessRemindersParams,
): Promise<{ sent: number; failed: number }> {
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
              f.line_user_id
         FROM booking_reminders r
         INNER JOIN bookings b ON b.id = r.booking_id
         INNER JOIN menus m ON m.id = b.menu_id
         INNER JOIN staff s ON s.id = b.staff_id
         INNER JOIN line_accounts la ON la.id = b.line_account_id
         INNER JOIN friends f ON f.id = b.friend_id
        WHERE r.status IN ('pending','failed')
          AND r.scheduled_at <= ?
          AND b.status = 'confirmed'
          AND b.starts_at > ?       -- 開始時刻を過ぎた予約のリマインダは送らない
        LIMIT 100`,
    )
    .bind(params.now.toISOString(), params.now.toISOString())
    .all<DueRow>();

  let sent = 0;
  let failed = 0;
  for (const row of due.results) {
    const kind: NotificationKind = row.kind;
    // 機能オフ中は送らずpendingのまま残す。再オンで再開する。
    if (row.line_account_id && !await featureJobCanRun(db, { accountId: row.line_account_id, featureId: 'booking', job: 'booking reminders' })) {
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
      // 送る直前に1文で「まだ未送信」と「予約がまだ confirmed」を確かめ、
      // 同時に送信権を握る (retry_count を claim epoch に使う)。
      // 取消が先なら 0 件になり送らない。0 件は別 cron が担当した場合も
      // 同じなので、どちらでもこの実行は手を引く。
      const claim = await db
        .prepare(
          `UPDATE booking_reminders
              SET retry_count = retry_count + 1
            WHERE id = ? AND retry_count = ? AND status IN ('pending','failed')
              AND EXISTS (
                SELECT 1 FROM bookings b
                 WHERE b.id = booking_reminders.booking_id AND b.status = 'confirmed')`,
        )
        .bind(row.id, priorRetry)
        .run();
      if ((claim.meta?.changes ?? 0) === 0) continue;

      await params.sender({
        channelAccessToken: accessToken,
        toLineUserId: row.line_user_id,
        kind,
        ctx: {
          menuName: row.menu_name,
          staffName: row.staff_name,
          startsAtJst: startsAtJst(row.starts_at),
          hoursBefore: params.reminderHoursBefore,
        },
      });
      await db
        .prepare(
          `UPDATE booking_reminders SET status='sent', sent_at = ? WHERE id = ?`,
        )
        .bind(params.now.toISOString(), row.id)
        .run();
      sent++;
    } catch (e) {
      // fence で握れていれば DB 上も同じ値まで進んでいる (二重に数えない)。
      const newStatus = attemptedRetry >= REMINDER_MAX_RETRY ? 'failed_permanent' : 'failed';
      await db
        .prepare(
          `UPDATE booking_reminders SET status = ?, retry_count = ?, last_error = ? WHERE id = ?`,
        )
        .bind(newStatus, attemptedRetry, e instanceof Error ? e.message : String(e), row.id)
        .run();
      failed++;
    }
  }
  return { sent, failed };
}
