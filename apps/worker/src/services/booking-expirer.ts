// Cron handler: expire 24h-old request bookings + purge idempotency rows.

import type { BookingNotificationSender } from './booking-notifier.js';
import { purgeExpiredIdempotency } from './booking-idempotency.js';
import { REQUEST_TTL_HOURS } from './booking-types.js';
import { cancelByTrigger } from './reminder-trigger.js';
import { resolveLineCredential } from '@line-crm/db';

interface StaleRow {
  id: string;
  line_account_id: string;
  friend_id: string;
  starts_at: string;
  menu_name: string;
  staff_name: string;
  channel_access_token: string;
  channel_access_token_encrypted: string | null;
  line_user_id: string;
}

const JST_OFFSET_MS = 9 * 3600_000;

function startsAtJst(utcIso: string): string {
  const jst = new Date(new Date(utcIso).getTime() + JST_OFFSET_MS).toISOString();
  return `${jst.slice(0, 10)} ${jst.slice(11, 16)}`;
}

export interface RunExpirerParams {
  now: Date;
  sender: BookingNotificationSender;
}

export async function runExpirer(
  db: D1Database,
  params: RunExpirerParams,
): Promise<{ expired: number; idempotencyPurged: number }> {
  const cutoff = new Date(params.now.getTime() - REQUEST_TTL_HOURS * 3600_000).toISOString();
  const stale = await db
    .prepare(
      `SELECT b.id, b.line_account_id, b.friend_id, b.starts_at,
              m.name AS menu_name,
              s.display_name AS staff_name,
              la.channel_access_token,
              la.channel_access_token_encrypted,
              f.line_user_id
         FROM bookings b
         INNER JOIN menus m ON m.id = b.menu_id
         INNER JOIN staff s ON s.id = b.staff_id
         INNER JOIN line_accounts la ON la.id = b.line_account_id
         INNER JOIN friends f ON f.id = b.friend_id
        WHERE b.status = 'requested'
          AND b.requested_at < ?
        LIMIT 200`,
    )
    .bind(cutoff)
    .all<StaleRow>();

  let expired = 0;
  for (const row of stale.results) {
    // 条件付き UPDATE: cron 走行中に admin が同じ予約を承認/拒否した場合、
    // requested 行に対してのみ expired 化する。changes=0 なら後続処理（通知/reminders cancel）
    // をスキップして、誤通知を防ぐ。
    const upd = await db
      .prepare(`UPDATE bookings SET status='expired', decided_at = ? WHERE id = ? AND status = 'requested'`)
      .bind(params.now.toISOString(), row.id)
      .run();
    if ((upd.meta?.changes ?? 0) === 0) continue;
    await db
      .prepare(
        `UPDATE booking_reminders SET status='cancelled' WHERE booking_id = ? AND status IN ('pending','failed')`,
      )
      .bind(row.id)
      .run();
    // N-065: 期限切れも取消と同じく V6 の未送信予定だけを止める。送信済み履歴は残す。
    // 1件の失敗で残り200件を止めないよう行単位で握る。失敗行は末尾の修復走査で拾い直す。
    try {
      await cancelByTrigger(db, {
        triggerType: 'booking',
        sourceId: row.id,
        sourceEventId: row.id,
        friendId: row.friend_id,
        startsAtIso: row.starts_at,
        lineAccountId: row.line_account_id,
        cancelReason: `booking_expired:${row.id}:by:system`,
      });
    } catch (error) {
      console.error('reminder cancel (booking expired) failed:', error);
    }
    try {
      const accessToken = await resolveLineCredential(
        row.channel_access_token_encrypted,
        row.channel_access_token,
        { lineAccountId: row.line_account_id, field: 'channel_access_token' },
      );
      await params.sender({
        channelAccessToken: accessToken,
        toLineUserId: row.line_user_id,
        kind: 'expired',
        ctx: {
          menuName: row.menu_name,
          staffName: row.staff_name,
          startsAtJst: startsAtJst(row.starts_at),
          hoursBefore: 0,
        },
      });
    } catch {
      // 通知失敗は許容、expirer 自体は完了
    }
    expired++;
  }

  // 部分失敗の回復: 業務は終わっているのに V6 が active のまま残った行を止める。
  // V6 取消が投げた行は次回 cron で拾い直す。手動取消・却下の取りこぼしも
  // source 連動に限って拾う。legacy・手動登録には触れない。
  // 修復自体の失敗で期限切れを壊さないよう外側でも握る。
  try {
    const leftovers = await db
      .prepare(
        `SELECT b.id, b.line_account_id, b.friend_id, b.starts_at
           FROM bookings b
          WHERE b.status IN ('expired', 'cancelled', 'rejected')
            AND EXISTS (
              SELECT 1 FROM friend_reminders fr
               WHERE fr.status = 'active' AND fr.source_kind = 'booking'
                 AND (fr.source_id = b.id OR fr.source_event_id = b.id)
            )
          LIMIT 50`,
      )
      .all<StaleRow>();
    for (const row of leftovers.results ?? []) {
      try {
        await cancelByTrigger(db, {
          triggerType: 'booking',
          sourceKind: 'booking',
          sourceId: row.id,
          sourceEventId: row.id,
          friendId: row.friend_id,
          startsAtIso: row.starts_at,
          lineAccountId: row.line_account_id,
          cancelReason: `booking_repair:${row.id}:by:system`,
          allowLegacyFallback: false,
        });
      } catch (error) {
        console.error('reminder repair (booking leftover) failed:', error);
      }
    }
  } catch (error) {
    console.error('reminder repair (booking leftover scan) failed:', error);
  }

  const idempotencyPurged = await purgeExpiredIdempotency(db, params.now);
  return { expired, idempotencyPurged };
}
