import { resolveLineCredential } from '@line-crm/db';
import { queueBookingOperation, finishBookingOperation } from './booking-operation-runs.js';
import { formatStartsAtForStore, notificationTiming, sendBookingNotification, type NotificationKind } from './booking-notifier.js';

/** 自動送信の開始を先に記録する。到達不明・保存失敗は自動で送り直さない（B-248）。 */
export async function notifyForBooking(
  db: D1Database,
  bookingId: string,
  kind: NotificationKind,
  existingOperationId?: string,
  retryKey?: string,
): Promise<void> {
  const row = await db
    .prepare(
      `SELECT b.starts_at, b.line_account_id, b.status,
              m.name AS menu_name,
              s.display_name AS staff_name,
              la.channel_access_token,
              la.channel_access_token_encrypted,
              f.line_user_id,
              bs.timezone
         FROM bookings b
         INNER JOIN menus m ON m.id = b.menu_id
         INNER JOIN staff s ON s.id = b.staff_id
         INNER JOIN line_accounts la ON la.id = b.line_account_id
         INNER JOIN friends f ON f.id = b.friend_id
          LEFT JOIN booking_settings bs ON bs.line_account_id = b.line_account_id
        WHERE b.id = ?`,
    )
    .bind(bookingId)
    .first<{
      starts_at: string;
      status: string;
      line_account_id: string;
      menu_name: string;
      staff_name: string;
      channel_access_token: string;
      channel_access_token_encrypted: string | null;
      line_user_id: string;
      timezone: string | null;
    }>();
  if (!row) return;
  if (kind === 'approved' && row.status !== 'confirmed') return;
  const operationId = existingOperationId ?? await queueBookingOperation(db, {
    bookingId,
    lineAccountId: row.line_account_id,
    kind: 'confirmation_line',
    idempotencyKey: `${bookingId}:confirmation-line:${kind}`,
    result: { notificationKind: kind },
  });
  const nowIso = new Date().toISOString();
  if (!existingOperationId) {
    const claimed = await db.prepare(`UPDATE booking_operation_runs SET opened_at = ?, updated_at = ?
      WHERE id = ? AND status IN ('queued','retry_wait')
        AND (opened_at IS NULL OR opened_at < ?)`)
      .bind(nowIso, nowIso, operationId, new Date(Date.now() - 600_000).toISOString()).run();
    if ((claimed.meta?.changes ?? 0) !== 1) return;
  }
  let sendStarted = false;
  try {
    const accessToken = await resolveLineCredential(
      row.channel_access_token_encrypted,
      row.channel_access_token,
      { lineAccountId: row.line_account_id, field: 'channel_access_token' },
    );
    // 文面の日時は店舗の時間帯で書く (R332)。kind に応じた相対表現は
    // 送信時点の実測で組み立てる (R333)。
    const timeZone = row.timezone ?? 'Asia/Tokyo';
    const timing = notificationTiming(row.starts_at, timeZone, new Date());
    const started = await db.prepare(`UPDATE booking_operation_runs
      SET status = 'permanent_failed', error_code = 'delivery_unknown', updated_at = ?
      WHERE id = ? AND (? != 'approved' OR EXISTS (SELECT 1 FROM bookings WHERE id = ? AND status = 'confirmed'))`)
      .bind(nowIso, operationId, kind, bookingId).run();
    if ((started.meta?.changes ?? 0) !== 1) return;
    sendStarted = true;
    await sendBookingNotification({
      channelAccessToken: accessToken,
      toLineUserId: row.line_user_id,
      kind,
      ctx: {
        menuName: row.menu_name,
        staffName: row.staff_name,
        startsAt: formatStartsAtForStore(row.starts_at, timeZone),
        ...timing,
      },
      retryKey: retryKey ?? operationId,
    });
    await finishBookingOperation(db, {
      id: operationId,
      status: 'succeeded',
      completedAt: new Date().toISOString(),
      result: { notificationKind: kind, openTracking: 'inbox' },
    });
  } catch (error) {
    await finishBookingOperation(db, {
      id: operationId,
      status: sendStarted ? 'permanent_failed' : 'retry_wait',
      completedAt: new Date().toISOString(),
      errorCode: sendStarted ? 'delivery_unknown' : 'notification_preflight_failed',
      result: { notificationKind: kind },
    });
    if (!sendStarted && !existingOperationId) {
      await db.prepare('UPDATE booking_operation_runs SET opened_at = NULL WHERE id = ?').bind(operationId).run();
    }
    throw error;
  }
}
