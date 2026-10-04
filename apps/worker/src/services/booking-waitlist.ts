/**
 * 予約のキャンセル待ち（booking-plus 2）。
 *
 * 枠は「同じ店・同じ担当・同じ開始時刻」。取り消しで空いたら、登録の早い順に
 * 1人ずつ LINE に1通送り（自動送信）、知らせてから店の設定分数だけ
 * その人だけが取れる仮押さえにする。1人が同じ枠に二重登録できないのは
 * 559 の部分一致キーで止める。
 *
 * 個人情報はログに出さない（件数とIDだけ）。
 */
import {
  formatStartsAtForStore,
  notificationTiming,
  sendBookingNotification,
} from './booking-notifier.js';
import {
  buildWaitlistInviteBubble,
  formatSlotHeadline,
  sendWaitlistInviteCard,
  waitlistBookUrl,
  waitlistDeclineUrl,
  type WaitlistInviteSender,
} from './booking-waitlist-card.js';
import { tzHHMM } from './availability.js';
import { resolveLineCredential } from '@line-crm/db';

export const DEFAULT_WAITLIST_HOLD_MINUTES = 30;

export interface WaitlistSlot {
  lineAccountId: string;
  staffId: string;
  startsAt: string;
}

export interface WaitlistEntry {
  id: string;
  line_account_id: string;
  staff_id: string;
  menu_id: string;
  starts_at: string;
  friend_id: string | null;
  booking_customer_id: string | null;
  identity_key: string;
  status: string;
  hold_minutes: number;
  invited_at: string | null;
  hold_expires_at: string | null;
  notified_at: string | null;
  created_at: string;
}

/** 店の仮押さえ分数。列が無い古いDBでも30で動く。 */
export async function readWaitlistHoldMinutes(
  db: D1Database,
  lineAccountId: string,
): Promise<number> {
  try {
    const row = await db
      .prepare(`SELECT waitlist_hold_minutes FROM booking_settings WHERE line_account_id = ?`)
      .bind(lineAccountId)
      .first<{ waitlist_hold_minutes: number | null }>();
    const value = Number(row?.waitlist_hold_minutes);
    if (Number.isInteger(value) && value >= 1 && value <= 1440) return value;
  } catch {
    // 列が無いDBでは既定で動く。
  }
  return DEFAULT_WAITLIST_HOLD_MINUTES;
}

export type PromoteResult =
  | { promoted: true; entry: WaitlistEntry }
  | { promoted: false; reason: 'empty' | 'hold_active' | 'race' };

/**
 * 取り消しで空いた枠に、登録の早い順で1人を招く。
 *
 * - 仮押さえ中（hold_expires_at が未来）の招待があれば何もしない。
 * - 期限切れの招待は列へ戻す（作った順を保つ）。
 * - 招待の確定（invitedへの更新）を先に単文CASで行い、LINE送信が
 *   失敗しても枠の主張は残る。送信失敗は投げずにログに残す。
 * - LINE未連携の電話客は送らず invited のまま（店が電話する）。
 */
export async function promoteBookingWaitlist(
  db: D1Database,
  slot: WaitlistSlot,
  sender: WaitlistInviteSender = sendWaitlistInviteCard,
  liffBaseUrl = '',
): Promise<PromoteResult> {
  const now = new Date();
  const nowIso = now.toISOString();

  const live = await db
    .prepare(
      `SELECT id FROM booking_waitlist
        WHERE line_account_id = ? AND staff_id = ? AND starts_at = ?
          AND status = 'invited' AND hold_expires_at > ?
        LIMIT 1`,
    )
    .bind(slot.lineAccountId, slot.staffId, slot.startsAt, nowIso)
    .first<{ id: string }>();
  if (live) return { promoted: false, reason: 'hold_active' };

  // 期限切れの仮押さえは列の後ろへ回す（見なかった人が先頭に居続けると
  // 次の人が永久に回ってこないため）。
  await db
    .prepare(
      `UPDATE booking_waitlist
          SET status = 'waiting', invited_at = NULL, hold_expires_at = NULL,
              created_at = ?,
              updated_at = strftime('%Y-%m-%dT%H:%M:%f', 'now', '+9 hours')
        WHERE line_account_id = ? AND staff_id = ? AND starts_at = ?
          AND status = 'invited' AND hold_expires_at <= ?`,
    )
    .bind(nowIso, slot.lineAccountId, slot.staffId, slot.startsAt, nowIso)
    .run();

  const next = await db
    .prepare(
      `SELECT * FROM booking_waitlist
        WHERE line_account_id = ? AND staff_id = ? AND starts_at = ?
          AND status = 'waiting'
        ORDER BY created_at ASC, rowid ASC LIMIT 1`,
    )
    .bind(slot.lineAccountId, slot.staffId, slot.startsAt)
    .first<WaitlistEntry>();
  if (!next) return { promoted: false, reason: 'empty' };

  const holdMinutes = await readWaitlistHoldMinutes(db, slot.lineAccountId);
  const holdExpiresAt = new Date(now.getTime() + holdMinutes * 60_000).toISOString();
  const claimed = await db
    .prepare(
      `UPDATE booking_waitlist
          SET status = 'invited', hold_minutes = ?, invited_at = ?,
              hold_expires_at = ?,
              updated_at = strftime('%Y-%m-%dT%H:%M:%f', 'now', '+9 hours')
        WHERE id = ? AND status = 'waiting'`,
    )
    .bind(holdMinutes, nowIso, holdExpiresAt, next.id)
    .run();
  if ((claimed.meta?.changes ?? 0) === 0) {
    return { promoted: false, reason: 'race' };
  }

  const entry: WaitlistEntry = {
    ...next,
    status: 'invited',
    hold_minutes: holdMinutes,
    invited_at: nowIso,
    hold_expires_at: holdExpiresAt,
  };

  if (entry.friend_id) {
    try {
      const target = await db
        .prepare(
          `SELECT f.line_user_id,
                  la.channel_access_token, la.channel_access_token_encrypted,
                  la.timezone, m.name AS menu_name, s.display_name AS staff_name
             FROM booking_waitlist w
             INNER JOIN friends f ON f.id = w.friend_id
             INNER JOIN line_accounts la ON la.id = w.line_account_id
             INNER JOIN menus m ON m.id = w.menu_id
             INNER JOIN staff s ON s.id = w.staff_id
            WHERE w.id = ?`,
        )
        .bind(entry.id)
        .first<{
          line_user_id: string;
          channel_access_token: string;
          channel_access_token_encrypted: string | null;
          timezone: string | null;
          menu_name: string;
          staff_name: string;
        }>();
      if (target) {
        const accessToken = await resolveLineCredential(
          target.channel_access_token_encrypted,
          target.channel_access_token,
          { lineAccountId: slot.lineAccountId, field: 'channel_access_token' },
        );
        const timeZone = target.timezone ?? 'Asia/Tokyo';
        const headline = formatSlotHeadline(slot.startsAt, timeZone);
        const detail = `${target.menu_name}・担当 ${target.staff_name}`;
        const holdEnd = tzHHMM(timeZone, new Date(holdExpiresAt));
        if (liffBaseUrl) {
          const bubble = buildWaitlistInviteBubble({
            headline,
            detail,
            holdLine: `${holdEnd} まではこちらだけが予約できます。`,
            bookUrl: waitlistBookUrl(liffBaseUrl, entry.id),
            declineUrl: waitlistDeclineUrl(liffBaseUrl, entry.id),
          });
          await sender({
            channelAccessToken: accessToken,
            toLineUserId: target.line_user_id,
            bubble,
            altText: `${headline} に空きが出ました`,
          });
        } else {
          // LIFF の置き場が無い店では従来の文面だけ送る。
          const timing = notificationTiming(slot.startsAt, timeZone, now);
          await sendBookingNotification({
            channelAccessToken: accessToken,
            toLineUserId: target.line_user_id,
            kind: 'waitlist_invite',
            ctx: {
              menuName: target.menu_name,
              staffName: target.staff_name,
              startsAt: formatStartsAtForStore(slot.startsAt, timeZone),
              ...timing,
              holdMinutes,
            },
          });
        }
        await db
          .prepare(`UPDATE booking_waitlist SET notified_at = ? WHERE id = ?`)
          .bind(nowIso, entry.id)
          .run();
        entry.notified_at = nowIso;
      }
    } catch (error) {
      // 招待の主張は残っている。送信だけ店の画面からやり直せるよう、
      // ここでは落とさず件数だけ残す。
      console.error(JSON.stringify({ event: 'booking_waitlist_invite_send_failed', waitlistId: entry.id }));
    }
  }
  return { promoted: true, entry };
}
